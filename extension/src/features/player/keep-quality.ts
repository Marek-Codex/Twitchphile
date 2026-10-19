// Every Twitch tab (not just auto-opened ones) keeps full quality and playback in the background.
// Applied once per page load; turning it off takes effect on the next reload.
import type { Feature } from "../../core/feature";
import { player } from "../../core/player";

export const keepQuality: Feature = {
  key: "keepQuality",
  start() {
    player.lurk();
    return () => {}; // can't be undone in place — takes effect on the next page load
  },
};
