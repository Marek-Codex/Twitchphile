// Background-only: upcoming stream schedules for your favorites, cached for 6 hours.
import { platform } from "@platform";
import { helix } from "./auth";
import { lowerSet } from "./util";
import { settings } from "./settings";

export const SCHEDULE_KEY = "schedule";
const TTL = 6 * 60 * 60_000;
const WINDOW = 7 * 24 * 60 * 60_000;
const MAX_CHANNELS = 15;

export interface Upcoming {
  login: string;
  name: string;
  title: string;
  category: string;
  start: string;
}

type Segment = { start_time: string; title: string; canceled_until: string | null; category: { name: string } | null };

export async function refreshSchedule(force = false): Promise<Upcoming[]> {
  const cached = await platform.local.get<{ at: number; items: Upcoming[] }>(SCHEDULE_KEY);
  if (!force && cached && Date.now() - cached.at < TTL) return cached.items;

  const logins = [...lowerSet((await settings.load()).favorites)].slice(0, MAX_CHANNELS);
  if (!logins.length) {
    await platform.local.set(SCHEDULE_KEY, { at: Date.now(), items: [] });
    return [];
  }

  const users = await helix<{ data: { id: string; login: string; display_name: string }[] }>(
    `users?${logins.map((l) => `login=${encodeURIComponent(l)}`).join("&")}`,
  );
  const items: Upcoming[] = [];
  await Promise.all(
    (users?.data ?? []).map(async (u) => {
      // 404s when a channel has no schedule — helix() returns null, which is fine.
      const res = await helix<{ data: { segments: Segment[] | null } }>(`schedule?broadcaster_id=${u.id}&first=5`);
      for (const seg of res?.data?.segments ?? []) {
        const t = Date.parse(seg.start_time);
        if (seg.canceled_until || t < Date.now() || t - Date.now() > WINDOW) continue;
        items.push({ login: u.login, name: u.display_name, title: seg.title, category: seg.category?.name ?? "", start: seg.start_time });
      }
    }),
  );
  items.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  await platform.local.set(SCHEDULE_KEY, { at: Date.now(), items });
  return items;
}
