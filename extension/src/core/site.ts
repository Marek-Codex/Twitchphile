// Which streaming site this page is. Twitchphile is Twitch-first; on Kick, the features that make sense there run
// with the same settings (one set of toggles for both sites), reading Kick's page through its own selectors.
export type Site = "twitch" | "kick";

export const SITE: Site = /(^|\.)kick\.com$/.test(location.hostname) ? "kick" : "twitch";
export const onKick = SITE === "kick";

// Kick's first path segments that are site pages, not channels.
const KICK_RESERVED = new Set([
  "browse", "categories", "category", "following", "search", "video", "videos", "clips", "clip", "dashboard", "settings",
  "subscriptions", "messages", "notifications", "terms-of-service", "privacy-policy", "community-guidelines", "dmca",
  "about", "careers", "support", "drops", "wallet", "kicks", "partner", "popout",
]);

/** The Kick channel this page belongs to ("" if not a channel page). */
export const kickChannel = () => {
  const first = location.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  return KICK_RESERVED.has(first) ? "" : first;
};

/** How a channel is keyed in shared data (watch time, history): Twitch logins as-is, Kick ones prefixed. */
export const channelKey = (login: string) => (onKick && login ? `kick/${login}` : login);
