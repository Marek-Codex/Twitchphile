// Notices when you spend your Prime sub (a click on the Prime option in Twitch's subscribe flow) and tells the
// background, which schedules the "Prime sub is free again" reminder. The panel has a manual fallback.
import { platform } from "@platform";
import { listen, type Feature } from "../../core/feature";
import { PRIME_BUTTON } from "../../core/prime";
import { liveChannelLogin } from "../../core/twitch";

export const primeReminder: Feature = {
  key: "primeReminder",
  start() {
    return listen("click", (e) => {
      const btn = (e.target as Element).closest?.("button");
      if (!btn || !PRIME_BUTTON.test(btn.textContent ?? "") || btn.closest(".top-nav__prime, .top-nav")) return;
      // Only inside the subscribe flow: a dialog / sub card, not arbitrary page text.
      if (!btn.closest('[role="dialog"], [class*="subscri"], [data-a-target*="sub"]')) return;
      platform.send({ type: "prime:used", login: liveChannelLogin() });
    });
  },
};
