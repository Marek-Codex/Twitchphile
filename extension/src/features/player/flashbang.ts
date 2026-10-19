// Flashbang defender: dims the player the moment a stream cuts from dark to blinding white, and brings it back
// once the frame calms down. Only reacts to a sudden jump, so streams that are simply bright aren't dimmed.
// Samples a tiny 32×18 copy of the frame 4× a second — only while the tab is visible and the video is playing.
import type { Feature } from "../../core/feature";
import { settings } from "../../core/settings";
import { video } from "../../core/twitch";
import { injectStyle } from "../../core/util";

const SAMPLE_MS = 250;
const W = 32;
const H = 18;
const JUMP = 0.4; // brightness rise (0–1) within one sample that counts as a flash
const BRIGHT = 0.72; // stay dimmed while the frame is at least this bright
const CLS = "tp-flash-dim";

export const flashbang: Feature = {
  key: "flashbang",
  sites: ["twitch", "kick"],
  start() {
    const style = injectStyle(`video.${CLS}{filter:brightness(var(--tp-flash,.35));transition:filter .08s ease}
video{transition:filter .6s ease}`);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    let last: number | null = null;
    let dimmed: HTMLVideoElement | null = null;

    const undim = () => {
      dimmed?.classList.remove(CLS);
      dimmed = null;
    };

    // Average perceived brightness, 0 (black) to 1 (white).
    function brightness(v: HTMLVideoElement) {
      ctx.drawImage(v, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      return sum / (W * H * 255);
    }

    const timer = window.setInterval(() => {
      const v = video();
      if (document.hidden || !v || v.paused || v.readyState < 2 || !v.videoWidth) return void (last = null);
      let b: number;
      try {
        b = brightness(v);
      } catch {
        return; // frame not readable (tainted/transitioning) — skip this tick
      }
      if (dimmed && (dimmed !== v || b < BRIGHT)) undim();
      else if (!dimmed && last != null && b - last >= JUMP && b >= BRIGHT) {
        v.style.setProperty("--tp-flash", String(settings.get().flashbangLevel / 100));
        v.classList.add(CLS);
        dimmed = v;
      }
      last = b;
    }, SAMPLE_MS);

    return () => {
      clearInterval(timer);
      undim();
      style.remove();
    };
  },
};
