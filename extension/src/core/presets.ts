// One-click setups for common ways of watching. A preset only touches its own settings (turning some on, a few off),
// so presets stack: Lurker then Chatter is a lurking chatter. The panel offers Undo right after applying one.
import { DEFAULTS, type SettingKey, type Settings } from "./settings";

export interface Preset {
  id: string;
  name: string;
  description: string;
  on: SettingKey[];
  off: SettingKey[];
}

// "Everything" leaves out what's a matter of taste rather than a missing feature.
const NOT_IN_EVERYTHING = new Set<SettingKey>([
  "grayscale", "skipWarnings", "hideExtensions", "autoOpenAll", "autoOpenFocus", "claimOnlyVisible", "mentionOnlyHidden",
  "hideLeaderboard", "hideHighlights", "hideBitsGifts", "hideSubPromos", "hidePrime", "hideHypeTrain", "keepQuality",
]);

export const PRESETS: Preset[] = [
  {
    id: "clean",
    name: "Clean",
    description: "A tidier Twitch: hides its clutter and promos, and keeps Twitchphile's own extras out of sight.",
    on: [
      "hideStories", "hideLeaderboard", "hideHighlights", "hidePrime", "hideBitsGifts", "hideHypeTrain", "hideSubPromos",
      "stopHomeAutoplay", "directoryFilter",
    ],
    off: ["streamStats", "chatterCount", "cardBadges", "screenshotButton", "pipButton", "realTime", "filterButtons", "sidebarFresh"],
  },
  {
    id: "lurker",
    name: "Lurker",
    description: "Watch in the background and miss nothing: streams open muted on their own, points and drops collect themselves.",
    on: [
      "autoOpen", "autoOpenMuted", "lurkMode", "autoClose", "autoClaim", "dropsTracker", "dropsNotify", "notifyLive",
      "predictionAlerts", "predictionOnlyAway", "adMute", "autoRecover", "watchTime", "primeReminder", "liveBadge",
    ],
    off: ["autoOpenFocus"],
  },
  {
    id: "chatter",
    name: "Chatter",
    description: "Active in chat without the busywork: highlights, nicknames, mention chimes, filters — and chests claim themselves.",
    on: [
      "chatHighlight", "messageMenu", "nicknames", "mentionSpotlight", "replyPreview", "copyEmote", "readableNames",
      "mentionSound", "keywordAlerts", "botFilter", "chatMute", "autoClaim", "predictionAlerts",
    ],
    off: [],
  },
  {
    id: "stats",
    name: "Stats",
    description: "All the numbers: channel stats, the stats strip, chatter counts, badges, sidebar uptimes and your watch time.",
    on: [
      "channelStatsButton", "streamStats", "statLatency", "statUptime", "statViewers", "statWatch", "chatterCount", "watchTime",
      "cardBadges", "cardLanguage", "cardDrops", "sidebarPlus", "sidebarUptime", "sidebarFresh", "realTime",
    ],
    off: [],
  },
  {
    id: "everything",
    name: "Everything",
    description: "Every feature on, except the matter-of-taste ones (grayscale, skipping warnings, hiding things) you'd pick yourself.",
    on: (Object.keys(DEFAULTS) as SettingKey[]).filter((k) => typeof DEFAULTS[k] === "boolean" && !NOT_IN_EVERYTHING.has(k)),
    off: [],
  },
];

/** The changes a preset would make to the current settings (only what actually differs). */
export function presetChanges(preset: Preset, current: Settings): Partial<Settings> {
  const changes: Record<string, boolean> = {};
  for (const k of preset.on) if (current[k] !== true) changes[k] = true;
  for (const k of preset.off) if (current[k] !== false) changes[k] = false;
  return changes as Partial<Settings>;
}
