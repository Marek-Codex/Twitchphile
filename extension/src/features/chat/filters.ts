// Chat hygiene: dim/hide bots, keep username colors readable, mute users/words, chime on keywords.
import { onChat } from "../../core/chat";
import { readable } from "../../core/color";
import type { Feature } from "../../core/feature";
import { settings } from "../../core/settings";
import { injectStyle, lowerSet, wordRegex } from "../../core/util";
import { onKick } from "../../core/site";
import { chimeOn } from "./mention-sound";

const KNOWN_BOTS = ["nightbot", "streamelements", "streamlabs", "moobot", "fossabot", "wizebot", "soundalerts", "sery_bot", "botrixoficial", "kofistreambot", "pokemoncommunitygame", "streamstickers"];
const BOT_STYLE = {
  dim: ".tp-line.tp-bot{opacity:.45;transition:opacity .15s ease}.tp-line.tp-bot:hover{opacity:1}",
  // (On Kick, whose chat rows sit at fixed positions, a hidden message leaves its line empty rather than closing up.)
  hide: ".tp-line.tp-bot{visibility:hidden!important}.chat-line__message.tp-line.tp-bot{display:none!important}",
};

export const botFilter: Feature = {
  key: "botFilter",
  sites: ["twitch", "kick"],
  start() {
    const style = injectStyle(BOT_STYLE[settings.get().botMode]);
    let bots = new Set<string>();
    const compile = () => (bots = lowerSet([...KNOWN_BOTS, ...settings.get().botUsers]));
    compile();
    const offChat = onChat(({ el, login }) => el.classList.toggle("tp-bot", bots.has(login)));
    const offSettings = settings.onChange((c) => {
      if ("botMode" in c) style.textContent = BOT_STYLE[settings.get().botMode];
      if ("botUsers" in c) compile();
    });
    return () => (offChat(), offSettings(), style.remove(), document.querySelectorAll(".tp-bot").forEach((e) => e.classList.remove("tp-bot")));
  },
};

const readableCache = new Map<string, string>(); // original color + theme → adjusted
function cachedReadable(color: string, dark: boolean) {
  const key = color + dark;
  let out = readableCache.get(key);
  if (!out) readableCache.set(key, (out = readable(color, dark)));
  return out;
}

// Twitch marks its dark theme on <html>; Kick is dark unless it says otherwise.
const darkPage = () => {
  const html = document.documentElement;
  return onKick ? !html.classList.contains("light") : html.classList.contains("tw-root--theme-dark");
};

export const readableNames: Feature = {
  key: "readableNames",
  sites: ["twitch", "kick"],
  start() {
    const offChat = onChat(({ name, login }) => {
      if (!name?.style.color) return;
      // Kick reuses rows for other people's messages: forget the color remembered for someone else.
      if (name.dataset.tpColorOf !== login) (name.dataset.tpColor = name.style.color), (name.dataset.tpColorOf = login);
      name.style.color = cachedReadable(name.dataset.tpColor!, darkPage());
    });
    return () => {
      offChat();
      document.querySelectorAll<HTMLElement>("[data-tp-color]").forEach((n) => (n.style.color = n.dataset.tpColor!));
    };
  },
};

export const chatMute: Feature = {
  key: "chatMute",
  sites: ["twitch", "kick"],
  start() {
    const style = injectStyle(".tp-line.tp-muted{visibility:hidden!important}.chat-line__message.tp-line.tp-muted{display:none!important}");
    let users = new Set<string>();
    let words: RegExp | null = null;
    const compile = () => {
      users = lowerSet(settings.get().muteUsers);
      words = wordRegex(settings.get().muteWords);
    };
    compile();
    const offChat = onChat(({ el, login, text }) => el.classList.toggle("tp-muted", users.has(login) || Boolean(words?.test(text))));
    const offSettings = settings.onChange((c) => ("muteUsers" in c || "muteWords" in c) && compile());
    return () => (offChat(), offSettings(), style.remove(), document.querySelectorAll(".tp-muted").forEach((e) => e.classList.remove("tp-muted")));
  },
};

// Chimes when a message contains one of your highlight keywords.
export const keywordAlerts: Feature = {
  key: "keywordAlerts",
  sites: ["twitch", "kick"],
  start() {
    let words = wordRegex(settings.get().highlightKeywords);
    const offSettings = settings.onChange((c) => "highlightKeywords" in c && (words = wordRegex(settings.get().highlightKeywords)));
    const offChat = chimeOn((text) => Boolean(words?.test(text)) && (!settings.get().mentionOnlyHidden || document.hidden), 3000);
    return () => (offChat(), offSettings());
  },
};
