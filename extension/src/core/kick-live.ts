// Kick channels in the live list. Which ones: the channels you follow on Kick (read by the content script while
// you're signed in on kick.com, see features/kick-follows.ts) plus any "kick/<name>" in favorites or the watch
// list. Each is checked through Kick's public channel data, so this needs no Kick sign-in in the background.
import { platform } from "@platform";
import { isKick, KICK_PREFIX, kickSlug } from "./channels";
import type { LiveChannel } from "./live";

export const KICK_FOLLOWS_KEY = "kickFollows";
export interface KickFollow { slug: string; name: string; avatar: string }

const utc = (s?: string) => (s ? `${s.replace(" ", "T")}${/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"}` : "");

async function check(slug: string, followed: boolean): Promise<LiveChannel | null | undefined> {
  const r = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" } }).catch(() => null);
  if (!r?.ok) {
    console.warn(`[Twitchphile] Kick check for ${slug} failed:`, r ? r.status : "network error");
    return undefined; // unknown, not "offline"
  }
  const ch = await r.json().catch(() => null);
  const s = ch?.livestream;
  if (!s?.is_live) return null;
  return {
    login: KICK_PREFIX + slug,
    name: ch.user?.username ?? slug,
    title: s.session_title ?? "",
    game: s.categories?.[0]?.name ?? "",
    viewers: Number(s.viewer_count) || 0,
    startedAt: utc(s.start_time ?? s.created_at),
    thumb: s.thumbnail?.url ?? "",
    followed,
    avatar: ch.user?.profile_pic ?? "",
  };
}

/** Live Kick channels among follows + kick/ entries in `lists`. Throws if most checks failed (keep the old list). */
export async function kickLive(lists: string[]): Promise<LiveChannel[]> {
  const follows = (await platform.local.get<KickFollow[]>(KICK_FOLLOWS_KEY)) ?? [];
  const followed = new Set(follows.map((f) => f.slug));
  const slugs = [...new Set([...followed, ...lists.filter(isKick).map(kickSlug)])].slice(0, 150);
  const out: LiveChannel[] = [];
  let failed = 0;
  for (let i = 0; i < slugs.length; i += 6) {
    const batch = await Promise.all(slugs.slice(i, i + 6).map((s) => check(s, followed.has(s))));
    for (const c of batch) c === undefined ? failed++ : c && out.push(c);
  }
  if (slugs.length && failed > slugs.length / 2) throw new Error("Kick live check failed");
  return out;
}
