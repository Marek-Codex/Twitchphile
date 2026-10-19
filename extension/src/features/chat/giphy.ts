// Tames Giphy messages with CSS alone (:has), so no per-message JS runs.
import type { Feature } from "../../core/feature";
import { settings } from "../../core/settings";
import { injectStyle } from "../../core/util";

const GIF = '[data-a-target="chat-line-message-body"] img[class*="gifImage--"]';
const MODE_STYLE = {
  hide: `.chat-line__message:has(${GIF}){display:none!important}`,
  mini: `${GIF}{max-height:28px!important;width:auto!important;border-radius:4px;outline:1px solid rgba(60,160,255,.35);
cursor:zoom-in;transition:max-height .2s ease}
${GIF}:hover{max-height:240px!important}`,
};

export const giphyFilter: Feature = {
  key: "giphyFilter",
  start() {
    const style = injectStyle(MODE_STYLE[settings.get().giphyMode]);
    const off = settings.onChange((c) => "giphyMode" in c && (style.textContent = MODE_STYLE[settings.get().giphyMode]));
    return () => (off(), style.remove());
  },
};
