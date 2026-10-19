// Chat message stream, shared by all chat features and running only while at least one listens. Reads Twitch's or
// Kick's chat from the page (no internals). Every message row it reports gets the class `tp-line`, so feature CSS
// targets `.tp-line.<state>` on either site.
//
// Kick's chat is a virtualized list: rows are positioned absolutely and reused for other messages as chat moves, so
// there a row is re-reported whenever its content changes (features toggle their classes idempotently).
import { $, onDom } from "./dom";
import { onKick } from "./site";
import { myLogin } from "./twitch";

export interface ChatMessage {
  el: HTMLElement;
  name: HTMLElement | null; // the element showing the sender's name (nicknames, readable colors)
  login: string; // lowercase
  text: string;
  mentionsMe: boolean;
}

type Handler = (m: ChatMessage) => void;

interface ChatLayout {
  list: string;
  line: string;
  parse(el: HTMLElement): { name: HTMLElement | null; login: string; text: string } | null;
}

const TWITCH: ChatLayout = {
  list: ".chat-scrollable-area__message-container",
  line: ".chat-line__message",
  parse(el) {
    const login = el.querySelector("[data-a-user]")?.getAttribute("data-a-user")?.toLowerCase();
    if (!login) return null;
    const text = el.querySelector('[data-a-target="chat-line-message-body"]')?.textContent ?? "";
    return { name: el.querySelector<HTMLElement>(".chat-author__display-name"), login, text };
  },
};

const KICK: ChatLayout = {
  list: "#chatroom-messages",
  line: "#chatroom-messages [data-index]",
  parse(el) {
    // [badges] <button>name</button> <span aria-hidden>: </span> message…
    const name = el.querySelector<HTMLElement>("button[data-prevent-expand]");
    // The sender is read from the name text, unless that's a nickname we wrote (see features/chat/nicknames.ts).
    const shownNick = name?.dataset.tpNick && name.textContent === name.dataset.tpNick;
    const login = (shownNick ? name!.dataset.tpLogin : name?.textContent?.trim())?.toLowerCase();
    if (!name || !login) return null;
    const sep = el.querySelector('span[aria-hidden="true"]');
    let text = "";
    for (let n = sep?.nextSibling; n; n = n.nextSibling) text += n.textContent ?? "";
    return { name, login, text };
  },
};

export const CHAT = onKick ? KICK : TWITCH;

const handlers = new Set<Handler>();
let list: Element | null = null;
let observer: MutationObserver | null = null;
let stopDom: (() => void) | null = null;
const seen = new WeakMap<HTMLElement, string>(); // row → what it showed when last reported (Kick reuses rows)

// "@me" / "me" as a whole word, rebuilt only if the signed-in user changes. (Twitch only: Kick's login isn't readable.)
let mentionOf = { login: "", re: null as RegExp | null };
function mentionRegex() {
  const me = onKick ? "" : myLogin();
  if (me !== mentionOf.login) mentionOf = { login: me, re: me ? new RegExp(`@?\\b${me}\\b`, "i") : null };
  return mentionOf;
}

function report(targets: Iterable<Handler>, el: HTMLElement, force = false) {
  const p = CHAT.parse(el);
  if (!p) return;
  const sig = `${p.login}\u0000${p.text}`;
  if (!force && seen.get(el) === sig) return;
  seen.set(el, sig);
  el.classList.add("tp-line");
  const me = mentionRegex();
  const m: ChatMessage = { el, ...p, mentionsMe: p.login !== me.login && Boolean(me.re?.test(p.text)) };
  for (const h of targets) h(m);
}

function emitTo(targets: Iterable<Handler>, node: Node, force = false) {
  const el = node instanceof HTMLElement ? node : node.parentElement;
  if (!el) return;
  const row = el.closest<HTMLElement>(CHAT.line);
  if (row) return report(targets, row, force);
  el.querySelectorAll<HTMLElement>(CHAT.line).forEach((r) => report(targets, r, force));
}

function attach() {
  const found = $(CHAT.list);
  if (found === list) return;
  observer?.disconnect();
  list = found;
  if (!list) return;
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (onKick) emitTo(handlers, m.target); // a row's content changed (or rows came and went)
      m.addedNodes.forEach((n) => emitTo(handlers, n));
    }
  });
  // Twitch appends finished lines to the list; Kick rewrites rows in place, so it needs the whole subtree.
  observer.observe(list, onKick ? { childList: true, subtree: true, characterData: true } : { childList: true });
  emitTo(handlers, list, true); // lines already on screen
}

export function onChat(h: Handler) {
  handlers.add(h);
  if (!stopDom) stopDom = onDom(attach);
  else if (list) emitTo([h], list, true); // late joiner: catch up on what's on screen
  return () => {
    handlers.delete(h);
    if (handlers.size) return;
    stopDom?.();
    stopDom = null;
    observer?.disconnect();
    observer = list = null;
  };
}
