// Recovers from player errors (e.g. "Error #2000") by retrying, then reloading — at most 3 times / 10 min.
import type { Feature } from "../../core/feature";
import { osd } from "./osd";
import { playerRoot } from "../../core/twitch";
import { onDom } from "../../core/dom";

const ERROR = /error\s*#\d{3,4}/i;
const WINDOW = 10 * 60_000;

export const autoRecover: Feature = {
  key: "autoRecover",
  start() {
    const attempts: number[] = [];
    let root: HTMLElement | null | undefined = null;
    let rootObserver: MutationObserver | null = null;
    let recovering = false;
    let queued = 0;
    const check = () => {
      queued = 0;
      if (!root?.isConnected || !ERROR.test(root.textContent ?? "")) return;
      const now = Date.now();
      while (attempts.length && now - attempts[0] > WINDOW) attempts.shift();
      if (attempts.length >= 3 || recovering) return;
      attempts.push(now);
      recovering = true;
      // Prefer Twitch's own retry control; fall back to a reload.
      const retry = [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => /try again|retry|reload/i.test(b.textContent ?? ""));
      osd("Player error — recovering");
      if (retry) retry.click();
      else setTimeout(() => location.reload(), 1500);
      setTimeout(() => (recovering = false), 3000);
    };
    const stopDom = onDom(() => {
      const found = playerRoot();
      if (found !== root) {
        rootObserver?.disconnect();
        root = found;
        if (root) {
          // The error overlay mounts as new nodes; coalesce bursts (timers, controls) into one text scan.
          rootObserver = new MutationObserver(() => (queued ||= window.setTimeout(check, 500)));
          rootObserver.observe(root, { childList: true, subtree: true });
        }
        check();
      }
    });
    return () => {
      stopDom();
      rootObserver?.disconnect();
      clearTimeout(queued);
    };
  },
};
