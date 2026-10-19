// Hover previews: hover a live channel in the sidebar for a peek at the stream — a fresh thumbnail, or the live
// video (muted) via Twitch's own embed. In video mode, directory cards also play live in place of their thumbnail.
// Nothing loads until you've hovered for a moment, and the video is torn down the instant you leave.
import { listen, type Feature } from "../core/feature";
import { settings } from "../core/settings";
import { onKick } from "../core/site";
import { injectStyle } from "../core/util";

const DELAY_MS = 350; // long enough that sweeping the mouse across the sidebar loads nothing
// Kick: sidebar channel rows carry a data-testid; live stream cards link their thumbnail to /<channel> (VODs to /videos/).
const SIDEBAR = onKick ? 'a[data-testid^="sidebar-"][data-testid*="channel"]' : "#side-nav a[data-test-selector]";
const LIVE_STATUS = '[data-a-target="side-nav-live-status"]';
const CARD_IMAGE = onKick
  ? '[data-testid="livestream-results-card"] a[data-testid="media-card-thumbnail"]:not([href*="/videos/"])'
  : 'article a[data-a-target="preview-card-image-link"]';
const POP = "tp-preview";
const INLINE = "tp-preview-inline";

const STYLE = `
#${POP}{position:fixed;z-index:10000;pointer-events:none;border-radius:6px;overflow:hidden;background:#000;
border:1px solid var(--color-border-base,#2a2f37);box-shadow:0 8px 24px rgba(0,0,0,.5);opacity:0;transform:translateX(-4px);
transition:opacity .12s ease,transform .12s ease}
#${POP}.on{opacity:1;transform:none}
#${POP} img,#${POP} iframe{display:block;width:100%;aspect-ratio:16/9;border:0;background:#0A0D12}
#${POP} .cap{padding:6px 8px;font:600 12px var(--font-base,sans-serif);color:var(--color-text-base,#eef2f6);background:var(--color-background-base,#14171c);
white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#${POP} .cap span{color:var(--color-text-alt-2,#8b95a3);font-weight:500}
html.tp-previewing .tw-dialog-layer:has(.online-side-nav-channel-tooltip__body){display:none!important}
.${INLINE}{position:absolute;inset:0;width:100%;height:100%;border:0;z-index:2;pointer-events:none;background:#000}`;

const loginOf = (a: Element) => a.getAttribute("href")?.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
const isLive = (row: Element) => {
  // Kick shows a viewer count (a number with a title) only on live rows.
  if (onKick) return Boolean(row.querySelector("span[title]")?.getAttribute("title")?.match(/^\d+$/));
  const status = row.querySelector(LIVE_STATUS);
  return Boolean(status) && !/offline/i.test(status!.textContent ?? "");
};

function embed(login: string, className?: string) {
  const f = document.createElement("iframe");
  if (className) f.className = className;
  f.allow = "autoplay";
  f.src = onKick
    ? `https://player.kick.com/${encodeURIComponent(login)}?muted=true&autoplay=true`
    : `https://player.twitch.tv/?channel=${encodeURIComponent(login)}&parent=${location.hostname}&muted=true&autoplay=true&controls=false`;
  return f;
}

// Kick has no thumbnail URL to build from a name: ask its channel data (same site, so no extra permissions), cached briefly.
const kickThumbs = new Map<string, { at: number; url: Promise<string | null> }>();
function kickThumb(login: string) {
  const hit = kickThumbs.get(login);
  if (hit && Date.now() - hit.at < 60_000) return hit.url;
  const url = fetch(`/api/v2/channels/${encodeURIComponent(login)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d?.livestream?.thumbnail?.url as string | undefined) ?? null)
    .catch(() => null);
  kickThumbs.set(login, { at: Date.now(), url });
  return url;
}

export const hoverPreviews: Feature = {
  key: "hoverPreviews",
  sites: ["twitch", "kick"],
  start() {
    const style = injectStyle(STYLE);
    let target: Element | null = null; // the row/card under the mouse
    let timer = 0;
    let pop: HTMLDivElement | null = null;
    let inline: HTMLIFrameElement | null = null;

    function close() {
      clearTimeout(timer);
      target = null;
      pop?.remove(); // removing the iframe stops the stream
      pop = null;
      inline?.remove();
      inline = null;
      document.documentElement.classList.remove("tp-previewing");
    }

    function showSidebar(row: HTMLElement) {
      const login = loginOf(row);
      if (!login) return;
      const { previewMode, previewWidth } = settings.get();
      pop = document.createElement("div");
      pop.id = POP;
      pop.style.width = `${previewWidth}px`;
      if (previewMode === "video") pop.append(embed(login));
      else {
        const img = document.createElement("img");
        img.alt = "";
        if (onKick) {
          const card = pop;
          kickThumb(login).then((u) => (u && pop === card ? (img.src = u) : img.remove()));
        } else {
          const w = Math.round(previewWidth * devicePixelRatio);
          // Twitch caches these for a few minutes; the minute stamp keeps each hover reasonably fresh.
          img.src = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-${w}x${Math.round((w * 9) / 16)}.jpg?t=${Math.floor(Date.now() / 60_000)}`;
        }
        pop.append(img);
      }
      // Kick rows: [avatar] <span>name</span><span>category</span> … viewers.
      const kickSpans = onKick ? row.querySelectorAll("span:not([title])") : null;
      const name = (onKick ? kickSpans?.[0]?.textContent : row.querySelector('[data-a-target="side-nav-title"]')?.textContent)?.trim() || login;
      const game = (onKick ? kickSpans?.[1]?.textContent?.trim() : row.querySelector('[data-a-target="side-nav-card-metadata"] p[title]:not([data-a-target])')?.getAttribute("title")) ?? "";
      const cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = name;
      if (game) cap.append(Object.assign(document.createElement("span"), { textContent: ` · ${game}` }));
      pop.append(cap);
      document.body.append(pop);

      // Beside the row, kept on screen.
      const r = row.getBoundingClientRect();
      const h = pop.offsetHeight;
      pop.style.left = `${Math.round(r.right + 8)}px`;
      pop.style.top = `${Math.round(Math.max(8, Math.min(r.top + r.height / 2 - h / 2, innerHeight - h - 8)))}px`;
      document.documentElement.classList.add("tp-previewing");
      requestAnimationFrame(() => pop?.classList.add("on"));
    }

    function showCard(link: HTMLElement) {
      const login = loginOf(link);
      if (!login || settings.get().previewMode !== "video") return;
      const host = link.parentElement;
      if (!host) return;
      if (!host.style.position) host.style.position = "relative";
      inline = embed(login, INLINE);
      host.append(inline);
    }

    const offOver = listen("mouseover", (e) => {
      const el = e.target as Element;
      const row = el.closest?.<HTMLElement>(SIDEBAR);
      const card = row ? null : el.closest?.<HTMLElement>(CARD_IMAGE);
      const next = row && isLive(row) ? row : card;
      if (next === target) return;
      close();
      if (!next) return;
      target = next;
      timer = window.setTimeout(() => (next === row ? showSidebar(next) : showCard(next)), DELAY_MS);
    });
    // Leaving the row/card (not just moving between its children) ends the preview.
    const offOut = listen("mouseout", (e) => {
      if (target && !target.contains(e.relatedTarget as Node | null)) close();
    });
    const offScroll = listen("scroll", close); // a fixed popup would drift off its row
    const offSettings = settings.onChange((c) => ("previewMode" in c || "previewWidth" in c) && close());

    return () => {
      close();
      offOver();
      offOut();
      offScroll();
      offSettings();
      style.remove();
    };
  },
};
