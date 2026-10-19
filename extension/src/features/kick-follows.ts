// While you're signed in on kick.com, read who you follow there (read-only, the same request Kick's own sidebar
// makes) and hand just the names and pictures to the background, so Kick follows join the live list, alerts and
// auto-open. Nothing about the sign-in itself leaves the page. Refreshed on load and every 10 minutes.
import { platform } from "@platform";
import type { KickFollow } from "../core/kick-live";

const token = () => {
  const m = document.cookie.match(/(?:^|;\s*)session_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
};

async function read() {
  const t = token();
  if (!t) return;
  const follows: KickFollow[] = [];
  let cursor: string | number | null = null;
  for (let page = 0; page < 10; page++) {
    const r: Response | null = await fetch(`/api/v2/channels/followed${cursor != null ? `?cursor=${encodeURIComponent(String(cursor))}` : ""}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${t}` },
    }).catch(() => null);
    if (!r?.ok) return; // signed out or blocked: keep what we had
    const j: any = await r.json().catch(() => null);
    for (const c of j?.channels ?? [])
      if (c?.channel_slug) follows.push({ slug: String(c.channel_slug).toLowerCase(), name: c.user_username ?? c.channel_slug, avatar: c.profile_picture ?? "" });
    cursor = j?.nextCursor ?? null;
    if (cursor == null) break;
  }
  platform.send({ type: "kick:follows", follows }).catch(() => {});
}

export function kickFollows() {
  void read();
  setInterval(read, 10 * 60_000);
}
