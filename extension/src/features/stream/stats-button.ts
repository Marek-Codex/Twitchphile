// Opens the channel-stats drawer for the channel you're on.
// Twitch: a player-bar button, and a "Channel stats" pill in the channel's About box (under their about text).
// Kick: the same pill beside the Follow button (Kick has no player bar to add to).
import { onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import { kickChannel, onKick } from "../../core/site";
import { injectStyle } from "../../core/util";
import { addPlayerButton, channelLogin } from "../../core/twitch";
import { openStats } from "../../ui/entry";
import { stream as chartIcon, svg } from "../../ui/icons";

const ID = "tp-channel-stats";
const ABOUT_ID = "tp-about-stats";
const ABOUT = '[data-a-target="about-panel"] [class*="about-section__panel--content"]';
const KICK_FOLLOW = 'button[data-testid="follow-button"]';

// A small link-like pill (Twitch's About box stretches its children full width, hence align-self/width).
const STYLE = `#${ABOUT_ID}{display:flex;align-self:flex-start;flex:none;width:max-content;height:auto;align-items:center;gap:5px;margin:10px 0 0;
padding:3px 10px 3px 8px;border:0;border-radius:10px;cursor:pointer;background:rgba(60,160,255,.12);color:#6BB8FF;white-space:nowrap;
font:600 12px/18px var(--font-base,sans-serif)}
#${ABOUT_ID}:hover{background:rgba(60,160,255,.24);color:#9CCFFF}
#${ABOUT_ID}.kick{align-self:center;margin:0 0 0 8px;padding:6px 12px 6px 10px;border-radius:8px;font-family:inherit}`;

function pill(onClick: () => void) {
  const b = document.createElement("button");
  b.id = ABOUT_ID;
  b.type = "button";
  b.innerHTML = `${svg(chartIcon, 12)}<span>Channel stats</span>`;
  b.addEventListener("click", onClick);
  return b;
}

export const channelStatsButton: Feature = {
  key: "channelStatsButton",
  sites: ["twitch", "kick"],
  start() {
    const style = injectStyle(STYLE);
    const stop = onDom(() => {
      const login = onKick ? kickChannel() : channelLogin();
      if (!login) {
        document.getElementById(ID)?.remove();
        document.getElementById(ABOUT_ID)?.remove();
        return;
      }
      const open = () => openStats(onKick ? kickChannel() : channelLogin());

      if (onKick) {
        const follow = document.querySelector(KICK_FOLLOW);
        if (follow && !document.getElementById(ABOUT_ID)) {
          const b = pill(open);
          b.classList.add("kick");
          follow.after(b);
        }
        return;
      }

      addPlayerButton(ID, "Channel stats", svg(chartIcon, 20), open);
      const about = document.querySelector(ABOUT);
      if (about && !about.querySelector(`#${ABOUT_ID}`)) {
        const b = pill(open);
        // Just under the streamer's own about text (a <p>), which is where it reads naturally whatever else Twitch puts
        // in the box (the layout differs signed in vs out). No description: after the follower line's block instead.
        // (The follower line is a <p> too, so take the longest one: that's the description.)
        const text = [...about.querySelectorAll("p")].sort((x, y) => (y.textContent?.length ?? 0) - (x.textContent?.length ?? 0))[0];
        if (text) text.after(b);
        else about.firstElementChild?.firstElementChild?.append(b) ?? about.append(b);
      }
    });
    return () => (stop(), style.remove(), document.getElementById(ID)?.remove(), document.getElementById(ABOUT_ID)?.remove());
  },
};
