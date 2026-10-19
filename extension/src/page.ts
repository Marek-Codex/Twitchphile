// Runs in the page's MAIN world (no extension APIs): reads and drives Twitch's player through its React
// internals, and does the few Twitch requests that need the page itself (integrity-gated GQL).
// Talks to the content script over DOM events with JSON-string payloads (see core/player.ts).
// Only polls while someone is subscribed.
import type { PlayerState } from "./core/player";
import { TWITCH_WEB_CLIENT_ID } from "./core/constants";

type Quality = { name: string };
type MediaPlayer = {
  core?: { state?: { liveLatency?: number } };
  getQualities?(): Quality[];
  getQuality?(): Quality;
  setQuality?(q: Quality): void;
  isAutoQualityMode?(): boolean;
  setAutoQualityMode?(on: boolean): void;
  getVolume?(): number;
  setVolume?(v: number): void;
  getPosition?(): number;
  seekTo?(t: number): void;
  getBufferedRanges?(): { start: number; end: number }[];
};

// ---- Player

// Found by walking the React fiber tree under the player (bounded DFS) — once per player element.
// Keyed on the element, so a miss (player not mounted yet, or a page without one) isn't re-walked
// every poll, and a swapped player (navigation) is picked up automatically.
let cached: { root: Element; mp: MediaPlayer | null; at: number } | null = null;
const MISS_RETRY_MS = 5000;

function mediaPlayer(): MediaPlayer | null {
  const root = document.querySelector(".persistent-player") ?? document.querySelector('[data-a-target="video-player"]');
  if (!root) return (cached = null);
  if (cached?.root === root && (cached.mp || Date.now() - cached.at < MISS_RETRY_MS)) return cached.mp;
  cached = { root, mp: findPlayer(root), at: Date.now() };
  return cached.mp;
}

function findPlayer(root: Element): MediaPlayer | null {
  const key = Object.keys(root).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return null;
  const stack = [(root as any)[key]];
  for (let n = 0; stack.length && n < 5000; n++) {
    const node = stack.pop();
    const mp = node?.stateNode?.props?.mediaPlayerInstance;
    if (mp) return mp.playerInstance ?? mp;
    if (node?.sibling) stack.push(node.sibling);
    if (node?.child) stack.push(node.child);
  }
  return null;
}

// Twitch can swap the player instance inside the same element on navigation; drop ours so the next call re-finds it.
addEventListener("popstate", () => (cached = null));
const pushState = history.pushState;
history.pushState = function (...args) {
  cached = null;
  return pushState.apply(this, args);
};

const video = () => document.querySelector<HTMLVideoElement>(".persistent-player video, video");

function state(): PlayerState {
  const mp = mediaPlayer();
  const v = video();
  const latency = Number(mp?.core?.state?.liveLatency);
  return {
    latency: Number.isFinite(latency) && latency > 0 && latency < 600 ? latency : null,
    rate: v?.playbackRate ?? 1,
    paused: v?.paused ?? true,
    quality: mp?.isAutoQualityMode?.() ? "auto" : (mp?.getQuality?.()?.name ?? null),
    volume: mp?.getVolume?.() ?? null,
  };
}

function setQuality(name: string) {
  const mp = mediaPlayer();
  if (name === "auto") return mp?.setAutoQualityMode?.(true);
  const q = mp?.getQualities?.().find((x) => x.name === name);
  if (q) mp!.setQuality?.(q); // not offered (e.g. 1080p60 on a 720p stream) → leave Twitch's choice
}

// Seek within what's buffered, via Twitch's player so its UI stays in sync.
function seekBy(seconds: number) {
  const mp = mediaPlayer();
  const pos = mp?.getPosition?.();
  const ranges = mp?.getBufferedRanges?.() ?? [];
  if (pos == null || !ranges.length) return;
  const lo = Math.min(...ranges.map((r) => r.start));
  const hi = Math.max(...ranges.map((r) => r.end)) - 1;
  mp!.seekTo?.(Math.min(hi, Math.max(lo, pos + seconds)));
}

// Jump to the live edge of what's buffered, minus a small safety margin.
function jumpToLive() {
  const v = video();
  if (!v?.buffered.length) return;
  v.currentTime = Math.max(v.currentTime, v.buffered.end(v.buffered.length - 1) - 1);
  v.playbackRate = 1;
}

// Lurk mode: Twitch drops quality / pauses hidden tabs, so report "visible" and prefer Source.
// Only this page's JS sees the spoof; the extension's own (isolated-world) scripts still see the real visibility.
let lurking = false;
function lurk() {
  if (lurking) return;
  lurking = true;
  for (const [key, value] of [["hidden", false], ["webkitHidden", false], ["visibilityState", "visible"], ["webkitVisibilityState", "visible"]] as const) {
    Object.defineProperty(document, key, { configurable: true, get: () => value });
  }
  document.hasFocus = () => true;
  addEventListener("visibilitychange", (e) => e.stopImmediatePropagation(), true);
  addEventListener("blur", (e) => e.target === window && e.stopImmediatePropagation(), true); // window blur only, not inputs
  try {
    localStorage.setItem("video-quality", '{"default":"chunked"}'); // "chunked" = Source
  } catch {}
}

// ---- Integrity-gated GQL (chatter counts): the token can only be minted from the page.

const GQL_HEADERS = {
  "Client-ID": TWITCH_WEB_CLIENT_ID,
  "Device-ID": crypto.randomUUID().replace(/-/g, ""),
  "Content-Type": "text/plain;charset=UTF-8",
};
let integrity: { token: string; expiration: number } | null = null;

async function chatters(login: string): Promise<number | null> {
  if (!integrity || integrity.expiration - Date.now() < 60_000) {
    const res = await fetch("https://gql.twitch.tv/integrity", { method: "POST", headers: GQL_HEADERS, body: "" });
    integrity = res.ok ? await res.json() : null;
    if (!integrity?.token) return null;
  }
  const res = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: { ...GQL_HEADERS, "Client-Integrity": integrity.token },
    body: JSON.stringify({ query: "query($n:String!){channel(name:$n){chatters{count}}}", variables: { n: login } }),
  });
  const count = (await res.json())?.data?.channel?.chatters?.count;
  return Number.isInteger(count) ? count : null;
}

// ---- Drop progress: Twitch's own Inventory query, as its Drops page runs it, with your logged-in session.
// The session cookie is read here, used for this one request to Twitch, and never handed to the extension.
// (Persisted query hash as Twitch's web client uses it; if Twitch rotates it, this returns null until updated.)
const INVENTORY_HASH = "8337eb8541b314040b0edde0c09c5c7a2783ba1960aa9edfbf3bac16d0fec404";
let userIntegrity: { token: string; expiration: number } | null = null; // tied to the session, unlike the anonymous one

async function inventory(): Promise<unknown> {
  const session = document.cookie.match(/(?:^|;\s*)auth-token=([^;]+)/)?.[1];
  if (!session) return null; // logged out
  const auth = { ...GQL_HEADERS, Authorization: `OAuth ${session}` };
  if (!userIntegrity || userIntegrity.expiration - Date.now() < 60_000) {
    const res = await fetch("https://gql.twitch.tv/integrity", { method: "POST", headers: auth, body: "" });
    userIntegrity = res.ok ? await res.json() : null;
  }
  const res = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: { ...auth, ...(userIntegrity?.token ? { "Client-Integrity": userIntegrity.token } : {}) },
    body: JSON.stringify({
      operationName: "Inventory",
      variables: { fetchRewardCampaigns: false },
      extensions: { persistedQuery: { version: 1, sha256Hash: INVENTORY_HASH } },
    }),
  });
  if (!res.ok) return null;
  return (await res.json())?.data ?? null;
}

// ---- Commands from the content script

let poll = 0;
const emit = () => document.dispatchEvent(new CustomEvent("tp:state", { detail: JSON.stringify(state()) }));

document.addEventListener("tp:cmd", (e) => {
  const { cmd, value } = JSON.parse((e as CustomEvent<string>).detail);
  switch (cmd) {
    case "sub":
      if (!poll) (emit(), (poll = window.setInterval(emit, 1000)));
      break;
    case "unsub":
      clearInterval(poll);
      poll = 0;
      break;
    case "quality":
      setQuality(value);
      break;
    case "volume":
      mediaPlayer()?.setVolume?.(value);
      break;
    case "seek":
      seekBy(value);
      break;
    case "rate":
      {
        const v = video();
        if (v && v.playbackRate !== value) v.playbackRate = value;
      }
      break;
    case "live":
      jumpToLive();
      break;
    case "lurk":
      lurk();
      break;
    case "drops":
      inventory()
        .catch(() => null)
        .then((data) => document.dispatchEvent(new CustomEvent("tp:drops", { detail: JSON.stringify(data) })));
      break;
    case "chatters":
      chatters(value)
        .catch(() => null)
        .then((count) => document.dispatchEvent(new CustomEvent("tp:chatters", { detail: JSON.stringify({ login: value, count }) })));
      break;
  }
});
