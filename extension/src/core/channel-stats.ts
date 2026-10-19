// Background-only: records channel history from each live check, and assembles everything the channel-stats drawer
// shows — Twitch's own facts about the channel (followers, VODs, clips, schedule) plus what we've recorded.
import { platform } from "@platform";
import { dayKey } from "./channel-data";
import { helix } from "./auth";
import { FOLLOWERS_KEY, HISTORY_KEY, recordFollowers, recordLive, type FollowerHistory, type History, type StreamSession } from "./history";
import type { LiveChannel } from "./live";

// One write per live check; serialized so overlapping checks can't drop each other's samples.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

/** Folds a live check into the history, and notes follower counts for channels not yet counted today. */
export const recordCheck = (live: LiveChannel[]) =>
  serial(async () => {
    const history = (await platform.local.get<History>(HISTORY_KEY)) ?? {};
    await platform.local.set(HISTORY_KEY, recordLive(history, live, Date.now()));

    const today = dayKey();
    let followers = (await platform.local.get<FollowerHistory>(FOLLOWERS_KEY)) ?? {};
    const due = live.filter((c) => c.id && followers[c.login]?.at(-1)?.[0] !== today).slice(0, 20); // a few per check
    for (const c of due) {
      const total = (await helix<{ total: number }>(`channels/followers?broadcaster_id=${c.id}&first=1`))?.total;
      if (typeof total === "number") followers = recordFollowers(followers, c.login, total, today);
    }
    if (due.length) await platform.local.set(FOLLOWERS_KEY, followers);
  });

export interface ChannelStats {
  login: string;
  id: string | null;
  name: string;
  avatar: string;
  type: string; // "partner" | "affiliate" | ""
  createdAt: string;
  followers: number | null;
  vods: { title: string; createdAt: string; minutes: number; views: number; url: string }[];
  clips: { title: string; views: number; url: string; thumb: string; createdAt: string }[];
  schedule: { title: string; start: string; category: string }[];
  channel: { title: string; game: string; language: string; tags: string[]; labels: string[]; branded: boolean; delay: number } | null;
  chat: { followersOnly: number | null; subOnly: boolean; slow: number | null; emoteOnly: boolean; unique: boolean } | null;
  team: string | null;
  emotes: { name: string; url: string; tier: string; type: string }[];
  sessions: StreamSession[]; // recorded by us, oldest first
  followerHistory: [string, number][];
  signedIn: boolean;
}

// Helix durations look like "3h12m5s".
const minutesOf = (d: string) => {
  const [, h = "0", m = "0"] = d.match(/(?:(\d+)h)?(?:(\d+)m)?/) ?? [];
  return Number(h) * 60 + Number(m);
};

const cache = new Map<string, { at: number; value: ChannelStats }>();
const TTL = 5 * 60_000;

export async function channelStats(login: string): Promise<ChannelStats> {
  login = login.toLowerCase();
  const hit = cache.get(login);
  if (hit && Date.now() - hit.at < TTL) return { ...hit.value, sessions: await sessionsOf(login), followerHistory: await followersOf(login) };

  const user = (await helix<{ data: { id: string; display_name: string; profile_image_url: string; broadcaster_type: string; created_at: string }[] }>(
    `users?login=${encodeURIComponent(login)}`,
  ))?.data?.[0];
  const id = user?.id ?? null;
  const [followers, vods, clips, schedule, channel, chat, teams, emotes] = id
    ? await Promise.all([
        helix<{ total: number }>(`channels/followers?broadcaster_id=${id}&first=1`),
        helix<{ data: { title: string; created_at: string; duration: string; view_count: number; url: string }[] }>(`videos?user_id=${id}&type=archive&first=40`),
        helix<{ data: { title: string; view_count: number; url: string; thumbnail_url: string; created_at: string }[] }>(
          `clips?broadcaster_id=${id}&first=6&started_at=${new Date(Date.now() - 30 * 86_400_000).toISOString()}`,
        ),
        helix<{ data: { segments: { title: string; start_time: string; category: { name: string } | null }[] | null } }>(`schedule?broadcaster_id=${id}&first=5`),
        helix<{ data: { title: string; game_name: string; broadcaster_language: string; tags: string[]; content_classification_labels: string[]; is_branded_content: boolean; delay: number }[] }>(`channels?broadcaster_id=${id}`),
        helix<{ data: { follower_mode: boolean; follower_mode_duration: number | null; subscriber_mode: boolean; slow_mode: boolean; slow_mode_wait_time: number | null; emote_mode: boolean; unique_chat_mode: boolean }[] }>(`chat/settings?broadcaster_id=${id}`),
        helix<{ data: { team_display_name: string }[] }>(`teams/channel?broadcaster_id=${id}`),
        helix<{ data: { name: string; images: { url_2x: string }; tier: string; emote_type: string }[] }>(`chat/emotes?broadcaster_id=${id}`),
      ])
    : [null, null, null, null, null, null, null, null];
  const ch = channel?.data?.[0];
  const cs = chat?.data?.[0];

  const value: ChannelStats = {
    login,
    id,
    name: user?.display_name ?? login,
    avatar: user?.profile_image_url ?? "",
    type: user?.broadcaster_type ?? "",
    createdAt: user?.created_at ?? "",
    followers: followers?.total ?? null,
    vods: (vods?.data ?? []).map((v) => ({ title: v.title, createdAt: v.created_at, minutes: minutesOf(v.duration), views: v.view_count, url: v.url })),
    clips: (clips?.data ?? [])
      .sort((a, b) => b.view_count - a.view_count)
      .map((c) => ({ title: c.title, views: c.view_count, url: c.url, thumb: c.thumbnail_url, createdAt: c.created_at })),
    schedule: (schedule?.data?.segments ?? []).map((s) => ({ title: s.title, start: s.start_time, category: s.category?.name ?? "" })),
    channel: ch
      ? { title: ch.title, game: ch.game_name, language: ch.broadcaster_language, tags: ch.tags ?? [], labels: ch.content_classification_labels ?? [], branded: ch.is_branded_content, delay: ch.delay ?? 0 }
      : null,
    chat: cs
      ? {
          followersOnly: cs.follower_mode ? (cs.follower_mode_duration ?? 0) : null,
          subOnly: cs.subscriber_mode,
          slow: cs.slow_mode ? (cs.slow_mode_wait_time ?? 0) : null,
          emoteOnly: cs.emote_mode,
          unique: cs.unique_chat_mode,
        }
      : null,
    team: teams?.data?.[0]?.team_display_name ?? null,
    emotes: (emotes?.data ?? []).map((e) => ({ name: e.name, url: e.images.url_2x, tier: e.tier, type: e.emote_type })),
    sessions: [],
    followerHistory: [],
    signedIn: Boolean(user),
  };
  if (user) cache.set(login, { at: Date.now(), value });
  return { ...value, sessions: await sessionsOf(login), followerHistory: await followersOf(login) };
}

const sessionsOf = async (login: string) => ((await platform.local.get<History>(HISTORY_KEY)) ?? {})[login] ?? [];
const followersOf = async (login: string) => ((await platform.local.get<FollowerHistory>(FOLLOWERS_KEY)) ?? {})[login] ?? [];

/** What we've recorded for a channel (Kick's drawer asks for this; its other facts come from Kick itself). Given
 *  today's follower count, notes that too, so Kick channels get a follower history like Twitch ones. */
export const channelHistory = (login: string, followers?: number | null) =>
  serial(async () => {
    if (typeof followers === "number") {
      const today = dayKey();
      const all = (await platform.local.get<FollowerHistory>(FOLLOWERS_KEY)) ?? {};
      if (all[login]?.at(-1)?.[0] !== today) await platform.local.set(FOLLOWERS_KEY, recordFollowers(all, login, followers, today));
    }
    return { sessions: await sessionsOf(login), followerHistory: await followersOf(login) };
  });
