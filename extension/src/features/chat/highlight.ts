// Highlights messages from chosen users or containing chosen keywords.
import { onChat } from "../../core/chat";
import type { Feature } from "../../core/feature";
import { settings } from "../../core/settings";
import { injectStyle, lowerSet, wordRegex } from "../../core/util";

const CLS = "tp-hl";
const STYLE = `
.tp-line.${CLS}{position:relative;background:rgba(60,160,255,.10)!important}
.tp-line.${CLS}::before{content:"";position:absolute;left:0;top:2px;bottom:2px;width:2px;border-radius:2px;background:#3CA0FF}`;

export const chatHighlight: Feature = {
  key: "chatHighlight",
  sites: ["twitch", "kick"],
  start() {
    const style = injectStyle(STYLE);
    let users = new Set<string>();
    let words: RegExp | null = null;
    const compile = () => {
      users = lowerSet(settings.get().highlightUsers);
      words = wordRegex(settings.get().highlightKeywords);
    };
    compile();

    const offSettings = settings.onChange((c) => ("highlightUsers" in c || "highlightKeywords" in c) && compile());
    const offChat = onChat(({ el, login, text }) => el.classList.toggle(CLS, users.has(login) || Boolean(words?.test(text))));

    return () => {
      offChat();
      offSettings();
      style.remove();
      document.querySelectorAll(`.${CLS}`).forEach((el) => el.classList.remove(CLS));
    };
  },
};
