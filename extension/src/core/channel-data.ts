// Per-channel data kept device-locally: watch time (seconds), auto-claimed bonus chests, remembered quality/volume.
import { platform } from "@platform";

export const WATCH_KEY = "watchtime";
export const CLAIMS_KEY = "claims";
export const PREFS_KEY = "channelPrefs";
export const WATCH_DAYS_KEY = "watchDays"; // local date "YYYY-MM-DD" → seconds watched (all channels)
export const WATCH_HOURS_KEY = "watchHours"; // 7×24 (Mon-first, local time) → seconds watched, all-time
const KEEP_DAYS = 90;

export type Counts = Record<string, number>;
export type ChannelPrefs = Record<string, { quality?: string; volume?: number }>;

// Serialized in the background so concurrent tabs can't clobber each other's increments.
let queue = Promise.resolve();
export function increment(key: string, login: string, by: number) {
  queue = queue.then(async () => {
    const all = (await platform.local.get<Counts>(key)) ?? {};
    all[login] = (all[login] ?? 0) + by;
    await platform.local.set(key, all);
  });
  return queue;
}

// Local calendar day, so "today" matches the user's clock rather than UTC.
export const dayKey = (at = new Date()) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

// Adds to today's total and forgets days older than KEEP_DAYS. Same serial queue as increment().
export function addDaily(seconds: number, now = new Date()) {
  queue = queue.then(async () => {
    const days = (await platform.local.get<Counts>(WATCH_DAYS_KEY)) ?? {};
    const today = dayKey(now);
    days[today] = (days[today] ?? 0) + seconds;
    const cutoff = dayKey(new Date(now.getTime() - KEEP_DAYS * 86_400_000));
    for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
    await platform.local.set(WATCH_DAYS_KEY, days);
    // When in the week you watch (for the habits heatmap). Attributed to the hour it's reported in.
    const hours = (await platform.local.get<number[]>(WATCH_HOURS_KEY)) ?? Array<number>(168).fill(0);
    hours[((now.getDay() + 6) % 7) * 24 + now.getHours()] += seconds;
    await platform.local.set(WATCH_HOURS_KEY, hours);
  });
  return queue;
}
