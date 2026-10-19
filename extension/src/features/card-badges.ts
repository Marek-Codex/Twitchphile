// Small badges on stream cards: the stream's language ("EN", "JA"…) and whether Drops are enabled.
// Both come from Twitch's own data (tags it already sent — see sniff.ts), with the card's visible tags and title
// as a fallback; nothing extra is requested.
import { onDom } from "../core/dom";
import type { Feature } from "../core/feature";
import { settings } from "../core/settings";
import { hasDrops, languageOf, onStreams, streamTags } from "../core/streams";
import { throttle } from "../core/throttle";
import { injectStyle } from "../core/util";

const CARD_CHANNEL = 'a[data-a-target="preview-card-channel-link"]';
const CARD_IMAGE = 'a[data-a-target="preview-card-image-link"]';
const CARD_TAG = 'button[aria-label^="Tag, "]';
const DROPS_TITLE = /\bdrops?\s*(on|enabled|active)\b|\[drops/i;
const BADGES = "tp-card-badges";

const STYLE = `.${BADGES}{position:absolute;right:6px;bottom:6px;z-index:2;display:flex;gap:4px;pointer-events:none}
.${BADGES} span{padding:1px 5px;border-radius:3px;background:rgba(10,13,18,.82);color:#F2F7FF;
font:700 10px/16px var(--font-base,sans-serif);letter-spacing:.04em}
.${BADGES} .drops{background:#3CA0FF;color:#041018}`;

export const cardBadges: Feature = {
  key: "cardBadges",
  start() {
    const style = injectStyle(STYLE);

    const scan = () => {
      const { cardLanguage, cardDrops } = settings.get();
      document.querySelectorAll("article").forEach((card) => {
        const host = card.querySelector(CARD_IMAGE)?.parentElement;
        if (!host) return;
        const login = card.querySelector(CARD_CHANNEL)?.getAttribute("href")?.split("/").filter(Boolean)[0] ?? "";
        const tags = [
          ...(streamTags(login) ?? []),
          ...[...card.querySelectorAll(CARD_TAG)].map((t) => t.getAttribute("aria-label")!.slice(5)),
        ];
        const title = card.querySelector("h4[title], h3[title]")?.getAttribute("title") ?? "";
        const lang = cardLanguage ? languageOf(tags) : null;
        const drops = cardDrops && (hasDrops(tags) || DROPS_TITLE.test(title));
        const sig = `${lang ?? ""}|${drops}`;

        let bar = host.querySelector<HTMLElement>(`:scope > .${BADGES}`);
        if (bar?.dataset.sig === sig) return; // unchanged: leave the DOM alone
        if (!lang && !drops) return void bar?.remove();
        if (!bar) {
          bar = document.createElement("div");
          bar.className = BADGES;
          if (!host.style.position) host.style.position = "relative";
          host.append(bar);
        }
        bar.dataset.sig = sig;
        bar.innerHTML = (drops ? '<span class="drops">DROPS</span>' : "") + (lang ? `<span>${lang}</span>` : "");
      });
    };

    // Cards change slowly: at most one pass every 500ms.
    const pass = throttle(scan, 500);
    const stopDom = onDom(pass.request);
    const offStreams = onStreams(pass.request);
    const offSettings = settings.onChange((c) => ("cardLanguage" in c || "cardDrops" in c) && pass.now());

    return () => {
      stopDom();
      offStreams();
      offSettings();
      pass.cancel();
      style.remove();
      document.querySelectorAll(`.${BADGES}`).forEach((e) => e.remove());
    };
  },
};
