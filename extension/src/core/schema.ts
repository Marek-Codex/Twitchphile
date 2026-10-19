import * as icons from "../ui/icons";
import type { SettingKey } from "./settings";

// Describes how settings are presented; the panel renders from this alone.
//
// Writing rules, so every row reads the same way:
// - Title: short, sentence case, names the thing ("Scroll volume"), never a full sentence.
// - Description: what happens, in one plain sentence; a second sentence only for a catch or a tip.
// - A "channel" is the person, a "stream" is the broadcast. "favorites" are channels you starred.
// - `group` puts consecutive rows in their own card under a small [ HEADING ].
export type Control =
  | { type: "toggle" }
  | { type: "number"; min: number; max: number; unit?: string }
  | { type: "list"; placeholder: string }
  | { type: "map"; empty: string }
  | { type: "select"; options: { value: string; label: string }[] };

export interface SettingRow {
  key: SettingKey;
  title: string;
  description: string;
  control: Control;
  requires?: SettingKey; // shown nested + disabled while parent is off
  group?: string;
}

export interface Category {
  id: string;
  label: string;
  icon: string; // an export of ui/icons
  account?: boolean; // show the Twitch account card above the rows
  watchList?: boolean; // show the watch-time leaderboard below the rows
  data?: boolean; // show desktop pairing, backup and diagnostics
  drops?: boolean; // show drop-campaign progress below the rows
  rows: SettingRow[];
}

const toggle: Control = { type: "toggle" };

export const SCHEMA: Category[] = [
  {
    id: "favorites",
    label: "favorites",
    icon: icons.star,
    account: true,
    rows: [
      { group: "Your favorites", key: "favorites", title: "favorites", description: "Channels you starred. Star more here, in the toolbar popup, or from Twitch's sidebar.", control: { type: "list", placeholder: "channel" } },
      { group: "Your favorites", key: "pinFavorites", title: "Pin in sidebar", description: "Favorites sit at the top of Twitch's followed list. Hover a channel there for its ★.", control: toggle },
      { group: "Sidebar", key: "sidebarPlus", title: "Sidebar upgrades", description: "Extras for Twitch's followed channels list, below.", control: toggle },
      { group: "Sidebar", key: "sidebarUptime", title: "Uptime", description: "How long each followed channel has been live. Needs your Twitch account connected.", control: toggle, requires: "sidebarPlus" },
      { group: "Sidebar", key: "sidebarFresh", title: "Glow when just live", description: "Highlights channels that went live in the last 15 minutes. Needs your Twitch account connected.", control: toggle, requires: "sidebarPlus" },
      { group: "Sidebar", key: "sidebarExpand", title: "Show every live channel", description: "Presses \"Show more\" for you until all live followed channels are listed.", control: toggle, requires: "sidebarPlus" },
      { group: "Sidebar", key: "sidebarSort", title: "Sort live channels", description: "Order of live channels in the followed list. favorites still come first when pinned.", control: { type: "select", options: [{ value: "twitch", label: "Twitch (viewers)" }, { value: "newest", label: "Just went live" }, { value: "longest", label: "Live longest" }, { value: "name", label: "A–Z" }, { value: "watched", label: "Most watched by you" }] }, requires: "sidebarPlus" },
      { group: "When they go live", key: "notifyLive", title: "Notification", description: "A desktop notification when a favorite goes live. Click it to open the stream.", control: toggle },
      { group: "When they go live", key: "notifyQuietHours", title: "Quiet hours", description: "Pause live notifications during the hours below, using your local time. Streams still appear in the live list.", control: toggle, requires: "notifyLive" },
      { group: "When they go live", key: "notifyQuietStart", title: "Quiet from", description: "Start hour in local time (0–23). For example, 23 means 11 pm.", control: { type: "number", min: 0, max: 23, unit: "h" }, requires: "notifyQuietHours" },
      { group: "When they go live", key: "notifyQuietEnd", title: "Quiet until", description: "End hour in local time (0–23). For example, 8 means 8 am. Matching hours disable the quiet period.", control: { type: "number", min: 0, max: 23, unit: "h" }, requires: "notifyQuietHours" },
      { group: "When they go live", key: "notifyMutedChannels", title: "Never notify for", description: "favorite channels that stay in the live list but never send live notifications.", control: { type: "list", placeholder: "channel" }, requires: "notifyLive" },
      { group: "When they go live", key: "liveBadge", title: "Count on the icon", description: "How many favorites are live, on the toolbar icon. Counts everyone you follow if you have no favorites.", control: toggle },
      { group: "Live list", key: "watchChannels", title: "Also watch", description: "Channels you don't follow but still want to see go live. Star them to auto-open them too.", control: { type: "list", placeholder: "channel" } },
      { group: "Live list", key: "hiddenChannels", title: "Hidden", description: "Never shown in the popup or counted on the icon.", control: { type: "list", placeholder: "channel" } },
      { group: "Live list", key: "pollMinutes", title: "Check every", description: "How often to check who's live.", control: { type: "number", min: 1, max: 15, unit: "min" } },
    ],
  },
  {
    id: "autoopen",
    label: "Auto-open",
    icon: icons.autoOpen,
    rows: [
      { group: "Opening", key: "autoOpen", title: "Auto-open streams", description: "Opens a tab when a favorite goes live. Needs your Twitch account.", control: toggle },
      { group: "Opening", key: "autoOpenAll", title: "Everyone you follow", description: "Open every followed channel that goes live, not just favorites.", control: toggle, requires: "autoOpen" },
      { group: "Opening", key: "autoOpenMax", title: "Tab limit", description: "Most auto-opened tabs at once.", control: { type: "number", min: 1, max: 10 }, requires: "autoOpen" },
      { group: "Opening", key: "autoOpenFocus", title: "Switch to them", description: "Bring new tabs to the front instead of opening them in the background.", control: toggle, requires: "autoOpen" },
      { group: "In the tab", key: "autoOpenMuted", title: "Start muted", description: "Mutes the player (not the tab), so you can unmute it as usual.", control: toggle, requires: "autoOpen" },
      { group: "In the tab", key: "lurkMode", title: "Lurk mode", description: "Auto-opened tabs keep full quality in the background instead of dropping or pausing. Tabs you open yourself are untouched.", control: toggle, requires: "autoOpen" },
      { group: "Over time", key: "autoOpenRotate", title: "Take turns", description: "When more favorites are live than the tab limit, cycle through them. The tab you're looking at is never swapped out.", control: toggle, requires: "autoOpen" },
      { group: "Over time", key: "rotateMinutes", title: "Turn length", description: "How long each channel keeps its tab before the next one gets a turn.", control: { type: "number", min: 5, max: 240, unit: "min" }, requires: "autoOpenRotate" },
      { group: "Over time", key: "raidAction", title: "When raided", description: "A stream Twitchphile opened ends in a raid: move the tab to the next live favorite without one (or close it if there's none), close it, or stay on the raid.", control: { type: "select", options: [{ value: "next", label: "Next favorite" }, { value: "close", label: "Close the tab" }, { value: "stay", label: "Stay on the raid" }] }, requires: "autoOpen" },
      { group: "Over time", key: "autoClose", title: "Close when offline", description: "Closes auto-opened tabs once the stream ends. Tabs you opened are never touched.", control: toggle, requires: "autoOpen" },
    ],
  },
  {
    id: "player",
    label: "Player",
    icon: icons.player,
    rows: [
      { group: "Controls", key: "clickToPause", title: "Click to pause", description: "Click the video to play or pause. Double-click still goes fullscreen.", control: toggle },
      { group: "Controls", key: "wheelVolume", title: "Scroll volume", description: "Scroll over the volume control to change it.", control: toggle },
      { group: "Controls", key: "volumeStep", title: "Volume step", description: "How much each scroll tick changes the volume.", control: { type: "number", min: 1, max: 25, unit: "%" }, requires: "wheelVolume" },
      { group: "Controls", key: "showOsd", title: "On-screen readout", description: "Briefly shows volume and other feedback over the video.", control: toggle },
      { group: "Controls", key: "hotkeys", title: "Hotkeys", description: "Alt+L live · Alt+←/→ skip 10s · Alt+,/. VOD speed · Alt+S screenshot · Alt+P picture-in-picture · Alt+F cinema · Alt+C chat · Alt+O settings.", control: toggle },
      { group: "Cinema", key: "cinema", title: "Cinema mode", description: "Player and chat fill the window, everything else hidden. Button in the player bar, or Alt+F.", control: toggle },
      { group: "Cinema", key: "cinemaFullscreen", title: "Go fullscreen", description: "Also enters browser fullscreen. Esc leaves both.", control: toggle, requires: "cinema" },
      { group: "Cinema", key: "cinemaChat", title: "Chat", description: "Beside the video; hidden until you move the mouse to the right edge; or below the video for tall screens (drag the divider to resize).", control: { type: "select", options: [{ value: "side", label: "Beside" }, { value: "auto", label: "Auto-hide" }, { value: "below", label: "Below" }] }, requires: "cinema" },
      { group: "Cinema", key: "cinemaChatWidth", title: "Chat width", description: "How wide chat is when it's beside the video or slides in.", control: { type: "number", min: 240, max: 600, unit: "px" }, requires: "cinema" },
      { group: "Quality & sound", key: "channelPrefs", title: "Remember per channel", description: "Restores the quality and volume you last picked for each channel.", control: toggle },
      { group: "Quality & sound", key: "keepQuality", title: "Keep quality in background", description: "Stops Twitch dropping quality or pausing when you switch tabs. Uses more bandwidth; applies on next page load.", control: toggle },
      { group: "Quality & sound", key: "tabAutoMute", title: "Mute tabs you leave", description: "Mutes a stream when you switch away and unmutes it when you come back. Streams you muted yourself stay muted.", control: toggle },
      { group: "Quality & sound", key: "adMute", title: "Mute during ads", description: "Mutes while an ad plays. Doesn't block ads, so streamers still get paid.", control: toggle },
      { group: "Quality & sound", key: "autoRecover", title: "Recover from errors", description: "Retries, then reloads, when the player errors (e.g. #2000). At most 3 times in 10 minutes.", control: toggle },
      { group: "Extras", key: "screenshotButton", title: "Screenshot button", description: "Saves the current frame as a PNG. Button in the player bar.", control: toggle },
      { group: "Extras", key: "pipButton", title: "Picture-in-picture button", description: "Pops the stream out into a floating window. Button in the player bar, or Alt+P.", control: toggle },
      { group: "Extras", key: "clipDownload", title: "Clip download", description: "Download button on clip pages, best quality MP4.", control: toggle },
      { group: "Extras", key: "realTime", title: "Real time on VODs", description: "Shows the real clock time of the moment you're watching in a past broadcast.", control: toggle },
      { group: "Comfort", key: "flashbang", title: "Flashbang defender", description: "Dims the player when a stream suddenly cuts to blinding white, and brings it back once it calms down. Steadily bright streams aren't touched.", control: toggle },
      { group: "Comfort", key: "flashbangLevel", title: "Dim to", description: "How bright the player stays while dimmed.", control: { type: "number", min: 10, max: 80, unit: "%" }, requires: "flashbang" },
    ],
  },
  {
    id: "stats",
    label: "Stats",
    icon: icons.stream,
    watchList: true,
    rows: [
      { group: "Channel stats", key: "channelStatsButton", title: "Channel stats", description: "A button in the player bar opens the channel's stats: followers, viewers per stream, hours per week, when they go live, what they play, top clips, schedule, and links to SullyGnome, TwitchTracker and more.", control: toggle },
      { group: "Stats strip", key: "streamStats", title: "Stats strip", description: "Live numbers for the stream you're watching.", control: toggle },
      { group: "Stats strip", key: "statsPlacement", title: "Placement", description: "Chat header replaces the \"Stream Chat\" label. Under player sits beside Twitch's viewer count.", control: { type: "select", options: [{ value: "chat", label: "Chat header" }, { value: "info", label: "Under player" }] }, requires: "streamStats" },
      { group: "Stats strip", key: "statViewers", title: "Viewer trend", description: "How the viewer count moved over the last 5 minutes.", control: toggle, requires: "streamStats" },
      { group: "Stats strip", key: "statWatch", title: "Your watch time", description: "How long you've watched this channel in total. Needs watch time tracking, below.", control: toggle, requires: "streamStats" },
      { group: "Stats strip", key: "statUptime", title: "Uptime", description: "How long the stream has been live. Under the player it replaces Twitch's own.", control: toggle, requires: "streamStats" },
      { group: "Stats strip", key: "statLatency", title: "Latency", description: "How far behind live you are. Click it to jump to live.", control: toggle, requires: "streamStats" },
      { group: "Stats strip", key: "chatterCount", title: "Chatter count", description: "Logged-in chatters in parentheses beside Twitch's viewer count, and on Stream Together cards.", control: toggle },
      { group: "Latency", key: "latencyReducer", title: "Latency reducer", description: "Plays slightly faster (up to 1.1×) when you fall behind, then settles back.", control: toggle },
      { group: "Latency", key: "latencyTarget", title: "Target latency", description: "The delay the reducer keeps you under.", control: { type: "number", min: 1, max: 15, unit: "s" }, requires: "latencyReducer" },
      { group: "Predictions", key: "predictionAlerts", title: "Prediction alerts", description: "A chime and a desktop notification when a prediction opens on the stream you're watching.", control: toggle },
      { group: "Predictions", key: "predictionOnlyAway", title: "Only when away", description: "Only alert while the tab is in the background.", control: toggle, requires: "predictionAlerts" },
      { group: "Watch time", key: "watchTime", title: "Track watch time", description: "Counts time a stream is actually playing, background tabs included. Stays on this device.", control: toggle },
    ],
  },
  {
    id: "chat",
    label: "Chat",
    icon: icons.chat,
    rows: [
      { group: "Highlights", key: "chatHighlight", title: "Highlights", description: "Marks messages from chosen users or containing chosen words.", control: toggle },
      { group: "Highlights", key: "highlightUsers", title: "Users", description: "Usernames to highlight. Press Enter to add.", control: { type: "list", placeholder: "username" }, requires: "chatHighlight" },
      { group: "Highlights", key: "highlightKeywords", title: "Keywords", description: "Whole words to highlight, any case.", control: { type: "list", placeholder: "keyword" }, requires: "chatHighlight" },
      { group: "Highlights", key: "mentionSpotlight", title: "Mention spotlight", description: "Hover an @mention to light up that person's messages.", control: toggle },
      { group: "Sounds", key: "mentionSound", title: "Mention chime", description: "A soft chime when someone @mentions you.", control: toggle },
      { group: "Sounds", key: "keywordAlerts", title: "Keyword chime", description: "The same chime when a message contains one of your highlight keywords.", control: toggle },
      { group: "Sounds", key: "mentionVolume", title: "Chime volume", description: "How loud the chimes are.", control: { type: "number", min: 5, max: 100, unit: "%" } },
      { group: "Sounds", key: "mentionOnlyHidden", title: "Only when the tab is hidden", description: "Stay quiet while you're looking at the stream.", control: toggle },
      { group: "Tools", key: "messageMenu", title: "Message menu", description: "Hover a message for quick actions: copy, mention, highlight, nickname.", control: toggle },
      { group: "Tools", key: "nicknames", title: "Nicknames", description: "Your own names for chatters. Set them from the message menu.", control: toggle },
      { group: "Tools", key: "nicknameMap", title: "Saved nicknames", description: "Remove one to go back to the real name.", control: { type: "map", empty: "No nicknames yet. Hover a message and use the tag button." }, requires: "nicknames" },
      { group: "Tools", key: "replyPreview", title: "Full reply context", description: "Shows the whole message someone replied to, not just the first line. Hover a message to see all of a long one.", control: toggle },
      { group: "Tools", key: "copyEmote", title: "Copy emote", description: "Right-click an emote to copy its name.", control: toggle },
      { group: "Look", key: "readableNames", title: "Readable name colors", description: "Lightens usernames too dark to read (or darkens pale ones in light mode).", control: toggle },
      { group: "Look", key: "chatImages", title: "Image previews", description: "Shows image links inline. Loading one reveals your IP to the site hosting it.", control: toggle },
      { group: "Look", key: "chatImagesHover", title: "Only on hover", description: "Don't load an image until you hover its message.", control: toggle, requires: "chatImages" },
      { group: "Look", key: "chatImageSize", title: "Max height", description: "Largest an image preview can be.", control: { type: "number", min: 60, max: 400, unit: "px" }, requires: "chatImages" },
    ],
  },
  {
    id: "filters",
    label: "Chat filters",
    icon: icons.filters,
    rows: [
      { group: "Bots", key: "botFilter", title: "Bot filter", description: "Quiets common bots (Nightbot, StreamElements, Fossabot…) and any you add.", control: toggle },
      { group: "Bots", key: "botMode", title: "Mode", description: "Dim keeps them readable on hover. Hide removes them.", control: { type: "select", options: [{ value: "dim", label: "Dim" }, { value: "hide", label: "Hide" }] }, requires: "botFilter" },
      { group: "Bots", key: "botUsers", title: "Extra bots", description: "More accounts to treat as bots.", control: { type: "list", placeholder: "username" }, requires: "botFilter" },
      { group: "Mute list", key: "chatMute", title: "Mute list", description: "Hides messages from chosen users or containing chosen words.", control: toggle },
      { group: "Mute list", key: "muteUsers", title: "Users", description: "Their messages are hidden.", control: { type: "list", placeholder: "username" }, requires: "chatMute" },
      { group: "Mute list", key: "muteWords", title: "Words", description: "Messages containing these whole words are hidden.", control: { type: "list", placeholder: "word" }, requires: "chatMute" },
      { group: "GIFs", key: "giphyFilter", title: "GIF filter", description: "Tames GIF messages in chat.", control: toggle },
      { group: "GIFs", key: "giphyMode", title: "Mode", description: "Mini shrinks GIFs to a thumbnail that grows on hover. Hide removes them.", control: { type: "select", options: [{ value: "mini", label: "Mini" }, { value: "hide", label: "Hide" }] }, requires: "giphyFilter" },
    ],
  },
  {
    id: "declutter",
    label: "Declutter",
    icon: icons.declutter,
    rows: [
      { group: "Channel pages", key: "hideExtensions", title: "Hide Twitch extensions", description: "Removes streamer-installed overlays and panels from the player.", control: toggle },
      { group: "Channel pages", key: "hideLeaderboard", title: "Hide leaderboard", description: "Removes the gift and cheer strip above chat.", control: toggle },
      { group: "Channel pages", key: "hideHighlights", title: "Hide chat highlights", description: "Removes the pinned stack above chat (hype trains, sub drops, goals).", control: toggle },
      { group: "Channel pages", key: "skipWarnings", title: "Skip content warnings", description: "Clicks \"Start watching\" on mature and content-classification screens for you.", control: toggle },
      { group: "Promotions", key: "hidePrime", title: "Hide Prime offers", description: "Removes the crown button from the top bar.", control: toggle },
      { group: "Promotions", key: "hideBitsGifts", title: "Hide Bits and gift buttons", description: "Removes \"Get Bits\", the gift button and the Bits button in chat (and Kick's KICKs gift shop button).", control: toggle },
      { group: "Promotions", key: "hideHypeTrain", title: "Hide hype trains", description: "Removes hype-train banners over chat and markers in the sidebar.", control: toggle },
      { group: "Promotions", key: "hideSubPromos", title: "Hide sub promotions", description: "Removes gift-sub discount and expiring-gift callouts, and Kick’s “try 1080p free for 60 seconds” offer.", control: toggle },
      { group: "Promotions", key: "grayscale", title: "Grayscale", description: "Shows the whole site in grayscale, video included. Makes browsing noticeably less grabby.", control: toggle },
      { group: "Browsing", key: "hideStories", title: "Hide Stories", description: "Removes the Stories rail and \"save your streak\" prompts from the sidebar.", control: toggle },
      { group: "Browsing", key: "stopHomeAutoplay", title: "Stop homepage autoplay", description: "The featured stream on the front page stays paused and muted.", control: toggle },
      { group: "Stream cards", key: "directorySort", title: "Sort categories", description: "Opens a category in your chosen order instead of Twitch's Recommended. Twitch's sort menu still works as usual.", control: toggle },
      { group: "Stream cards", key: "directorySortBy", title: "Order", description: "How streams in a category are sorted when you open it.", control: { type: "select", options: [{ value: "VIEWER_COUNT", label: "Most viewers" }, { value: "VIEWER_COUNT_ASC", label: "Fewest viewers" }, { value: "RECENT", label: "Recently started" }] }, requires: "directorySort" },
      { group: "Stream cards", key: "cardBadges", title: "Card badges", description: "Small badges on stream thumbnails in directories, from details Twitch already sent.", control: toggle },
      { group: "Stream cards", key: "cardLanguage", title: "Language", description: "The stream's language, e.g. EN or JA.", control: toggle, requires: "cardBadges" },
      { group: "Stream cards", key: "cardDrops", title: "Drops", description: "Marks streams with Drops enabled.", control: toggle, requires: "cardBadges" },
      { group: "Hover previews", key: "hoverPreviews", title: "Hover previews", description: "Hover a live channel in the sidebar for a peek at the stream.", control: toggle },
      { group: "Hover previews", key: "previewMode", title: "Preview", description: "Picture is a fresh thumbnail. Live video plays muted, on sidebar rows and stream cards, but uses more bandwidth and can show an ad first.", control: { type: "select", options: [{ value: "image", label: "Picture" }, { value: "video", label: "Live video" }] }, requires: "hoverPreviews" },
      { group: "Hover previews", key: "previewWidth", title: "Size", description: "How wide the sidebar preview is.", control: { type: "number", min: 200, max: 640, unit: "px" }, requires: "hoverPreviews" },
      { group: "Browse filter", key: "directoryFilter", title: "Filter browse pages", description: "Hides streams you don't want from directories, the front page and the sidebar. You can still open them by link.", control: toggle },
      { group: "Browse filter", key: "filterButtons", title: "Hide buttons on cards", description: "Hover a stream card for buttons that hide its channel or category in one click.", control: toggle, requires: "directoryFilter" },
      { group: "Browse filter", key: "hiddenCategories", title: "Hidden categories", description: "Category names or URL slugs, e.g. \"slots\" or \"just-chatting\".", control: { type: "list", placeholder: "category" }, requires: "directoryFilter" },
      { group: "Browse filter", key: "hiddenTitleWords", title: "Hidden title words", description: "Hides streams whose title contains any of these words. Ignores case and accents.", control: { type: "list", placeholder: "word or phrase" }, requires: "directoryFilter" },
      { group: "Browse filter", key: "hiddenTags", title: "Hidden tags", description: "Hides streams with any of these tags, e.g. \"ASMR\". Works even when the window is too narrow for Twitch to show tags.", control: { type: "list", placeholder: "tag" }, requires: "directoryFilter" },
      { group: "Browse filter", key: "hideReruns", title: "Hide reruns", description: "Hides streams marked as a rerun, by Twitch's badge or the streamer's \"Rerun\" tag.", control: toggle, requires: "directoryFilter" },
    ],
  },
  {
    id: "points",
    label: "Points & drops",
    icon: icons.points,
    drops: true,
    rows: [
      { key: "autoClaim", title: "Auto-claim channel points", description: "Claims the bonus chest after a short random delay. Works in background tabs.", control: toggle },
      { key: "claimMinDelay", title: "Shortest delay", description: "Least time to wait before claiming.", control: { type: "number", min: 0, max: 60, unit: "s" }, requires: "autoClaim" },
      { key: "claimMaxDelay", title: "Longest delay", description: "Most time to wait before claiming.", control: { type: "number", min: 0, max: 120, unit: "s" }, requires: "autoClaim" },
      { key: "claimOnlyVisible", title: "Only in visible tabs", description: "Holds claims until you look at the tab.", control: toggle, requires: "autoClaim" },
      { key: "dropsTracker", title: "Track drop progress", description: "Keeps your drop campaigns' progress up to date while a Twitch tab is open, shown below and in the desktop app. Needs you logged in on twitch.tv.", control: toggle },
      { key: "dropsNotify", title: "Notify when claimable", description: "A desktop notification when a drop is ready to claim. Click it to open your inventory.", control: toggle, requires: "dropsTracker" },
      { key: "primeReminder", title: "Prime sub reminder", description: "Notices when you use your free Prime sub and reminds you 30 days later, when it's free again. Mark it by hand below if it was missed.", control: toggle },
      { key: "dropsClaim", title: "Claim drops", description: "Claims finished drops on your Drops inventory page. No channel-hopping or farming.", control: toggle },
    ],
  },
  {
    id: "data",
    label: "Sync & data",
    icon: icons.data,
    data: true,
    rows: [],
  },
];

// The settings most people actually touch: the panel's "Essentials" view shows only these (search covers everything).
// Child rows that aren't listed simply stay in "Everything".
export const ESSENTIAL = new Set<SettingKey>([
  // Live + auto-open
  "favorites", "pinFavorites", "notifyLive", "notifyQuietHours", "notifyQuietStart", "notifyQuietEnd", "notifyMutedChannels", "liveBadge", "sidebarPlus", "sidebarSort",
  "autoOpen", "autoOpenMax", "autoOpenMuted", "raidAction",
  // Player
  "clickToPause", "wheelVolume", "hotkeys", "cinema", "cinemaChat", "channelPrefs", "adMute", "autoRecover", "screenshotButton", "pipButton", "flashbang",
  // Stats
  "channelStatsButton", "streamStats", "watchTime", "latencyReducer", "predictionAlerts",
  // Chat
  "chatHighlight", "nicknames", "messageMenu", "replyPreview", "mentionSound", "botFilter", "chatMute",
  // Browsing + declutter
  "hoverPreviews", "cardBadges", "directoryFilter", "filterButtons", "hiddenCategories", "hideStories", "stopHomeAutoplay",
  // Points & drops
  "autoClaim", "dropsTracker", "dropsNotify", "primeReminder",
]);
