// Where each feature hooks into Twitch's DOM. Evaluated only when the settings panel opens,
// so a Twitch redesign that breaks a hook shows up as a warning instead of silently failing.
import type { Settings, SettingKey } from "./settings";
import { channelLogin, isVod, myLogin } from "./twitch";

export interface Probe {
  feature: SettingKey;
  label: string;
  selector: string;
  // The page must be one where this hook should exist; otherwise the probe is skipped.
  applies: (s: Settings) => boolean;
}

const has = (sel: string) => Boolean(document.querySelector(sel));
const onChannel = () => Boolean(channelLogin()) && has("video");
const live = () => onChannel() && has(".live-time");
const chatOpen = () => has(".stream-chat");
const loggedIn = () => Boolean(myLogin());

export const PROBES: Probe[] = [
  { feature: "screenshotButton", label: "Player controls", selector: ".player-controls__right-control-group", applies: onChannel },
  { feature: "streamStats", label: "Chat header", selector: ".stream-chat-header", applies: (s) => s.statsPlacement === "chat" && chatOpen() },
  { feature: "streamStats", label: "Uptime row", selector: ".live-time", applies: (s) => s.statsPlacement === "info" && live() },
  { feature: "chatterCount", label: "Viewer count", selector: 'strong[data-a-target="animated-channel-viewers-count"]', applies: live },
  { feature: "chatHighlight", label: "Chat message list", selector: ".chat-scrollable-area__message-container", applies: chatOpen },
  { feature: "messageMenu", label: "Chat usernames", selector: ".chat-line__message [data-a-user]", applies: () => chatOpen() && has(".chat-line__message") },
  { feature: "autoClaim", label: "Channel points", selector: ".community-points-summary", applies: () => chatOpen() && loggedIn() },
  { feature: "pinFavorites", label: "Followed channels", selector: '#side-nav a[data-test-selector="followed-channel"]', applies: () => has("#side-nav") && loggedIn() },
  { feature: "realTime", label: "VOD controls", selector: ".player-controls__left-control-group", applies: () => isVod() && has("video") },
];

export interface ProbeResult {
  probe: Probe;
  ok: boolean;
  // Some Twitch features only exist on channels that enable them; absence is not a broken hook.
  optional: boolean;
}

export function runProbes(s: Settings): ProbeResult[] {
  return PROBES.filter((p) => s[p.feature] && p.applies(s)).map((probe) => {
    const ok = has(probe.selector);
    return { probe, ok, optional: probe.feature === "autoClaim" && !ok };
  });
}
