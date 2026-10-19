// Alt-based hotkeys (Twitch owns the single-key ones). Ignored while typing.
import { $ } from "../../core/dom";
import { listen, type Feature } from "../../core/feature";
import { player } from "../../core/player";
import { onKick } from "../../core/site";
import { isVod, video } from "../../core/twitch";
import { toggleCinema } from "./cinema";
import { osd } from "./osd";
import { capture } from "./screenshot";

// `anySite`: works on any player (Kick too); the rest drive Twitch's own player or page.
const HOTKEYS: { code: string; key: string; label: string; run: () => void; anySite?: boolean }[] = [
  { code: "KeyL", key: "Alt+L", label: "Jump to live", run: () => (player.jumpToLive(), osd("Live")) },
  { code: "KeyS", key: "Alt+S", label: "Screenshot", run: capture, anySite: true },
  { code: "KeyP", key: "Alt+P", label: "Picture-in-picture", run: togglePip, anySite: true },
  { code: "KeyF", key: "Alt+F", label: "Cinema mode", run: toggleCinema },
  { code: "KeyC", key: "Alt+C", label: "Focus chat", run: () => $<HTMLElement>('[data-a-target="chat-input"]')?.focus() },
  { code: "ArrowLeft", key: "Alt+←", label: "Back 10s", run: () => (player.seekBy(-10), osd("−10s")) },
  { code: "ArrowRight", key: "Alt+→", label: "Forward 10s", run: () => (player.seekBy(10), osd("+10s")) },
  { code: "Comma", key: "Alt+,", label: "Slower (VODs)", run: () => speed(-0.25) },
  { code: "Period", key: "Alt+.", label: "Faster (VODs)", run: () => speed(0.25) },
];

// VODs only: speeding up a live stream just drifts you ahead of the buffer.
function speed(delta: number) {
  const v = video();
  if (!v || !isVod()) return osd("Speed is for VODs");
  v.playbackRate = Math.min(3, Math.max(0.25, Math.round((v.playbackRate + delta) * 100) / 100));
  osd(`${v.playbackRate}×`);
}

// Twitch sets disablePictureInPicture; clearing it restores the browser's PiP.
export async function togglePip() {
  const v = video();
  if (!v) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else {
      v.disablePictureInPicture = false;
      await v.requestPictureInPicture();
    }
  } catch {
    osd("PiP unavailable");
  }
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export const hotkeys: Feature = {
  key: "hotkeys",
  sites: ["twitch", "kick"],
  start() {
    return listen("keydown", (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typing(e.target)) return;
      const hk = HOTKEYS.find((h) => h.code === e.code && (h.anySite || !onKick));
      if (!hk) return;
      e.preventDefault();
      e.stopPropagation();
      hk.run();
    });
  },
};
