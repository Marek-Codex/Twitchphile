// Backup format + merge rules. Pure functions (no browser APIs) so they're unit-testable.
import type { ChannelPrefs, Counts } from "./channel-data";
import type { Settings } from "./settings";

export interface Backup {
  app: "twitchphile";
  version: string;
  exportedAt: string;
  settings: Partial<Settings>;
  watchtime: Counts;
  claims?: Counts;
  channelPrefs?: ChannelPrefs;
}

// Counters merge by max per key, so restoring an old backup never loses newer progress.
export function mergeCounts(current: Record<string, number>, incoming: unknown): Record<string, number> {
  const out = { ...current };
  if (!incoming || typeof incoming !== "object") return out;
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === "number" && Number.isFinite(v) && v > (out[k] ?? 0)) out[k] = v;
  }
  return out;
}

// Per-channel prefs: what's on this device wins; the backup fills in channels it doesn't know.
export function mergePrefs<T extends object>(current: Record<string, T>, incoming: unknown): Record<string, T> {
  const out = { ...current };
  if (!incoming || typeof incoming !== "object") return out;
  for (const [k, v] of Object.entries(incoming)) if (!(k in out) && v && typeof v === "object") out[k] = v as T;
  return out;
}
