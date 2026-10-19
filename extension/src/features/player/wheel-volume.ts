// Scroll over the volume control to change volume, in steps you choose.
import { listen, type Feature } from "../../core/feature";
import { player } from "../../core/player";
import { settings } from "../../core/settings";
import { onKick } from "../../core/site";
import { isMuted, setMuted, video } from "../../core/twitch";
import { osd } from "./osd";

const VOLUME_TARGETS = [
  '[data-a-target="player-volume-slider"]',
  '[data-a-target="player-mute-unmute-button"]',
  ".player-controls__volume-slider",
  ".volume-slider__container",
].join(",");

const isVolumeTarget = (t: Element) => {
  if (t.closest(VOLUME_TARGETS)) return true;
  const label = t.closest('input[type="range"]')?.getAttribute("aria-label")?.toLowerCase() ?? "";
  return label.includes("volume");
};

// Kick's player draws its controls only while you hover it, so there's no slider to aim at: the bottom strip of the
// video, where those controls appear, is the volume target there (the rest of the video still scrolls the page).
const KICK_STRIP_PX = 72;
const overKickControls = (e: WheelEvent, v: HTMLVideoElement) => {
  const r = v.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY <= r.bottom && e.clientY >= r.bottom - KICK_STRIP_PX;
};

// Kick keeps its own volume and puts it back on the video, so setting the video alone gets undone and the slider
// disagrees. Instead "click" Kick's slider at the right spot: Kick then sets the video, its slider and its saved
// volume itself. The slider sits collapsed until you hover the speaker, so it's opened for the moment of the click.
function setKickVolume(v: HTMLVideoElement, value: number) {
  const thumb = v.closest("#injected-channel-player")?.querySelector('[role="slider"][aria-label="Volume"]');
  let track = thumb?.parentElement;
  while (track && !(track.hasAttribute("data-orientation") && !track.hasAttribute("role"))) track = track.parentElement;
  if (!track) {
    v.volume = value;
    v.muted = value === 0;
    return;
  }
  const box = track.parentElement as HTMLElement;
  const was = box.style.display;
  box.style.display = "flex";
  const r = track.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width * value, clientY: r.top + r.height / 2, pointerId: 1, pointerType: "mouse", button: 0, isPrimary: true };
  track.dispatchEvent(new PointerEvent("pointerdown", { ...at, buttons: 1 }));
  track.dispatchEvent(new PointerEvent("pointerup", { ...at, buttons: 0 }));
  box.style.display = was;
}

export const wheelVolume: Feature = {
  key: "wheelVolume",
  sites: ["twitch", "kick"],
  start() {
    return listen(
      "wheel",
      (e) => {
        const v = video();
        if (!v || !(e.target instanceof Element)) return;
        if (onKick ? !overKickControls(e, v) : !isVolumeTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        const step = Math.min(25, Math.max(1, settings.get().volumeStep)) / 100;
        const current = v.muted ? 0 : v.volume;
        const next = Math.min(1, Math.max(0, Math.round((current + (e.deltaY < 0 ? step : -step)) * 100) / 100));
        if (onKick) {
          setKickVolume(v, next);
        } else {
          // Through Twitch's player, so its slider and saved volume follow along.
          player.setVolume(next);
          if (next > 0 && isMuted()) setMuted(false);
        }
        osd(next === 0 ? "Muted" : `Vol ${Math.round(next * 100)}%`);
      },
      { passive: false, capture: true },
    );
  },
};
