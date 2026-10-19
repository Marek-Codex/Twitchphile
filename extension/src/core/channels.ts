// Channels from either site in one list. Twitch channels are plain logins ("xqc"); Kick channels are written
// "kick/<name>" ("kick/xqc"), so favorites, the live list, alerts, auto-open and the desktop app all handle both
// without separate lists. These helpers turn such a name into the right links.
export const KICK_PREFIX = "kick/";

export const isKick = (login: string) => login.toLowerCase().startsWith(KICK_PREFIX);
export const kickSlug = (login: string) => login.slice(KICK_PREFIX.length).toLowerCase();

/** The channel's page (optionally a sub-page like "/videos") on its own site. */
export const channelUrl = (login: string, path = "") =>
  isKick(login) ? `https://kick.com/${kickSlug(login)}${path}` : `https://www.twitch.tv/${login}${path}`;

/** URL patterns matching any open tab of this channel (exactly this one: "foo" must not match "foobar"). */
export const channelTabs = (login: string) => {
  const [host, name] = isKick(login) ? ["kick.com", kickSlug(login)] : ["*.twitch.tv", login];
  return [`*://${host}/${name}`, `*://${host}/${name}/*`, `*://${host}/${name}?*`];
};

/** "xqc" or "xqc · Kick", for lists that mix both. */
export const channelLabel = (login: string) => (isKick(login) ? `${kickSlug(login)} · Kick` : login);

/** A typed or pasted channel as we store it: "kick.com/xqc" or a Kick link → "kick/xqc", a Twitch link → "xqc". */
export const channelName = (raw: string) => {
  const v = raw.trim().replace(/^@/, "");
  const url = v.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(kick\.com|twitch\.tv)\/([^/?#\s]+)/i);
  if (url) return (url[1].toLowerCase() === "kick.com" ? KICK_PREFIX : "") + url[2].toLowerCase();
  return isKick(v) ? KICK_PREFIX + kickSlug(v) : v.toLowerCase();
};
