// Soft two-tone chime when someone mentions you. Synthesized — no audio asset shipped.
import { onChat } from "../../core/chat";
import type { Feature } from "../../core/feature";
import { settings } from "../../core/settings";

const MAX_GAIN = 0.3; // 100% volume — the chime is meant to be noticed, not startle
const SCROLLBACK_MS = 2000; // messages in the first moments are scrollback, not new mentions
let ctx: AudioContext | null = null;

// Plays the chime at the "Chime volume" setting.
export function chime() {
  ctx ??= new AudioContext();
  const volume = (settings.get().mentionVolume / 100) * MAX_GAIN;
  const t = ctx.currentTime;
  for (const [freq, at] of [[880, 0], [1320, 0.09]]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t + at);
    gain.gain.linearRampToValueAtTime(volume, t + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + at);
    osc.stop(t + at + 0.3);
  }
}

// Calls `fn` for fresh chat messages matching `test`, at most once per `gapMs`.
export function chimeOn(test: (text: string, mentionsMe: boolean) => boolean, gapMs: number) {
  const ready = Date.now() + SCROLLBACK_MS;
  let last = 0;
  return onChat(({ text, mentionsMe }) => {
    const now = Date.now();
    if (now < ready || now - last < gapMs || !test(text, mentionsMe)) return;
    last = now;
    chime();
  });
}

export const mentionSound: Feature = {
  key: "mentionSound",
  start: () => chimeOn((_, mentionsMe) => mentionsMe && (!settings.get().mentionOnlyHidden || document.hidden), 1500),
};
