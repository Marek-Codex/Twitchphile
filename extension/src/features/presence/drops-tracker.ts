// Keeps drop-campaign progress fresh while any Twitch tab is open. Every few minutes a tab asks the background
// whether an update is due (only one tab gets the go-ahead), reads your Inventory through the page, and hands the
// summary back. Works in background tabs — timers there still fire about once a minute.
import { platform } from "@platform";
import { parseInventory } from "../../core/drops";
import type { Feature } from "../../core/feature";
import { player } from "../../core/player";

const CHECK_MS = 60_000;

export const dropsTracker: Feature = {
  key: "dropsTracker",
  start() {
    let busy = false;
    const check = async () => {
      if (busy || !(await platform.send<boolean>({ type: "drops:due" }))) return;
      busy = true;
      try {
        const data = await player.inventory();
        // Null = logged out or Twitch refused; release the lease without overwriting what we have.
        await platform.send({ type: "drops:update", campaigns: data ? parseInventory(data) : null });
      } finally {
        busy = false;
      }
    };
    const first = window.setTimeout(check, 5000); // let the page settle first
    const timer = window.setInterval(check, CHECK_MS);
    return () => (clearTimeout(first), clearInterval(timer));
  },
};
