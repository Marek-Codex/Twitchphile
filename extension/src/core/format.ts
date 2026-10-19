// Number and duration formatting shared by the page features, panel and popup (pure).

// 45m · 2h 05m · 150h
export function fmtDuration(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 100 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${h}h`;
}

// 4:07:28 — matches Twitch's own uptime clock.
export function fmtClock(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(t / 3600)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

// 950 · 4.8K · 25K
export const fmtCompact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));
