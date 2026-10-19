// Counts time the channel's video is actually playing (background tabs included) and flushes once a minute.
import { platform } from "@platform";
import type { Feature } from "../../core/feature";
import { channelKey, kickChannel, onKick } from "../../core/site";
import { liveChannelLogin, video } from "../../core/twitch";

const TICK_MS = 10_000;
const FLUSH_MS = 60_000;
const MAX_GAP = 70_000; // background timers are throttled to ~1/min; ignore longer gaps (sleep, suspend)

export const watchTime: Feature = {
  key: "watchTime",
  sites: ["twitch", "kick"],
  start() {
    let last = Date.now();
    let pending: Record<string, number> = {};
    let sinceFlush = 0;

    const flush = () => {
      for (const [login, ms] of Object.entries(pending)) {
        const seconds = Math.round(ms / 1000);
        if (seconds > 0) platform.send({ type: "watch:add", login, seconds });
      }
      pending = {};
      sinceFlush = 0;
    };

    const timer = window.setInterval(() => {
      const now = Date.now();
      const gap = now - last;
      last = now;
      const v = video();
      // Clips and VODs don't count as watching the stream. Kick channels are keyed apart ("kick/<name>").
      const login = channelKey(onKick ? kickChannel() : liveChannelLogin());
      if (gap <= MAX_GAP && login && v && !v.paused && !v.ended && v.readyState > 2) {
        pending[login] = (pending[login] ?? 0) + gap;
      }
      sinceFlush += gap;
      if (sinceFlush >= FLUSH_MS) flush();
    }, TICK_MS);

    addEventListener("pagehide", flush);
    return () => {
      clearInterval(timer);
      removeEventListener("pagehide", flush);
      flush();
    };
  },
};
