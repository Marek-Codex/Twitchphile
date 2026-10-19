// Channel history, recorded from the live checks the background already makes (no extra requests for viewers):
// one entry per stream session per channel — when it started, how long it ran, peak and average viewers, time per
// game — plus each channel's follower count once a day. Local-only. This is what the channel-stats drawer graphs.
export const HISTORY_KEY = "channelHistory";
export const FOLLOWERS_KEY = "followerHistory";

const KEEP_DAYS = 120;
const MAX_SESSIONS = 150; // per channel
const MAX_GAP_MIN = 15; // a gap longer than this between sightings isn't counted as time in a game

export interface StreamSession {
  start: string; // the stream's started_at (identifies the session)
  last: number; // last time we saw it live (ms) — so duration ≈ last − start
  samples: number;
  sum: number; // of viewers, for the average
  peak: number;
  games: Record<string, number>; // game → minutes seen
  title: string;
}

export type History = Record<string, StreamSession[]>; // login → sessions, oldest first
export type FollowerHistory = Record<string, [string, number][]>; // login → [day, followers][]

export interface LiveSample {
  login: string;
  viewers: number;
  startedAt: string;
  game: string;
  title: string;
}

/** Folds one live check into the history (returns a new object; the input is left alone). */
export function recordLive(history: History, live: LiveSample[], now: number): History {
  const next: History = { ...history };
  const cutoff = now - KEEP_DAYS * 86_400_000;
  for (const c of live) {
    const login = c.login.toLowerCase();
    const sessions = [...(next[login] ?? [])];
    const i = sessions.findIndex((x) => x.start === c.startedAt);
    let s: StreamSession;
    if (i < 0) {
      s = { start: c.startedAt, last: now, samples: 0, sum: 0, peak: 0, games: {}, title: c.title };
      sessions.push(s);
    } else {
      s = sessions[i] = { ...sessions[i], games: { ...sessions[i].games } };
      const gap = (now - s.last) / 60_000;
      if (gap > 0 && gap <= MAX_GAP_MIN && c.game) s.games[c.game] = (s.games[c.game] ?? 0) + gap;
    }
    s.last = now;
    s.samples += 1;
    s.sum += c.viewers;
    s.peak = Math.max(s.peak, c.viewers);
    s.title = c.title || s.title;
    next[login] = sessions.filter((x) => x.last >= cutoff).slice(-MAX_SESSIONS);
  }
  return next;
}

/** Adds today's follower count for a channel (one point per day; the latest reading of the day wins). */
export function recordFollowers(history: FollowerHistory, login: string, followers: number, day: string): FollowerHistory {
  const points = (history[login] ?? []).filter(([d]) => d !== day);
  return { ...history, [login]: [...points, [day, followers] as [string, number]].slice(-KEEP_DAYS) };
}

// ---- Derived numbers for the stats drawer

export const sessionMinutes = (s: StreamSession) => Math.max(0, (s.last - Date.parse(s.start)) / 60_000);
export const sessionAverage = (s: StreamSession) => (s.samples ? Math.round(s.sum / s.samples) : 0);

/** Weekday (0 = Monday) × hour counts of stream starts, in the viewer's local time. */
export function startHeatmap(starts: string[]) {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const iso of starts) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    grid[(d.getDay() + 6) % 7][d.getHours()] += 1;
  }
  return grid;
}

/** "Usually live around Tue/Thu 7pm" from the busiest cells of a start heatmap; null with too little data. */
export function usualStart(grid: number[][]) {
  const total = grid.flat().reduce((a, b) => a + b, 0);
  if (total < 4) return null;
  const byDay = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const days = byDay.map((n, i) => [n, i] as const).filter(([n]) => n >= Math.max(2, total * 0.15)).map(([, i]) => i);
  const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((a, row) => a + row[h], 0));
  const hour = byHour.indexOf(Math.max(...byHour));
  return { days, hour };
}
