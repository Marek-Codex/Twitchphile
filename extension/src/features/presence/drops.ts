// On the Drops inventory page, claims finished drops for you (one click per ready drop).
// No channel-hopping or farming — it only presses buttons Twitch already shows you.
import { onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import { toast } from "../../core/toast";

export const dropsClaim: Feature = {
  key: "dropsClaim",
  start() {
    const clicked = new WeakSet<Element>();
    return onDom(() => {
      if (!location.pathname.startsWith("/drops/inventory")) return;
      document.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
        if (clicked.has(b) || b.disabled || !/^claim( now)?$/i.test(b.textContent?.trim() ?? "")) return;
        clicked.add(b);
        const r = b.getBoundingClientRect();
        setTimeout(() => {
          b.click();
          toast("Drop claimed", r.left, r.top + 12);
        }, 400 + Math.random() * 800);
      });
    });
  },
};
