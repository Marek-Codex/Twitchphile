// Background-only: everyone you follow (with avatars), cached for the popup's Following tab and favorite rows.
import { platform } from "@platform";
import { getAuth, helix } from "./auth";

export const FOLLOWS_KEY = "follows";
const TTL = 30 * 60_000;
const PAGE = 100;

export interface Followed {
  login: string;
  name: string;
  avatar: string;
  followedAt: string;
}

type Page<T> = { data: T[]; pagination?: { cursor?: string } };
type FollowRow = { broadcaster_id: string; broadcaster_login: string; broadcaster_name: string; followed_at: string };
type UserRow = { id: string; profile_image_url: string };

export async function refreshFollows(force = false): Promise<Followed[]> {
  const cached = await platform.local.get<{ at: number; list: Followed[] }>(FOLLOWS_KEY);
  if (!force && cached && Date.now() - cached.at < TTL) return cached.list;
  const auth = await getAuth();
  if (!auth) return cached?.list ?? [];

  const rows: FollowRow[] = [];
  let cursor: string | undefined;
  do {
    const page = await helix<Page<FollowRow>>(`channels/followed?user_id=${auth.userId}&first=${PAGE}${cursor ? `&after=${cursor}` : ""}`);
    if (!page) return cached?.list ?? [];
    rows.push(...page.data);
    cursor = page.pagination?.cursor;
  } while (cursor);

  const avatars = new Map<string, string>();
  for (let i = 0; i < rows.length; i += PAGE) {
    const ids = rows.slice(i, i + PAGE).map((r) => `id=${r.broadcaster_id}`).join("&");
    (await helix<Page<UserRow>>(`users?${ids}`))?.data.forEach((u) => avatars.set(u.id, u.profile_image_url));
  }

  const list = rows.map((r) => ({
    login: r.broadcaster_login,
    name: r.broadcaster_name,
    avatar: avatars.get(r.broadcaster_id) ?? "",
    followedAt: r.followed_at,
  }));
  await platform.local.set(FOLLOWS_KEY, { at: Date.now(), list });
  return list;
}
