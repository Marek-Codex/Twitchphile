// Declutter: CSS-only hides, browse-page filtering, homepage autoplay, content-warning gates.
import { onDom } from "../core/dom";
import { listen, type Feature } from "../core/feature";
import { settings, type SettingKey } from "../core/settings";
import { onKick } from "../core/site";
import { onStreams, streamTags } from "../core/streams";
import { throttle } from "../core/throttle";
import { toast } from "../core/toast";
import { fold, injectStyle, lowerSet, toggleIn, wordRegex } from "../core/util";
import { hide as hideIcon, svg } from "../ui/icons";

// A CSS-only switch. Given Kick CSS too, the same switch works on Kick (one toggle, both sites).
const cssFeature = (key: SettingKey, css: string, kickCss?: string): Feature => ({
  key,
  sites: kickCss ? ["twitch", "kick"] : ["twitch"],
  start() {
    const style = injectStyle(onKick ? kickCss! : css);
    return () => style.remove();
  },
});

// Sidebar Stories rail and the "save your streak" row.
export const hideStories = cssFeature(
  "hideStories",
  '#side-nav div[class*="storiesLeftNavSection"],#side-nav [class*="saveYourStreakSideNavRow"]{display:none!important}',
);

// Streamer-installed Twitch extensions: video overlays, the dock and panel iframes.
export const hideExtensions = cssFeature(
  "hideExtensions",
  '[class*="extensions-video-overlay"],[class*="extensions-dock"],[class*="extension-taskbar"],.extension-view__iframe,[class*="extension-view"]{display:none!important}',
);

export const hideLeaderboard = cssFeature(
  "hideLeaderboard",
  'div:has(> button > [class*="channelLeaderboard"]){display:none!important}',
  // Kick: the KICKs leaderboard strip above chat.
  'div:has(> div > button[aria-label="Expand leaderboard"]){display:none!important}',
);

// Monetisation nudges, by Twitch's stable attributes (not generated class names, which change every deploy).
export const hidePrime = cssFeature("hidePrime", ".top-nav__prime,[data-a-target=\"prime-offers-icon\"]{display:none!important}");
export const hideBitsGifts = cssFeature(
  "hideBitsGifts",
  'div:has(> button[data-a-target="top-nav-get-bits-button"]),button[data-a-target="gift-button"],button[data-a-target="bits-button"]{display:none!important}',
  // Kick: the KICKs gift shop button beside the chat box.
  'span:has(> button[data-testid="gift-shop-button"]){display:none!important}',
);
export const hideHypeTrain = cssFeature(
  "hideHypeTrain",
  '[class*="hypeTrainBanner"],[aria-label="Chat Happening Now Overlay"]:has([class*="hypeTrain"]),#side-nav div:has(> .hype-train-icon){display:none!important}',
);
export const hideSubPromos = cssFeature(
  "hideSubPromos",
  '[aria-label="Gift sub discount promotion"],[class*="giftExpirationCallout"],#side-nav div:has(> div[aria-label="Gift Sub"]){display:none!important}',
  // Kick: the "watch 1080p free for 60 seconds" offer on the player (picked out by its HD icon, whatever the
  // language), and the pill version on phone layouts.
  '#injected-channel-player div.bottom-5.z-player:has(path[d*="M13.33 7.5h-.83v5h"]),[role="dialog"]:has(path[d*="M13.33 7.5h-.83v5h"]){display:none!important}',
);
// Wellbeing: the whole page in grayscale, which makes it markedly less grabby.
export const grayscale = cssFeature("grayscale", "html{filter:grayscale(1)!important}", "html{filter:grayscale(1)!important}");

// Pinned highlight stack above chat: hype trains, sub drops, community goals.
export const hideHighlights = cssFeature("hideHighlights", '[class*="community-highlight-stack"]{display:none!important}');

// Hides stream cards / category tiles you don't want (browse pages, front page, sidebar): by channel, category,
// title words, tags, or reruns. Hides the outermost wrapper holding only that card, so grids reflow without gaps.
// Optional hover buttons on stream cards hide a channel or category in one click.
const HIDDEN = "tp-dir-hidden";
const BTNS = "tp-dir-btns";
const outer = (el: Element) => {
  // Walk up to the element whose parent is a grid/flex container — THAT element
  // is the grid ITEM, and hiding it (display:none) collapses the cell so the
  // grid reflows with no gap. The old "parent has exactly one child" heuristic
  // stopped too early whenever a cell held the card plus a sibling, hiding only
  // the card and leaving an empty cell behind.
  let e = el;
  for (let depth = 0; depth < 8; depth++) {
    const p = e.parentElement;
    if (!p || p === document.body || p.tagName === "MAIN") break;
    const d = getComputedStyle(p).display;
    if (d === "grid" || d === "inline-grid" || d === "flex" || d === "inline-flex") break;
    e = p;
  }
  return e;
};
const slug = (href: string | null | undefined) => href?.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
const SIDEBAR_CHANNELS_TWITCH = ["followed-channel", "recommended-channel", "similarity-channel"]
  .map((t) => `#side-nav a[data-test-selector="${t}"]`)
  .join(",");
// Where things are on each site's browse pages. Twitch: <article> cards. Kick: livestream cards (data-testid).
const firstSegment = (href: string | null | undefined) => href?.split(/[?#]/)[0].split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
const LAYOUT = onKick
  ? {
      cards: '[data-testid="livestream-results-card"]',
      channel: (card: Element) => firstSegment(card.querySelector('a[title][href^="/"]:not([href*="/videos/"]):not([href^="/category/"])')?.getAttribute("href")),
      game: (card: Element) => card.querySelector<HTMLAnchorElement>('a[href^="/category/"]'),
      // The title is the longest title attribute on the card (the channel link has one too: its name).
      title: (card: Element) => [...card.querySelectorAll("a[title]")].map((a) => a.getAttribute("title") ?? "").sort((x, y) => y.length - x.length)[0] ?? "",
      image: (card: Element) => card.querySelector('[data-testid="media-card-thumbnail"]')?.parentElement,
      categoryTiles: 'a[href^="/category/"]',
      sidebar: 'a[data-testid^="sidebar-"][data-testid*="channel"]',
    }
  : {
      cards: "article",
      channel: (card: Element) => slug(card.querySelector('a[data-a-target="preview-card-channel-link"], a[data-a-target="preview-card-image-link"]')?.getAttribute("href")),
      game: (card: Element) => card.querySelector<HTMLAnchorElement>('a[data-a-target="preview-card-game-link"]'),
      title: (card: Element) => card.querySelector("h4[title], h3[title]")?.getAttribute("title") ?? "",
      image: (card: Element) => card.querySelector('a[data-a-target="preview-card-image-link"]')?.parentElement,
      categoryTiles: 'a[href^="/directory/category/"]',
      sidebar: SIDEBAR_CHANNELS_TWITCH,
    };
// Categories compare without case, accents, punctuation or "and": "Slots & Casino" = /category/slots-and-casino.
const catKey = (s: string) => fold(s).replace(/\band\b/g, "").replace(/[^a-z0-9]/g, "");

const CARD_TAG = 'button[aria-label^="Tag, "]'; // aria-label is "Tag, <name>"
const CARD_STATUS = '[class*="StatusTextIndicator"]'; // the corner badge: LIVE / RERUN
// Twitch's badge still says LIVE for most reruns; streamers mark them with a "Rerun"/"reruns" tag instead.
const RERUN = /^re-?runs?$/;

const STYLE = `.${HIDDEN}{display:none!important}
.${BTNS}{position:absolute;top:6px;right:6px;z-index:3;display:none;gap:4px}
article:hover .${BTNS},[data-testid="livestream-results-card"]:hover .${BTNS}{display:flex}
.${BTNS} button{display:flex;align-items:center;gap:4px;height:24px;padding:0 8px;border:0;border-radius:4px;cursor:pointer;
background:rgba(10,13,18,.85);color:#F2F7FF;font:600 11px var(--font-base,sans-serif);backdrop-filter:blur(4px)}
.${BTNS} button:hover{background:#3CA0FF;color:#041018}`;

export const directoryFilter: Feature = {
  key: "directoryFilter",
  sites: ["twitch", "kick"],
  start() {
    const style = injectStyle(STYLE);
    const hide = (el: Element, on: boolean) => outer(el).classList.toggle(HIDDEN, on);
    const unhideAll = () => document.querySelectorAll(`.${HIDDEN}`).forEach((e) => e.classList.remove(HIDDEN));
    const removeButtons = () => document.querySelectorAll(`.${BTNS}`).forEach((e) => e.remove());

    // Compiled once per settings change, not per scan.
    let rules = compile();
    function compile() {
      const s = settings.get();
      return {
        channels: lowerSet(s.hiddenChannels),
        cats: new Set(s.hiddenCategories.map(catKey).filter(Boolean)),
        words: wordRegex(s.hiddenTitleWords.map(fold)),
        tags: new Set(s.hiddenTags.map((t) => fold(t.trim())).filter(Boolean)),
        reruns: s.hideReruns,
        buttons: s.filterButtons,
      };
    }

    function addButtons(card: Element, channel: string, category: string, categoryName: string) {
      const host = LAYOUT.image(card) as HTMLElement | null | undefined;
      if (!host || host.querySelector(`:scope > .${BTNS}`)) return;
      const bar = document.createElement("div");
      bar.className = BTNS;
      const btn = (label: string, title: string, run: () => void) => {
        const b = document.createElement("button");
        b.type = "button";
        b.title = b.ariaLabel = title;
        b.innerHTML = `${svg(hideIcon, 12)}<span>${label}</span>`;
        b.addEventListener("click", (e) => {
          e.preventDefault(); // the button sits over the card's link
          e.stopPropagation();
          run();
          toast("Hidden — undo in Twitchphile › Declutter", e.clientX, e.clientY);
        });
        bar.append(b);
      };
      if (channel) btn("Channel", `Hide ${channel}`, () => settings.set({ hiddenChannels: toggleIn(settings.get().hiddenChannels, channel) }));
      if (category) btn("Category", `Hide ${categoryName || category}`, () => settings.set({ hiddenCategories: toggleIn(settings.get().hiddenCategories, category) }));
      if (!host.style.position) host.style.position = "relative";
      host.append(bar);
    }

    const scan = () => {
      const { channels, cats, words, tags, reruns, buttons } = rules;
      const filtering = channels.size || cats.size || words || tags.size || reruns;
      if (!filtering) unhideAll();
      if (!buttons) removeButtons();
      if (!filtering && !buttons) return;

      document.querySelectorAll(LAYOUT.cards).forEach((card) => {
        const ch = LAYOUT.channel(card);
        const game = LAYOUT.game(card);
        const cat = slug(game?.getAttribute("href"));
        const catName = game?.textContent?.trim() ?? "";
        if (buttons) addButtons(card, ch, cat, catName);
        if (!filtering) return;
        const title = LAYOUT.title(card);
        // Tags from Twitch's own data (see sniff.ts) cover cards whose tags the layout hides; the card's own are a fallback.
        const cardTags = tags.size || reruns
          ? [...(streamTags(ch) ?? []), ...[...card.querySelectorAll(CARD_TAG)].map((t) => t.getAttribute("aria-label")!.slice(5))].map(fold)
          : [];
        const rerun = reruns && (/rerun/i.test(card.querySelector(CARD_STATUS)?.textContent ?? "") || cardTags.some((t) => RERUN.test(t)));
        const tagged = cardTags.some((t) => tags.has(t));
        const hiddenCat = cats.has(catKey(cat)) || (catName !== "" && cats.has(catKey(catName)));
        hide(card, channels.has(ch) || hiddenCat || rerun || tagged || Boolean(words?.test(fold(title))));
      });
      if (!filtering) return;
      document.querySelectorAll(LAYOUT.categoryTiles).forEach((a) => {
        if (!a.closest(LAYOUT.cards)) hide(a, cats.has(catKey(slug(a.getAttribute("href")))));
      });
      document.querySelectorAll(LAYOUT.sidebar).forEach((a) => hide(a, channels.has(firstSegment(a.getAttribute("href")))));
    };
    // Card grids don't change fast: at most every 500ms (busy chats tick onDom every frame).
    const pass = throttle(scan, 500);
    const stopDom = onDom(pass.request);
    const KEYS = ["hiddenChannels", "hiddenCategories", "hiddenTitleWords", "hiddenTags", "hideReruns", "filterButtons"];
    const offSettings = settings.onChange((c) => {
      if (!KEYS.some((k) => k in c)) return;
      rules = compile();
      pass.now();
    });
    // Tag data can land after the cards render; recheck.
    const offStreams = onStreams(() => (rules.tags.size || rules.reruns) && pass.request());
    return () => (stopDom(), offSettings(), offStreams(), pass.cancel(), style.remove(), unhideAll(), removeButtons());
  },
};

export const stopHomeAutoplay: Feature = {
  key: "stopHomeAutoplay",
  start() {
    const done = new WeakSet<HTMLVideoElement>();
    return onDom(() => {
      if (location.pathname !== "/") return;
      const v = document.querySelector<HTMLVideoElement>('[data-a-target="featured-item-video"] video, [data-test-selector="featured-item-video"] video');
      if (!v || done.has(v)) return;
      done.add(v);
      v.muted = true;
      v.pause();
      v.addEventListener("play", () => v.pause(), { once: true }); // Twitch retries play() once as the player settles
    });
  },
};

// Opt-in: clicks through Twitch's mature / content-classification gates.
const GATES = [
  'button[data-a-target="content-classification-gate-overlay-start-watching-button"]',
  'button[data-a-target="player-overlay-mature-accept"]',
].join(",");

export const skipWarnings: Feature = {
  key: "skipWarnings",
  start: () => onDom(() => document.querySelector<HTMLButtonElement>(GATES)?.click()),
};

// Opens categories in your preferred order instead of Twitch's "Recommended". Twitch honors a ?sort= parameter,
// so a plain click on a category link is handed to Twitch's own router with it added: no reload, and Twitch's
// sort menu shows the choice (change it there any time). Links that already name a sort are left alone.
export const directorySort: Feature = {
  key: "directorySort",
  start() {
    return listen("click", (e) => {
      const order = settings.get().directorySortBy;
      const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href^="/directory/category/"]');
      if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const url = new URL(a.href);
      if (url.searchParams.has("sort") || /\/(videos|clips)/.test(url.pathname)) return;
      url.searchParams.set("sort", order);
      e.preventDefault();
      e.stopPropagation();
      history.pushState(history.state, "", url.pathname + url.search);
      dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    });
  },
};
