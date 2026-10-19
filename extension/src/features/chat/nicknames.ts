// Shows your own nickname for chatters in place of their display name (original kept in the tooltip).
// The name element remembers who it belongs to (data-tp-login) and what we wrote (data-tp-nick): on Kick the sender
// is read from that very text, and rows are reused for other people, so both are needed to tell the two cases apart.
import { CHAT, onChat } from "../../core/chat";
import type { Feature } from "../../core/feature";
import { settings } from "../../core/settings";

function apply(el: HTMLElement, login: string) {
  const nick = settings.get().nicknameMap[login];
  // Reused for someone else (or never touched): start from what's on screen now.
  if (el.dataset.tpLogin !== login || (el.dataset.tpNick && el.textContent !== el.dataset.tpNick)) {
    if (!nick) return void restore(el); // the common case: nothing to change, don't touch the line
    el.dataset.tpOrig = el.textContent ?? "";
    el.dataset.tpLogin = login;
  }
  el.textContent = nick || el.dataset.tpOrig!;
  if (nick) el.dataset.tpNick = nick;
  else delete el.dataset.tpNick;
  el.title = nick ? `${el.dataset.tpOrig} (${login})` : "";
  el.style.fontStyle = nick ? "italic" : "";
}

function restore(el: HTMLElement) {
  if (el.dataset.tpOrig == null) return;
  if (el.dataset.tpNick && el.textContent === el.dataset.tpNick) el.textContent = el.dataset.tpOrig;
  el.title = el.style.fontStyle = "";
  for (const k of ["tpOrig", "tpLogin", "tpNick"]) delete el.dataset[k];
}

export const nicknames: Feature = {
  key: "nicknames",
  sites: ["twitch", "kick"],
  start() {
    const offChat = onChat(({ name, login }) => name && apply(name, login));
    // A nickname added or changed: redo every chat line on screen (not just ones already renamed).
    const reapply = () =>
      document.querySelectorAll<HTMLElement>(".tp-line").forEach((row) => {
        const p = CHAT.parse(row);
        if (p?.name) apply(p.name, p.login);
      });
    const offSettings = settings.onChange((c) => "nicknameMap" in c && reapply());
    return () => {
      offChat();
      offSettings();
      document.querySelectorAll<HTMLElement>("[data-tp-orig]").forEach(restore);
    };
  },
};
