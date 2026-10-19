// Audio etiquette: mute Twitch tabs you leave (unmute on return), and mute during ads.
// Both only undo mutes they made themselves — a stream you muted stays muted.
import type { Feature } from "../../core/feature";
import { isMuted, playerRoot, setMuted, video } from "../../core/twitch";
import { onDom } from "../../core/dom";

export const tabAutoMute: Feature = {
  key: "tabAutoMute",
  start() {
    let ours = false;
    const onVis = () => {
      if (document.hidden) {
        if (video() && !video()!.paused && !isMuted()) (setMuted(true), (ours = true));
      } else if (ours) {
        setMuted(false);
        ours = false;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  },
};

const AD = '[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"]';

export const adMute: Feature = {
  key: "adMute",
  start() {
    let ours = false;
    let root: HTMLElement | null | undefined = null;
    const check = () => {
      const ad = Boolean(root?.querySelector(AD));
      if (ad && !ours && !isMuted()) (setMuted(true), (ours = true));
      else if (!ad && ours) (setMuted(false), (ours = false));
    };
    // Observe only the player (where the ad markers live), with its own observer so ad mute still
    // reacts in background tabs right away (the shared onDom tick only runs about once a second there).
    const observer = new MutationObserver(check);
    const stopDom = onDom(() => {
      const found = playerRoot();
      if (found === root) return;
      observer.disconnect();
      root = found;
      if (root) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-a-target"] });
      check();
    });
    return () => {
      stopDom();
      observer.disconnect();
      if (ours) setMuted(false);
    };
  },
};
