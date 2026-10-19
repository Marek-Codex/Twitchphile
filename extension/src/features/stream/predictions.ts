// Prediction alerts: a chime and a desktop notification when a prediction opens on the channel you're watching,
// so you don't miss it with chat closed or the tab in the background.
// Watches only Twitch's pinned highlight stack above chat, with its own observer so it keeps working in background
// tabs right away (the shared onDom tick only runs about once a second there).
import { platform } from "@platform";
import { onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import { settings } from "../../core/settings";
import { channelLogin } from "../../core/twitch";
import { chime } from "../chat/mention-sound";

const STACK = '[class*="community-highlight-stack"]';
const PREDICTION = /\bpredict(ion|ions)?\b/i;

export const predictionAlerts: Feature = {
  key: "predictionAlerts",
  start() {
    let stack: Element | null = null;
    let observer: MutationObserver | null = null;
    let open = false; // a prediction is showing; alert once per prediction, not per re-render
    let queued = 0;

    const check = () => {
      queued = 0;
      const now = Boolean(stack?.isConnected && PREDICTION.test(stack.textContent ?? ""));
      if (now && !open && (!settings.get().predictionOnlyAway || document.hidden)) {
        const login = channelLogin();
        chime();
        platform.send({ type: "notify", id: `predict:${login}`, title: "Prediction open", message: login ? `On ${login}'s stream` : "On the stream you're watching" });
      }
      open = now;
    };

    const stopDom = onDom(() => {
      const found = document.querySelector(STACK);
      if (found === stack) return;
      observer?.disconnect();
      stack = found;
      open = false;
      if (!stack) return;
      // Coalesce the stack's frequent re-renders (countdowns) into one text check.
      observer = new MutationObserver(() => (queued ||= window.setTimeout(check, 300)));
      observer.observe(stack, { childList: true, subtree: true, characterData: true });
      check();
    });

    return () => {
      stopDom();
      observer?.disconnect();
      clearTimeout(queued);
    };
  },
};
