// Click the video to play/pause; double-click still goes fullscreen.
import { listen, type Feature } from "../../core/feature";
import { onKick } from "../../core/site";
import { playerRoot, video } from "../../core/twitch";

// Twitch layers overlays above <video>, so listen at player-root level and skip real controls.
const IGNORE = 'button,a,input,select,textarea,[role="slider"],[data-a-target="player-controls"],.video-player__controls';
const DBL_CLICK_MS = 250;

// Kick's player: press its own play/pause button (first in the control row, beside the volume) so its controls
// stay in step; the video directly if the controls aren't drawn.
const KICK_ROOT = "#injected-channel-player";
const kickToggle = (v: HTMLVideoElement) => {
  const btn = document.querySelector<HTMLButtonElement>(`${KICK_ROOT} [class~="group/volume"]`)?.parentElement?.querySelector("button");
  if (btn) btn.click();
  else v.paused ? v.play() : v.pause();
};

export const clickToPause: Feature = {
  key: "clickToPause",
  sites: ["twitch", "kick"],
  start() {
    let pending = 0;
    return listen("click", (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const v = video();
      const t = e.target as Element;
      if (!v) return;
      const root = onKick ? v.closest(KICK_ROOT) : playerRoot(v);
      if (!root?.contains(t) || t.closest(IGNORE)) return;
      clearTimeout(pending);
      // Wait out a possible second click so double-click (fullscreen) doesn't also toggle playback.
      if (e.detail === 1) pending = window.setTimeout(() => (onKick ? kickToggle(v) : v.paused ? v.play() : v.pause()), DBL_CLICK_MS);
    });
  },
};
