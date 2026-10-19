// One MutationObserver for the whole extension, coalesced to one callback pass per frame.
// Twitch is an SPA, so this also doubles as the navigation signal (path is checked each pass).
import { onKick } from "./site";

type Tick = (pathChanged: boolean) => void;

const ticks = new Set<Tick>();
let observer: MutationObserver | null = null;
let scheduled = false;
let lastPath = location.pathname;

// New chat lines are by far the most frequent mutation on Twitch, and chat has its own observer
// (core/chat.ts). Batches that only touch the message list don't wake the per-frame features.
const CHAT_LIST = onKick ? "#chatroom-messages" : ".chat-scrollable-area__message-container";
let chatList: Element | null = null;

function run() {
  if (!scheduled) return; // already ran (rAF and the hidden-tab timer can both fire)
  scheduled = false;
  const pathChanged = location.pathname !== lastPath;
  lastPath = location.pathname;
  if (!chatList?.isConnected) chatList = document.querySelector(CHAT_LIST);
  ticks.forEach((t) => t(pathChanged));
}

// rAF while visible (one pass per frame, never mid-paint). Hidden tabs never get rAF, so they'd never re-attach
// observers — e.g. auto-claim in a stream Twitchphile opened in the background. There a timer stands in; browsers
// throttle background timers to about once a second, which is plenty.
function schedule() {
  if (!scheduled) {
    scheduled = true;
    if (document.hidden) setTimeout(run, 0);
    else requestAnimationFrame(run);
  }
}

function onMutations(muts: MutationRecord[]) {
  if (scheduled) return;
  const list = chatList?.isConnected ? chatList : null;
  if (list && muts.every((m) => m.target === list || list.contains(m.target))) return;
  schedule();
}

// A frame requested just before the tab hid never arrives; hand the pending pass to a timer instead.
document.addEventListener("visibilitychange", () => {
  if (scheduled && document.hidden) setTimeout(run, 0);
});

export function onDom(tick: Tick) {
  ticks.add(tick);
  if (!observer) {
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  schedule();
  return () => {
    ticks.delete(tick);
    if (!ticks.size) {
      observer?.disconnect();
      observer = null;
    }
  };
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel);
