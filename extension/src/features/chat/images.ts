// Inline previews for direct image links in chat. Opt-in. In hover mode nothing is fetched until
// you hover the message (loading an image reveals your IP to its host).
import { onChat } from "../../core/chat";
import type { Feature } from "../../core/feature";
import { settings } from "../../core/settings";
import { injectStyle } from "../../core/util";

const IMG_LINK = /^https:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s]*)?$/i;
const CLS = "tp-img";

export const chatImages: Feature = {
  key: "chatImages",
  start() {
    const css = () => {
      const { chatImageSize: h, chatImagesHover: hover } = settings.get();
      return `.${CLS}{display:block;max-width:100%;max-height:${h}px;margin:4px 0;border-radius:4px;
outline:1px solid var(--color-border-base)}${hover ? `.${CLS}{display:none}.chat-line__message:hover .${CLS}{display:block}` : ""}`;
    };
    const style = injectStyle(css());

    const load = (img: HTMLImageElement) => img.dataset.src && ((img.src = img.dataset.src), delete img.dataset.src);

    const offChat = onChat(({ el }) => {
      if (el.querySelector(`.${CLS}`)) return;
      const link = [...el.querySelectorAll<HTMLAnchorElement>('[data-a-target="chat-line-message-body"] a[href]')].find((a) =>
        IMG_LINK.test(a.href),
      );
      if (!link) return;
      const img = document.createElement("img");
      img.className = CLS;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.dataset.src = link.href;
      img.addEventListener("error", () => img.remove());
      link.closest('[data-a-target="chat-line-message-body"]')?.append(img);
      if (settings.get().chatImagesHover) el.addEventListener("mouseenter", () => load(img), { once: true });
      else load(img);
    });
    const offSettings = settings.onChange((c) => {
      if (!("chatImageSize" in c || "chatImagesHover" in c)) return;
      style.textContent = css();
      if (!settings.get().chatImagesHover) document.querySelectorAll<HTMLImageElement>(`.${CLS}`).forEach(load);
    });

    return () => {
      offChat();
      offSettings();
      style.remove();
      document.querySelectorAll(`.${CLS}`).forEach((el) => el.remove());
    };
  },
};
