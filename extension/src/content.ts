// Content script: the front door. Loads settings, runs every feature (each gated by its own setting),
// and wires up the panel entry point. If a feature's switch is off, it never even loads — a disabled
// feature costs nothing, which is the whole point.
import { platform } from "@platform";
import { runFeatures } from "./core/feature";
import { onKick } from "./core/site";
import { kickFollows } from "./features/kick-follows";
import { settings } from "./core/settings";
import { botFilter, chatMute, keywordAlerts, readableNames } from "./features/chat/filters";
import { giphyFilter } from "./features/chat/giphy";
import { chatHighlight } from "./features/chat/highlight";
import { chatImages } from "./features/chat/images";
import { mentionSound } from "./features/chat/mention-sound";
import { messageMenu } from "./features/chat/message-menu";
import { nicknames } from "./features/chat/nicknames";
import { copyEmote, mentionSpotlight, replyPreview } from "./features/chat/small";
import { grayscale, hideBitsGifts, hideHypeTrain, hidePrime, hideSubPromos } from "./features/declutter";
import { directoryFilter, hideExtensions, hideHighlights, hideLeaderboard, hideStories, skipWarnings, stopHomeAutoplay, directorySort } from "./features/declutter";
import { hoverPreviews } from "./features/previews";
import { cardBadges } from "./features/card-badges";
import { adMute, tabAutoMute } from "./features/player/audio";
import { channelPrefs } from "./features/player/channel-prefs";
import { cinema } from "./features/player/cinema";
import { clickToPause } from "./features/player/click-to-pause";
import { clipDownload } from "./features/player/clip-download";
import { hotkeys } from "./features/player/hotkeys";
import { keepQuality } from "./features/player/keep-quality";
import { realTime } from "./features/player/real-time";
import { autoRecover } from "./features/player/recover";
import { pipButton, screenshotButton } from "./features/player/screenshot";
import { flashbang } from "./features/player/flashbang";
import { predictionAlerts } from "./features/stream/predictions";
import { wheelVolume } from "./features/player/wheel-volume";
import { autoClaim } from "./features/presence/auto-claim";
import { dropsClaim } from "./features/presence/drops";
import { dropsTracker } from "./features/presence/drops-tracker";
import { primeReminder } from "./features/presence/prime";
import { pinFavorites } from "./features/presence/favorites";
import { sidebarPlus } from "./features/presence/sidebar";
import { applyLurk } from "./features/presence/lurk";
import { chatterCount } from "./features/stream/chatters";
import { latencyReducer } from "./features/stream/latency-reducer";
import { streamStats } from "./features/stream/stats";
import { channelStatsButton } from "./features/stream/stats-button";
import { watchTime } from "./features/stream/watchtime";
import { startUi, stopUi } from "./ui/entry";

settings.load().then(() => {
  if (onKick) kickFollows();
  const stopAll = runFeatures([
    // Player
    clickToPause, wheelVolume, hotkeys, channelPrefs, cinema, keepQuality, tabAutoMute, adMute, autoRecover, realTime, clipDownload, screenshotButton, pipButton, flashbang,
    // Stream
    streamStats, channelStatsButton, chatterCount, latencyReducer, watchTime, predictionAlerts,
    // Chat + filters
    chatHighlight, messageMenu, nicknames, mentionSpotlight, copyEmote, replyPreview, chatImages, keywordAlerts, mentionSound,
    botFilter, readableNames, chatMute, giphyFilter,
    // Presence
    pinFavorites, sidebarPlus, autoClaim, dropsClaim, dropsTracker, primeReminder, hoverPreviews, cardBadges,
    // Declutter
    hideStories, hideExtensions, hideLeaderboard, hideHighlights, hidePrime, hideBitsGifts, hideHypeTrain, hideSubPromos, grayscale, directoryFilter, directorySort, stopHomeAutoplay, skipWarnings,
  ]);
  startUi();
  applyLurk();

  // Extension reloaded/updated while this tab stayed open: shut down cleanly instead of throwing.
  const watchdog = setInterval(() => {
    if (platform.alive()) return;
    clearInterval(watchdog);
    stopAll();
    stopUi();
  }, 3000);
});
