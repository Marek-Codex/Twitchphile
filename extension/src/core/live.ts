// Background-only: polls followed + extra watched channels and caches the live list for UI.
import { platform } from "@platform";
import { getAuth, helix } from "./auth";
import { settings } from "./settings";
import { lowerSet } from "./util";
import { isKick } from "./channels";
import { kickLive } from "./kick-live";

export interface LiveChannel {
  id?: string; // Twitch user id (older caches may lack it)
  login: string;
  name: string;
  title: string;
  game: string;
  viewers: number;
  startedAt: string;
  thumb: string;
  followed: boolean;
  avatar?: string; // Kick sends it with the stream; Twitch avatars come from the follows list
}

export const LIVE_KEY = "liveNow";
export const LIVE_AT_KEY = "liveCheckedAt"; // when the list was last checked, so UI can say how fresh it is

type HelixStream = {
  user_id: string;
  user_login: string;
  user_name: string;
  title: string;
  game_name: string;
  viewer_count: number;
  started_at: string;
  thumbnail_url: string;
};
type StreamPage = { data: HelixStream[]; pagination?: { cursor?: string } };

const toLive = (s: HelixStream, followed: boolean): LiveChannel => ({
  id: s.user_id,
  login: s.user_login,
  name: s.user_name,
  title: s.title,
  game: s.game_name,
  viewers: s.viewer_count,
  startedAt: s.started_at,
  thumb: s.thumbnail_url.replace("{width}", "320").replace("{height}", "180"),
  followed,
});

export async function refreshLive(): Promise<LiveChannel[]> {
  const s = await settings.load();
  // A failed Kick check keeps the Kick channels we last saw, so it can't hold up (or wipe) the Twitch part.
  const kick = await kickLive([...s.watchChannels, ...s.favorites]).catch(async () =>
    ((await platform.local.get<LiveChannel[]>(LIVE_KEY)) ?? []).filter((c) => isKick(c.login)),
  );
  const auth = await getAuth();
  if (!auth) {
    await platform.local.set(LIVE_KEY, kick);
    await platform.local.set(LIVE_AT_KEY, Date.now());
    return kick;
  }
  const extra = [...lowerSet(s.watchChannels)].filter((l) => !isKick(l)).slice(0, 100);

  // A partial or failed check must not replace the cached live list: that would falsely mark
  // streams as ended and then announce them again on the next successful check.
  const followed: HelixStream[] = [];
  let cursor: string | undefined;
  do {
    const page: StreamPage | null = await helix<StreamPage>(
      `streams/followed?user_id=${auth.userId}&first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
    );
    if (!page) throw new Error("Twitch live check failed");
    followed.push(...page.data);
    cursor = page.pagination?.cursor;
  } while (cursor);

  const others = extra.length
    ? await helix<StreamPage>(`streams?first=100&${extra.map((l) => `user_login=${encodeURIComponent(l)}`).join("&")}`)
    : null;
  if (extra.length && !others) throw new Error("Twitch watched-channel check failed");
  const seen = new Set<string>();
  const live = [...followed.map((s) => toLive(s, true)), ...(others?.data ?? []).map((s) => toLive(s, false)), ...kick].filter(
    (c) => !seen.has(c.login) && seen.add(c.login),
  );
  await platform.local.set(LIVE_KEY, live);
  await platform.local.set(LIVE_AT_KEY, Date.now());
  return live;
}
