import { platform } from "@platform";

// Every setting and its default, grouped like the panel (see schema.ts for labels).
export const DEFAULTS = {
  // Player
  clickToPause: true,
  wheelVolume: true,
  volumeStep: 5,
  showOsd: true,
  hotkeys: true,
  channelPrefs: true,
  cinema: true,
  cinemaFullscreen: true,
  cinemaChatWidth: 340,
  cinemaChat: "side" as "side" | "auto" | "below",
  cinemaChatHeight: 360,
  keepQuality: false,
  tabAutoMute: false,
  adMute: true,
  autoRecover: true,
  realTime: true,
  clipDownload: true,
  screenshotButton: true,
  pipButton: true,
  flashbang: false,
  flashbangLevel: 35,

  // Stream
  streamStats: true,
  channelStatsButton: true,
  statsPlacement: "chat" as "chat" | "info",
  statLatency: true,
  statUptime: true,
  statViewers: true,
  statWatch: true,
  chatterCount: true,
  latencyReducer: false,
  latencyTarget: 3,
  predictionAlerts: false,
  predictionOnlyAway: true,

  // Chat
  chatHighlight: true,
  highlightUsers: [] as string[],
  highlightKeywords: [] as string[],
  messageMenu: true,
  nicknames: true,
  nicknameMap: {} as Record<string, string>,
  mentionSpotlight: true,
  copyEmote: true,
  replyPreview: true,
  chatImages: false,
  chatImagesHover: true,
  chatImageSize: 160,
  keywordAlerts: false,
  mentionSound: false,
  mentionVolume: 60,
  mentionOnlyHidden: false,

  // Filters
  botFilter: true,
  botMode: "dim" as "dim" | "hide",
  botUsers: [] as string[],
  readableNames: true,
  chatMute: true,
  muteUsers: [] as string[],
  muteWords: [] as string[],
  giphyFilter: false,
  giphyMode: "mini" as "mini" | "hide",

  // Live
  favorites: [] as string[],
  pinFavorites: true,
  sidebarPlus: true,
  sidebarUptime: true,
  sidebarFresh: true,
  sidebarExpand: true,
  sidebarSort: "twitch" as "twitch" | "newest" | "longest" | "name" | "watched",
  watchChannels: [] as string[],
  hiddenChannels: [] as string[],
  pollMinutes: 2,
  liveBadge: true,
  notifyLive: false,
  notifyQuietHours: false,
  notifyQuietStart: 23,
  notifyQuietEnd: 8,
  notifyMutedChannels: [] as string[],
  liveSort: "viewers" as "viewers" | "fewest",

  // Auto-open
  autoOpen: false,
  autoOpenAll: false,
  autoOpenMax: 3,
  autoOpenMuted: true,
  autoOpenFocus: false,
  autoOpenRotate: false,
  rotateMinutes: 30,
  lurkMode: true,
  autoClose: true,
  raidAction: "next" as "stay" | "close" | "next",

  // Points
  autoClaim: true,
  claimMinDelay: 3,
  claimMaxDelay: 8,
  claimOnlyVisible: false,
  dropsClaim: true,
  primeReminder: true,
  dropsTracker: true,
  dropsNotify: true,

  // Card badges
  cardBadges: true,
  cardLanguage: true,
  cardDrops: true,

  // Hover previews
  hoverPreviews: true,
  previewMode: "image" as "image" | "video",
  previewWidth: 320,

  // Declutter
  hideStories: true,
  hideExtensions: false,
  hideLeaderboard: false,
  hideHighlights: false,
  hidePrime: false,
  hideBitsGifts: false,
  hideHypeTrain: false,
  hideSubPromos: false,
  grayscale: false,
  directoryFilter: true,
  hiddenCategories: [] as string[],
  hiddenTitleWords: [] as string[],
  hiddenTags: [] as string[],
  hideReruns: false,
  filterButtons: true,
  stopHomeAutoplay: true,
  directorySort: false,
  directorySortBy: "VIEWER_COUNT" as "VIEWER_COUNT" | "VIEWER_COUNT_ASC" | "RECENT",
  skipWarnings: false,

  // Watch time
  watchTime: true,
};

export type Settings = typeof DEFAULTS;
export type SettingKey = keyof Settings;

// Only known keys whose value has the default's shape get through (arrays of strings, plain objects, same primitive type).
export function cleanSettings(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in DEFAULTS)) continue;
    const d = DEFAULTS[k as SettingKey];
    const ok = Array.isArray(d)
      ? Array.isArray(v) && v.every((x) => typeof x === "string")
      : typeof d === "object"
        ? Boolean(v) && typeof v === "object" && !Array.isArray(v)
        : typeof v === typeof d;
    if (ok) out[k] = v;
  }
  return out as Partial<Settings>;
}

let current: Settings = { ...DEFAULTS };
const listeners = new Set<(changed: Partial<Settings>) => void>();

export const settings = {
  get: () => current,
  async load() {
    // Anything stored with the wrong shape (older builds, corruption) falls back to its default.
    current = { ...DEFAULTS, ...cleanSettings(await platform.storage.get(DEFAULTS)) };
    return current;
  },
  set: (values: Partial<Settings>) => platform.storage.set(values),
  onChange(cb: (changed: Partial<Settings>) => void) {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  },
};

platform.storage.onChange((changes) => {
  const changed = changes as Partial<Settings>;
  current = { ...current, ...changed };
  listeners.forEach((cb) => cb(changed));
});

// Keys renamed since earlier builds → current names. Run on install/update (background).
const RENAMED: Record<string, SettingKey> = { statChatters: "chatterCount", greyscale: "grayscale" };

export async function migrateSettings() {
  const keys = [...Object.keys(RENAMED), "autoOpenChannels", "favorites", "favourites", "pinFavorites", "pinFavourites"];
  const old = await platform.storage.get(Object.fromEntries(keys.map((k) => [k, null])) as Record<string, unknown>);
  const next: Record<string, unknown> = {};

  // The favorites LIST: it lived under "autoOpenChannels" (older) or "favourites" (British spelling); if it's
  // already under "favorites", keep it. Spelling pass carries the British key across to the American one.
  const list = old.autoOpenChannels ?? (Array.isArray(old.favourites) ? old.favourites : old.favorites);
  if (list != null) next.favorites = list;

  // The sidebar-pin SWITCH: before "favorites" became the list, it (and its British spelling "favourites") was
  // this boolean; "pinFavourites"/"pinFavorites" are the same switch. Whichever is present lands on "pinFavorites".
  const pin = typeof old.favorites === "boolean" ? old.favorites
    : typeof old.favourites === "boolean" ? old.favourites
    : old.pinFavourites ?? old.pinFavorites;
  if (pin != null) next.pinFavorites = pin;

  for (const [from, to] of Object.entries(RENAMED)) if (old[from] != null) next[to] = old[from];
  if (!Object.keys(next).length) return;
  await platform.storage.set(next);
  await platform.storage.remove(["autoOpenChannels", "favourites", "pinFavourites", ...Object.keys(RENAMED)].filter((k) => old[k] != null));
}
