// Background-only: toolbar badge, "went live" notifications, and the recently-ended list.
import { platform } from "@platform";
import type { LiveChannel } from "./live";
import { settings, type Settings } from "./settings";
import { lowerSet } from "./util";

const SEEN_KEY = "liveSeen"; // live list at the previous check
export const ENDED_KEY = "recentlyEnded";
const ENDED_TTL = 24 * 60 * 60_000;
const ENDED_MAX = 20;

export function isQuietHour(s: Settings, now = new Date()): boolean {
  if (!s.notifyQuietHours) return false;
  const start = Math.floor(s.notifyQuietStart);
  const end = Math.floor(s.notifyQuietEnd);
  const hour = now.getHours();
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export interface EndedStream {
  login: string;
  name: string;
  game: string;
  title: string;
  startedAt: string;
  endedAt: number;
}

// One at a time: the live alarm and settings changes can overlap, and two passes reading the same
// "seen" baseline would announce the same stream twice.
let queue: Promise<unknown> = Promise.resolve();
export function updateAlerts(live: LiveChannel[]) {
  const run = queue.then(() => updateNow(live));
  queue = run.catch(() => {});
  return run;
}

async function updateNow(live: LiveChannel[]) {
  const s = await settings.load();
  const favs = lowerSet(s.favorites);
  const hidden = lowerSet(s.hiddenChannels);
  const visible = live.filter((c) => !hidden.has(c.login));

  // Badge: live favorites if you have any, otherwise everything live.
  const count = favs.size ? visible.filter((c) => favs.has(c.login)).length : visible.length;
  platform.badge(s.liveBadge && count ? String(count) : "");

  const prev = await platform.local.get<LiveChannel[]>(SEEN_KEY);
  await platform.local.set(SEEN_KEY, live);
  if (!prev) return; // first check has no baseline — don't announce everyone at once

  // Recently ended: live last check, not now.
  const liveNow = new Set(live.map((c) => c.login));
  const ended = prev.filter((c) => !liveNow.has(c.login) && !hidden.has(c.login));
  if (ended.length) {
    const endedAt = Date.now();
    const fresh = ended.map(({ login, name, game, title, startedAt }) => ({ login, name, game, title, startedAt, endedAt }));
    const older = ((await platform.local.get<EndedStream[]>(ENDED_KEY)) ?? []).filter((e) => !fresh.some((f) => f.login === e.login));
    await platform.local.set(
      ENDED_KEY,
      [...fresh, ...older].filter((e) => endedAt - e.endedAt < ENDED_TTL).slice(0, ENDED_MAX),
    );
  }

  if (!s.notifyLive) return;
  const was = new Set(prev.map((c) => c.login));
  const muted = lowerSet(s.notifyMutedChannels);
  if (isQuietHour(s)) return;
  for (const c of visible) {
    if (favs.has(c.login) && !muted.has(c.login) && !was.has(c.login)) {
      platform.notify(`live:${c.login}`, `${c.name} is live`, [c.game, c.title].filter(Boolean).join(" · "));
    }
  }
}
