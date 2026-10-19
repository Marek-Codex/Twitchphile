// Channel stats for a Kick channel, in the same shape the drawer draws for Twitch. Read from Kick's own site data
// (same site as the page, no sign-in needed): followers, chat rules, the live stream, past broadcasts (with the
// categories each one streamed — so "what they play" and "when they go live" work straight away) and top clips.
// Kick doesn't publish viewer counts per past broadcast, so those come from our own recording (merged in below).
import { platform } from "@platform";
import type { ChannelStats } from "../../core/channel-stats";
import type { FollowerHistory } from "../../core/history";
import type { StreamSession } from "../../core/history";

// Kick's times look like "2026-10-13 17:30:00" (UTC, no zone marker).
const utc = (s: string | undefined) => (s ? `${s.replace(" ", "T")}${/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"}` : "");

const get = (path: string) =>
  fetch(path)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

export async function kickStats(login: string): Promise<ChannelStats> {
  const slug = encodeURIComponent(login);
  const [ch, videos, clips] = await Promise.all([
    get(`/api/v2/channels/${slug}`),
    get(`/api/v2/channels/${slug}/videos`),
    get(`/api/v2/channels/${slug}/clips?sort=view&time=month`),
  ]);
  const live = ch?.livestream;
  const room = ch?.chatroom ?? {};
  const pastRaw: any[] = (Array.isArray(videos) ? videos : []).filter((v) => Number(v?.duration) > 0);

  // Past broadcasts double as sessions (no viewer numbers, but start, length and categories), so the drawer's
  // heatmap, hours-per-week and category charts have something to show.
  const sessions: StreamSession[] = pastRaw
    .map((v) => {
      const start = utc(v.start_time ?? v.created_at);
      const minutes = Number(v.duration) / 60_000;
      const cats: string[] = (v.categories ?? []).map((c: any) => c?.name).filter(Boolean);
      return {
        start,
        last: Date.parse(start) + minutes * 60_000,
        samples: 0,
        sum: 0,
        peak: 0,
        games: Object.fromEntries(cats.map((c) => [c, minutes / cats.length])),
        title: v.session_title ?? "",
      };
    })
    .reverse(); // oldest first, as the drawer expects

  const followers =
    Number.isFinite(Number(ch?.followers_count)) && ch?.followers_count !== null && ch?.followers_count !== undefined ? Number(ch.followers_count) : null;

  // What we've recorded ourselves while the channel was in the live list (viewer counts included), merged with
  // the past broadcasts: a recorded stream wins over the broadcast that started within half an hour of it.
  const mine = await platform
    .send<{ sessions: StreamSession[]; followerHistory: FollowerHistory[string] }>({ type: "channel:history", login: `kick/${login}`, followers })
    .catch(() => null);
  const recorded = mine?.sessions ?? [];
  const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) < 30 * 60_000;
  const merged = [...sessions.filter((v) => !recorded.some((r) => near(r.start, v.start))), ...recorded].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  );

  return {
    login,
    id: ch?.user_id != null ? String(ch.user_id) : null,
    name: ch?.user?.username ?? login,
    avatar: ch?.user?.profile_pic ?? "",
    type: ch?.verified ? "verified" : ch?.is_affiliate ? "affiliate" : "",
    createdAt: "",
    followers, // Kick sends a number or a numeric string
    vods: pastRaw.map((v) => ({
      title: v.session_title ?? "",
      createdAt: utc(v.start_time ?? v.created_at),
      minutes: Math.round(Number(v.duration) / 60_000),
      views: Number(v.views) || 0,
      url: v.video?.uuid ? `https://kick.com/${login}/videos/${v.video.uuid}` : `https://kick.com/${login}/videos`,
    })),
    clips: (clips?.clips ?? []).slice(0, 6).map((c: any) => ({
      title: c.title ?? "",
      views: Number(c.views ?? c.view_count) || 0,
      url: `https://kick.com/${login}/clips/${c.id}`,
      thumb: c.thumbnail_url ?? "",
      createdAt: c.created_at ?? "",
    })),
    schedule: [],
    channel: live
      ? {
          title: live.session_title ?? "",
          game: live.categories?.[0]?.name ?? "",
          language: live.lang_iso ?? "",
          tags: live.tags ?? [],
          labels: live.is_mature ? ["Mature"] : [],
          branded: false,
          delay: 0,
        }
      : null,
    chat: {
      followersOnly: room.followers_mode ? Number(room.following_min_duration) || 0 : null,
      subOnly: Boolean(room.subscribers_mode),
      slow: room.slow_mode ? Number(room.message_interval) || 0 : null,
      emoteOnly: Boolean(room.emotes_mode),
      unique: false,
    },
    team: null,
    emotes: [],
    sessions: merged,
    followerHistory: mine?.followerHistory ?? [],
    signedIn: Boolean(ch),
  };
}
