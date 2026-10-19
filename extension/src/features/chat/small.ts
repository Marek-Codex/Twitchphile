// Small chat conveniences: hover a @mention to spotlight that user; right-click an emote to copy its name.
import { listen, type Feature } from "../../core/feature";
import { toast } from "../../core/toast";
import { injectStyle } from "../../core/util";

const MENTION = '[data-a-target="chat-message-mention"], .chat-line__message-mention';
const SPOT = "tp-spot";

export const mentionSpotlight: Feature = {
  key: "mentionSpotlight",
  start() {
    const style = injectStyle(`.chat-line__message.${SPOT}{background:rgba(60,160,255,.16)!important;box-shadow:inset 2px 0 #3CA0FF}`);
    const clear = () => document.querySelectorAll(`.${SPOT}`).forEach((el) => el.classList.remove(SPOT));

    const offOver = listen("mouseover", (e) => {
      const login = (e.target as Element).closest?.(MENTION)?.textContent?.trim().replace(/^@/, "").toLowerCase();
      if (!login) return;
      document
        .querySelectorAll(`.chat-line__message [data-a-user="${CSS.escape(login)}"]`)
        .forEach((a) => a.closest(".chat-line__message")?.classList.add(SPOT));
    });
    const offOut = listen("mouseout", (e) => (e.target as Element).closest?.(MENTION) && clear());
    return () => (offOver(), offOut(), clear(), style.remove());
  },
};

export const copyEmote: Feature = {
  key: "copyEmote",
  start() {
    return listen("contextmenu", (e) => {
      const img = (e.target as Element).closest?.<HTMLImageElement>(".chat-line__message img.chat-line__message--emote");
      if (!img?.alt) return;
      e.preventDefault();
      navigator.clipboard.writeText(img.alt).then(() => toast(`Copied ${img.alt}`, e.clientX, e.clientY));
    });
  },
};

// Twitch crops the "Replying to @user: …" line to one line but keeps the whole message in the element, so this is
// CSS only: up to three lines, all of it while you hover the message.
export const replyPreview: Feature = {
  key: "replyPreview",
  start() {
    const style = injectStyle(`.chat-line__message p[title]{white-space:normal!important;text-overflow:clip!important;
display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere}
.chat-line__message:hover p[title]{-webkit-line-clamp:unset}`);
    return () => style.remove();
  },
};
