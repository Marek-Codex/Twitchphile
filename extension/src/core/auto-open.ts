// Background-only: opens tabs for favorites that go live, rotates them past the tab limit, closes them when
// they end. Only ever touches tabs it opened. State survives service-worker restarts in local storage.
import { channelTabs, channelUrl } from "./channels";
import { platform } from "@platform";
import type { LiveChannel } from "./live";
import { settings } from "./settings";
import { lowerSet } from "./util";

export const AUTO_OPEN_KEY = "autoOpenState";
const KEY = AUTO_OPEN_KEY;

export interface State {
  opened: Record<string, number>; // login → tabId we opened
  openedAt: Record<string, number>; // login → when we opened it (rotation age)
  lastShown: Record<string, number>; // login → when it last had a tab (rotation fairness)
  dismissed: string[]; // skipped for this stream (you closed it, or starred it mid-stream); cleared when they go offline
  knownfavorites?: string[]; // favorites at the last sync, to spot ones you've just starred
}

const load = async (): Promise<State> => ({
  opened: {},
  openedAt: {},
  lastShown: {},
  dismissed: [],
  ...(await platform.local.get<State>(KEY)),
});
const save = (s: State) => platform.local.set(KEY, s);
const LIVE_KEY_CACHE = "liveNow"; // core/live.ts's cache of who's live (imported there as a type only)

// Every read-modify-write of the state goes through here, one at a time: the live alarm, settings changes
// and tab closes can overlap, and interleaving them opens duplicate tabs or loses dismissals.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// Exact channel match: "foo" must not count as open because "foobar" is.

// Tabs we're closing ourselves, so onRemoved doesn't mistake them for you dismissing a stream.
const closingOurselves = new Set<number>();

async function closeOurs(state: State, login: string) {
  const id = state.opened[login];
  closingOurselves.add(id);
  await platform.tabs.close(id);
  delete state.opened[login];
  delete state.openedAt[login];
}

export const syncAutoOpen = (live: LiveChannel[]) => serial(() => syncNow(live));

async function syncNow(live: LiveChannel[]) {
  const s = await settings.load();
  const state = await load();
  const liveSet = new Set(live.map((c) => c.login));

  // Forget tabs that no longer exist; clear dismissals for channels now offline.
  for (const [login, id] of Object.entries(state.opened)) {
    if (!(await platform.tabs.exists(id))) {
      delete state.opened[login];
      delete state.openedAt[login];
    }
  }
  state.dismissed = state.dismissed.filter((l) => liveSet.has(l));

  // With "Switch to them" on, starring someone who's already live shouldn't yank you into their stream: treat them
  // as seen for this stream; they auto-open next time they go live. (Background tabs yank nobody, so otherwise
  // they just open — as does everyone live when favorites arrive by sync or import.)
  const favs = lowerSet(s.favorites);
  if (state.knownfavorites && s.autoOpenFocus) {
    const known = new Set(state.knownfavorites);
    for (const login of favs) if (!known.has(login) && liveSet.has(login) && !state.dismissed.includes(login)) state.dismissed.push(login);
  }
  state.knownfavorites = [...favs];

  if (s.autoClose) {
    for (const login of Object.keys(state.opened)) if (!liveSet.has(login)) await closeOurs(state, login);
  }

  if (s.autoOpen) {
    const wanted = live
      .filter((c) => (s.autoOpenAll || favs.has(c.login)) && !(c.login in state.opened) && !state.dismissed.includes(c.login))
      // Rotating: least recently shown first (never shown = 0). Otherwise biggest streams first.
      .sort((a, b) => (s.autoOpenRotate ? (state.lastShown[a.login] ?? 0) - (state.lastShown[b.login] ?? 0) : b.viewers - a.viewers));

    // Rotation: with others waiting and the limit reached, retire the oldest tab whose turn is up —
    // never the one you're looking at. One swap per check keeps it gentle.
    if (s.autoOpenRotate && wanted.length && Object.keys(state.opened).length >= s.autoOpenMax) {
      const due = Object.entries(state.openedAt)
        .filter(([, at]) => Date.now() - at >= s.rotateMinutes * 60_000)
        .sort((a, b) => a[1] - b[1]);
      for (const [login] of due) {
        if (await platform.tabs.isActive(state.opened[login])) continue;
        await closeOurs(state, login);
        state.lastShown[login] = Date.now();
        break;
      }
    }

    for (const c of wanted) {
      if (Object.keys(state.opened).length >= s.autoOpenMax) break;
      if (await platform.tabs.anyMatching(channelTabs(c.login))) continue; // you already have it open
      const id = await platform.tabs.open(channelUrl(c.login), { active: s.autoOpenFocus });
      if (!id) continue;
      state.opened[c.login] = id;
      state.openedAt[c.login] = state.lastShown[c.login] = Date.now();
      await save(state); // before the new tab's content script asks whether it's a lurk tab
    }
  }

  await save(state);
}

// Asked by content scripts: was this tab auto-opened (→ lurk mode)?
export async function isLurkTab(tabId?: number) {
  return tabId != null && Object.values((await load()).opened).includes(tabId);
}

// You closed a tab we opened → "not this stream": don't reopen it until they go offline.
// Closing the window or quitting the browser closes every tab too, but that's not you dismissing each stream.
platform.tabs.onRemoved((id, windowClosing) =>
  serial(async () => {
    if (closingOurselves.delete(id)) return;
    const state = await load();
    const login = Object.keys(state.opened).find((l) => state.opened[l] === id);
    if (!login) return;
    delete state.opened[login];
    delete state.openedAt[login];
    if (!windowClosing) state.dismissed.push(login);
    await save(state);
  }),
);

// Raids: the stream an auto-opened tab was showing ended and sent it to another channel. Depending on the
// setting: stay (the tab becomes yours), close it, or move it to the next live favorite that has no tab yet.
const RAID = /^https?:\/\/(?:www\.)?twitch\.tv\/([a-z0-9_]+)\/?\?(?:.*&)?referrer=raid\b/i;
platform.tabs.onUrlChanged((id, url) => {
  const target = url.match(RAID)?.[1]?.toLowerCase();
  if (!target) return;
  return serial(async () => {
    const state = await load();
    const from = Object.keys(state.opened).find((l) => state.opened[l] === id);
    if (!from || from === target) return;
    const s = await settings.load();
    delete state.opened[from];
    delete state.openedAt[from];
    if (!state.dismissed.includes(from)) state.dismissed.push(from); // that stream is over
    if (s.raidAction === "close") {
      closingOurselves.add(id);
      await platform.tabs.close(id);
    } else if (s.raidAction === "next") {
      const next = await nextfavorite(state, s);
      if (next) {
        await platform.tabs.navigate(id, channelUrl(next));
        state.opened[next] = id;
        state.openedAt[next] = state.lastShown[next] = Date.now();
      } else {
        closingOurselves.add(id);
        await platform.tabs.close(id);
      }
    }
    await save(state);
  });
});

// The live favorite that most deserves the freed tab: never shown for longest, not open anywhere, not dismissed.
async function nextfavorite(state: State, s: Awaited<ReturnType<typeof settings.load>>) {
  const favs = lowerSet(s.favorites);
  const live = (await platform.local.get<LiveChannel[]>(LIVE_KEY_CACHE)) ?? [];
  const candidates = live
    .filter((c) => (s.autoOpenAll || favs.has(c.login)) && !(c.login in state.opened) && !state.dismissed.includes(c.login))
    .sort((a, b) => (state.lastShown[a.login] ?? 0) - (state.lastShown[b.login] ?? 0) || b.viewers - a.viewers);
  for (const c of candidates) if (!(await platform.tabs.anyMatching(channelTabs(c.login)))) return c.login;
  return null;
}

// The popup's "Reopen closed" chip: a fresh start, so streams you closed (or starred mid-stream) can open again.
export const clearDismissed = () =>
  serial(async () => {
    const state = await load();
    state.dismissed = [];
    await save(state);
  });
