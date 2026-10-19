// Gently speeds playback up while behind the target delay, then returns to 1×.
import type { Feature } from "../../core/feature";
import { player } from "../../core/player";
import { settings } from "../../core/settings";

const MAX_RATE = 1.1;
const HYSTERESIS = 0.5; // seconds past target before we start catching up

export const latencyReducer: Feature = {
  key: "latencyReducer",
  start() {
    let catching = false;
    const unsub = player.subscribe(({ latency, paused, rate: current }) => {
      if (latency == null || paused) return;
      const target = settings.get().latencyTarget;
      const over = latency - target;
      if (over > HYSTERESIS) {
        // Proportional: further behind → faster, capped so audio stays natural.
        const rate = Math.round(Math.min(MAX_RATE, 1 + over * 0.02) * 100) / 100;
        if (rate !== current) player.setRate(rate);
        catching = true;
      } else if (catching && over <= 0) {
        player.setRate(1);
        catching = false;
      }
    });
    return () => {
      unsub();
      if (catching) player.setRate(1);
    };
  },
};
