// Claims the channel-points bonus after a human-ish random delay.
// Watches only the points summary, with its own observer so it keeps working in background tabs right
// away (the shared onDom tick only runs about once a second there).
// It only ever presses the button Twitch already showed you — no farms, no channel-hopping, no funny
// business. This is the well-behaved one, remember.
import { platform } from "@platform";
import { onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import { settings } from "../../core/settings";
import { liveChannelLogin } from "../../core/twitch";

const SUMMARY = ".community-points-summary";
const BONUS = 'button[data-a-target="tw-channel-points-bonus-button"], [aria-label="Claim Bonus"]';

const usable = (b: HTMLButtonElement) => b.isConnected && !b.disabled && b.getAttribute("aria-disabled") !== "true";

export const autoClaim: Feature = {
  key: "autoClaim",
  start() {
    const pending = new WeakSet<Element>();
    let summary: Element | null = null;
    let observer: MutationObserver | null = null;

    function check() {
      const btn = summary?.querySelector<HTMLButtonElement>(BONUS);
      if (!btn || pending.has(btn) || !usable(btn)) return;
      pending.add(btn);
      const { claimMinDelay: min, claimMaxDelay: max } = settings.get();
      const lo = Math.min(min, max) * 1000;
      const delay = lo + Math.random() * (Math.max(min, max) * 1000 - lo);
      setTimeout(() => {
        if (!usable(btn)) return;
        if (settings.get().claimOnlyVisible && document.hidden) return void pending.delete(btn);
        btn.click();
        const login = liveChannelLogin();
        if (login) platform.send({ type: "claim:add", login });
      }, delay);
    }

    // Twitch re-mounts the summary on navigation; re-attach when it changes.
    const stopDom = onDom(() => {
      const found = document.querySelector(SUMMARY);
      if (found === summary) return;
      observer?.disconnect();
      summary = found;
      if (!summary) return;
      observer = new MutationObserver(check);
      observer.observe(summary, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "aria-disabled"] });
      check();
    });
    // A bonus left pending while hidden (claimOnlyVisible) gets picked up on return.
    const onVis = () => !document.hidden && check();
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stopDom();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  },
};
