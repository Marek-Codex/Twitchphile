// Cinema mode: player + chat fill the screen (Twitch removed theater mode). CSS-only layout,
// optionally browser-fullscreen. Toggle: player-bar button or Alt+F. Esc / leaving fullscreen exits.
// Chat can sit beside the video, slide in from the right edge only when you want it, or sit below the video
// (tall/vertical monitors) with a draggable divider.
import { onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import { settings } from "../../core/settings";
import { addPlayerButton } from "../../core/twitch";
import { injectStyle } from "../../core/util";
import { cinema as cinemaIcon, svg } from "../../ui/icons";

const CLS = "tp-cinema";
const BTN = "tp-cinema-btn";
const DIVIDER = "tp-cinema-divider";
const EDGE_PX = 24; // how close to the right edge brings auto-hidden chat back
const CHAT = ".channel-root__right-column";

const STYLE = `
html.${CLS} .top-nav,html.${CLS} #side-nav{display:none!important}
html.${CLS} .persistent-player{position:fixed!important;inset:0 var(--tp-chat-w) 0 0!important;width:auto!important;height:auto!important;
max-height:none!important;z-index:3000!important;background:#000;transform:none!important}
html.${CLS} .persistent-player *:has(.video-player),html.${CLS} .persistent-player .video-player,
html.${CLS} .persistent-player .video-player *:has(video){height:100%!important;max-height:none!important;padding:0!important}
html.${CLS} .persistent-player video{height:100%!important;width:100%!important;object-fit:contain}
html.${CLS} ${CHAT}{position:fixed!important;top:0!important;right:0!important;bottom:0!important;left:auto!important;
width:var(--tp-chat-w)!important;height:100vh!important;z-index:3000!important;transform:none!important;transition:none!important}
html.${CLS} ${CHAT}>*{height:100%!important}

html.${CLS}.tp-c-auto .persistent-player{inset:0!important}
html.${CLS}.tp-c-auto ${CHAT}{z-index:3001!important;transform:translateX(100%)!important;transition:transform .22s ease!important;box-shadow:-8px 0 24px rgba(0,0,0,.5)}
html.${CLS}.tp-c-auto.tp-chat-peek ${CHAT}{transform:none!important}

html.${CLS}.tp-c-below .persistent-player{inset:0 0 var(--tp-chat-h) 0!important}
html.${CLS}.tp-c-below ${CHAT}{top:auto!important;left:0!important;width:auto!important;height:var(--tp-chat-h)!important}
#${DIVIDER}{display:none}
html.${CLS}.tp-c-below #${DIVIDER}{display:block;position:fixed;left:0;right:0;bottom:calc(var(--tp-chat-h) - 3px);height:6px;
z-index:3002;cursor:row-resize;background:transparent}
html.${CLS}.tp-c-below #${DIVIDER}:hover,#${DIVIDER}.drag{background:rgba(60,160,255,.6)}`;

const root = document.documentElement;
const on = () => root.classList.contains(CLS);

function applyLayout() {
  const { cinemaChatWidth, cinemaChatHeight, cinemaChat } = settings.get();
  root.style.setProperty("--tp-chat-w", `${cinemaChatWidth}px`);
  root.style.setProperty("--tp-chat-h", `${Math.min(cinemaChatHeight, innerHeight - 160)}px`);
  root.classList.toggle("tp-c-auto", cinemaChat === "auto");
  root.classList.toggle("tp-c-below", cinemaChat === "below");
}

export function toggleCinema() {
  if (on()) {
    root.classList.remove(CLS, "tp-chat-peek");
    if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
    return;
  }
  applyLayout();
  root.classList.add(CLS);
  if (settings.get().cinemaFullscreen) root.requestFullscreen().catch(() => {});
}

export const cinema: Feature = {
  key: "cinema",
  start() {
    const style = injectStyle(STYLE);

    // Leaving browser fullscreen (Esc) also leaves cinema, when fullscreen was part of it.
    const onFs = () => {
      if (!document.fullscreenElement && on() && settings.get().cinemaFullscreen) toggleCinema();
    };
    document.addEventListener("fullscreenchange", onFs);

    // Auto-hide: chat slides in at the right edge and away once you leave it (unless you're typing in it).
    let hideTimer = 0;
    const onMove = (e: MouseEvent) => {
      if (!on() || !root.classList.contains("tp-c-auto")) return;
      const chat = document.querySelector(CHAT);
      if (e.clientX >= innerWidth - EDGE_PX || chat?.contains(e.target as Node)) {
        clearTimeout(hideTimer);
        hideTimer = 0;
        root.classList.add("tp-chat-peek");
      } else if (root.classList.contains("tp-chat-peek") && !hideTimer && !chat?.contains(document.activeElement)) {
        hideTimer = window.setTimeout(() => ((hideTimer = 0), root.classList.remove("tp-chat-peek")), 500);
      }
    };
    document.addEventListener("mousemove", onMove, { passive: true });

    // Below: drag the divider to share the height; the result is remembered.
    const divider = document.createElement("div");
    divider.id = DIVIDER;
    divider.title = "Drag to resize";
    divider.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      divider.setPointerCapture(e.pointerId);
      divider.classList.add("drag");
      const move = (m: PointerEvent) => root.style.setProperty("--tp-chat-h", `${Math.max(120, Math.min(innerHeight - m.clientY, innerHeight - 160))}px`);
      const up = () => {
        divider.classList.remove("drag");
        divider.removeEventListener("pointermove", move);
        divider.removeEventListener("pointerup", up);
        settings.set({ cinemaChatHeight: parseInt(root.style.getPropertyValue("--tp-chat-h")) || settings.get().cinemaChatHeight });
      };
      divider.addEventListener("pointermove", move);
      divider.addEventListener("pointerup", up);
    });
    document.body.append(divider);

    const offSettings = settings.onChange((c) => on() && ("cinemaChat" in c || "cinemaChatWidth" in c) && applyLayout());

    const stopDom = onDom((pathChanged) => {
      if (pathChanged && on()) toggleCinema();
      addPlayerButton(BTN, "Cinema mode (Alt+F)", svg(cinemaIcon, 20), toggleCinema);
    });

    return () => {
      if (on()) toggleCinema();
      stopDom();
      offSettings();
      clearTimeout(hideTimer);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("mousemove", onMove);
      divider.remove();
      root.classList.remove("tp-c-auto", "tp-c-below");
      style.remove();
      document.getElementById(BTN)?.remove();
    };
  },
};
