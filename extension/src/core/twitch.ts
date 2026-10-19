// Twitch page knowledge — selectors, URL shapes, player controls — so features don't each carry their own.
import { $ } from "./dom";

// ---- URLs

// First path segments that are Twitch pages, not channels.
const RESERVED = new Set(["directory", "videos", "search", "settings", "subscriptions", "inventory", "wallet", "drops", "turbo", "prime", "friends", "messages", "downloads", "popout", "moderator", "u", "p", "jobs", "store"]);

export const channelLogin = () => {
  const first = location.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  return RESERVED.has(first) ? "" : first;
};

export const vodId = () => location.pathname.match(/^\/videos\/(\d+)/)?.[1] ?? "";
export const isVod = () => Boolean(vodId());

export function clipSlug() {
  if (location.hostname === "clips.twitch.tv") return location.pathname.split("/").filter(Boolean)[0] ?? "";
  return location.pathname.match(/^\/[^/]+\/clip\/([^/?]+)/)?.[1] ?? "";
}

// A live channel page's login — empty on clips (whose URL also starts with the channel).
export const liveChannelLogin = () => (clipSlug() ? "" : channelLogin());

// The signed-in user, from Twitch's readable `login` cookie.
export const myLogin = () => document.cookie.match(/(?:^|;\s*)login=([^;]+)/)?.[1]?.toLowerCase() ?? "";

// ---- Player

export const video = () => $<HTMLVideoElement>("video");

export const playerRoot = (v = video()) =>
  (v?.closest('[data-a-target="video-player"]') ?? v?.closest(".video-player__container") ?? v?.parentElement) as
    | HTMLElement
    | null
    | undefined;

export const playerControls = () =>
  $(".player-controls__right-control-group") ?? $('[data-a-target="player-controls"]');

// Adds a button to the player bar (before fullscreen), borrowing a native button's classes so it looks and
// behaves like Twitch's own. No-op when it's already there or the controls aren't mounted yet.
export function addPlayerButton(id: string, title: string, iconHtml: string, onClick: (e: MouseEvent) => void) {
  const anchor = playerControls();
  if (!anchor || document.getElementById(id)) return;
  const btn = document.createElement("button");
  btn.id = id;
  btn.type = "button";
  btn.title = btn.ariaLabel = title;
  const ref = anchor.querySelector("button");
  if (ref) btn.className = ref.className;
  btn.innerHTML = iconHtml;
  btn.addEventListener("click", (e) => {
    e.stopPropagation(); // keep click-to-pause out of it
    onClick(e);
  });
  const fullscreen = anchor.querySelector('[data-a-target="player-fullscreen-button"]');
  if (fullscreen?.parentElement === anchor) anchor.insertBefore(btn, fullscreen);
  else anchor.append(btn);
}

// Mute through Twitch's own button so its UI and saved volume stay in sync. Returns false if not mounted yet.
const muteButton = () => $<HTMLButtonElement>('[data-a-target="player-mute-unmute-button"]');
export const isMuted = () => /^unmute/i.test(muteButton()?.getAttribute("aria-label") ?? "");
export function setMuted(muted: boolean) {
  const btn = muteButton();
  if (btn && isMuted() !== muted) btn.click();
  return Boolean(btn);
}
