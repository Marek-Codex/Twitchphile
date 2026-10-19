// Background-only: pairing + favorites sync with the Twitchphile desktop app, which listens on loopback
// (desktop/Twitchphile.Core/PairingListener.cs). Pairing needs your approval in the app; every later call carries
// the token it hands back. favorites and hidden channels merge independent per-channel changes.
import { platform } from "@platform";
import { settings } from "./settings";

const BASE = "http://127.0.0.1:9616";
const TOKEN_KEY = "desktopToken";
const STAMP_KEY = "favoritesUpdatedAt"; // when favorites last changed here (ms)

export type DesktopStatus = "absent" | "unpaired" | "paired";
export const DESKTOP_SYNC_AT_KEY = "desktopSyncedAt";
type favoriteList = { logins: string[]; updatedAt: string };
type Change = { present: boolean; updatedAt: string };
type SyncedList = favoriteList & { changes?: Record<string, Change> };

// The list we last adopted from the app. Storage-change events arrive asynchronously, so compare the list itself
// to recognize the next adoption event and avoid stamping it as a local change and bouncing it back.
const adopted: Record<string, string> = {};
const key = (logins: string[]) => JSON.stringify([...logins].map((l) => l.toLowerCase()).sort());

async function call(path: string, init: RequestInit = {}, timeoutMs = 3000) {
  const token = await platform.local.get<string>(TOKEN_KEY);
  const headers = {
    "content-type": "application/json",
    ...(token ? { "x-twitchphile-token": token } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  return fetch(BASE + path, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
}

// Not paired yet: ask the app to pair us *silently*. It agrees only for Twitchphile's own extension (known by id)
// and otherwise says no without prompting anyone. A POST, because Chromium omits the Origin header on an
// extension's plain GETs, and Origin is how the app recognizes us.
export async function autoPair() {
  if (await platform.local.get<string>(TOKEN_KEY)) return;
  try {
    const res = await call("/pair", { method: "POST", headers: { "x-twitchphile-silent": "1" } });
    if (!res.ok) return;
    await platform.local.set(TOKEN_KEY, (await res.json()).token);
    await syncfavorites();
  } catch {
    /* app not running */
  }
}

export async function desktopStatus(): Promise<DesktopStatus> {
  try {
    const ping = await (await call("/ping")).json();
    if (ping.paired) return "paired";
    // The app may have reset its pairing token while this copy still has the old one.
    // Drop that stale token so the normal silent pair path can recover immediately.
    if (await platform.local.get<string>(TOKEN_KEY)) await platform.local.remove(TOKEN_KEY);
    // Our own extension gets paired silently; only another copy (e.g. the Firefox add-on) needs the Pair button.
    await autoPair();
    return (await platform.local.get<string>(TOKEN_KEY)) ? "paired" : "unpaired";
  } catch {
    return "absent";
  }
}

// ---- Shared sign-in: both sides are the same Twitch app, so either sign-in works for the other.

export interface BorrowedSession {
  token: string;
  userId: string;
  login: string;
  expiresAt: number;
}

// The app refreshes its own sign-in, so a borrowed token is re-fetched shortly before it expires.
let borrowed: BorrowedSession | null = null;

export async function borrowSession(): Promise<BorrowedSession | null> {
  if (borrowed && borrowed.expiresAt - Date.now() > 5 * 60_000) return borrowed;
  borrowed = null;
  if (!(await platform.local.get<string>(TOKEN_KEY))) return null;
  try {
    const res = await call("/session");
    const s = res.ok ? await res.json() : null;
    if (s?.signedIn) borrowed = { token: s.accessToken, userId: s.userId, login: s.login, expiresAt: Date.parse(s.expiresAt) };
  } catch {
    /* app not running */
  }
  return borrowed;
}

export const forgetBorrowed = () => void (borrowed = null);

// Lends our own sign-in to a paired app that has none.
export async function offerSession(accessToken: string) {
  if (!(await platform.local.get<string>(TOKEN_KEY))) return;
  try {
    const ping = await (await call("/ping")).json();
    if (ping.paired && !ping.signedIn) await call("/session", { method: "PUT", body: JSON.stringify({ accessToken }) });
  } catch {
    /* app not running */
  }
}

// Waits while the app asks you to allow it (up to 2 minutes).
export async function pairDesktop(): Promise<DesktopStatus> {
  try {
    const res = await call("/pair", { method: "POST" }, 120_000);
    if (!res.ok) return "unpaired";
    await platform.local.set(TOKEN_KEY, (await res.json()).token);
    await syncfavorites();
    return "paired";
  } catch {
    return "absent";
  }
}

// favorites and hidden channels each keep a per-channel ledger and a legacy whole-list stamp.
const LISTS = {
  favorites: { path: "/favorites", stamp: STAMP_KEY, changes: "favoritesChanges" },
  hiddenChannels: { path: "/hidden", stamp: "hiddenUpdatedAt", changes: "hiddenChanges" },
} as const;
type ListKey = keyof typeof LISTS;

const clean = (login: string) => login.trim().replace(/^@/, "").toLowerCase();
const loginsOf = (changes: Record<string, Change>) => Object.entries(changes)
  .filter(([, entry]) => entry.present)
  .sort(([a, x], [b, y]) => Date.parse(x.updatedAt) - Date.parse(y.updatedAt) || a.localeCompare(b))
  .map(([login]) => login);

function normalizedChanges(state: SyncedList): Record<string, Change> {
  const changes: Record<string, Change> = {};
  for (const [raw, entry] of Object.entries(state.changes ?? {})) {
    const login = clean(raw);
    if (login && entry && Number.isFinite(Date.parse(entry.updatedAt))) changes[login] = entry;
  }
  for (const raw of state.logins) {
    const login = clean(raw);
    if (login && !changes[login]) changes[login] = { present: true, updatedAt: state.updatedAt };
  }
  return changes;
}

async function ledger(which: ListKey): Promise<Record<string, Change>> {
  const saved = await platform.local.get<Record<string, Change>>(LISTS[which].changes);
  if (saved) return saved;
  const stamp = (await platform.local.get<number>(LISTS[which].stamp)) ?? 0;
  const logins = (await settings.load())[which];
  const initial = normalizedChanges({ logins, updatedAt: new Date(stamp).toISOString() });
  await platform.local.set(LISTS[which].changes, initial);
  return initial;
}

// Seed legacy lists before a new local edit is observed, so the first removal has a tombstone.
export async function initializeSyncState() {
  await Promise.all([ledger("favorites"), ledger("hiddenChannels")]);
}

const queues: Record<ListKey, Promise<unknown>> = { favorites: Promise.resolve(), hiddenChannels: Promise.resolve() };
function serial<T>(which: ListKey, fn: () => Promise<T>): Promise<T> {
  const run = queues[which].then(fn, fn);
  queues[which] = run.catch(() => {});
  return run;
}

// Called when a synced list changes here (ignores the change our own adoption caused).
export async function listChanged(which: ListKey, logins: string[]) {
  if (key(logins) === adopted[which]) {
    delete adopted[which];
    return;
  }
  await serial(which, async () => {
    const changes = { ...(await ledger(which)) };
    const wanted = new Set(logins.map(clean).filter(Boolean));
    const known = new Set(loginsOf(changes));
    const touched = [...new Set([...wanted, ...known])].filter((login) => wanted.has(login) !== known.has(login));
    if (!touched.length) return;
    const last = Math.max((await platform.local.get<number>(LISTS[which].stamp)) ?? 0,
      ...Object.values(changes).map((entry) => Date.parse(entry.updatedAt) || 0));
    const stamp = Math.max(Date.now(), last + 1);
    for (const login of touched) changes[login] = { present: wanted.has(login), updatedAt: new Date(stamp).toISOString() };
    await platform.local.set(LISTS[which].changes, changes);
    await platform.local.set(LISTS[which].stamp, stamp);
    await syncListNow(which);
  });
}

export const favoritesChanged = (logins: string[]) => listChanged("favorites", logins);

export async function syncfavorites() {
  await serial("favorites", () => syncListNow("favorites"));
  await serial("hiddenChannels", () => syncListNow("hiddenChannels"));
}

// Sends our ledger; the app answers with the merged ledger, which we adopt.
async function syncListNow(which: ListKey) {
  if (!(await platform.local.get<string>(TOKEN_KEY))) return;
  const { path, stamp: stampKey } = LISTS[which];
  const changes = await ledger(which);
  const stamp = Math.max((await platform.local.get<number>(stampKey)) ?? 0,
    ...Object.values(changes).map((entry) => Date.parse(entry.updatedAt) || 0));
  const ours: SyncedList = { logins: loginsOf(changes), updatedAt: new Date(stamp).toISOString(), changes };
  let res: Response;
  try {
    res = await call(path, { method: "PUT", body: JSON.stringify(ours) });
  } catch {
    return; // app not running — try again next tick
  }
  if (res.status === 401) {
    await platform.local.remove(TOKEN_KEY); // app was reset; pair again
    return;
  }
  if (!res.ok) return; // e.g. an older app without this list
  const winner: SyncedList = await res.json();
  await platform.local.set(DESKTOP_SYNC_AT_KEY, Date.now());
  // A settings edit can arrive while the request is in flight. Let its queued change run
  // against the current ledger before adopting a response that would overwrite it.
  if (key((await settings.load())[which]) !== key(ours.logins)) return;
  if (winner.changes) {
    const merged = normalizedChanges(winner);
    const mergedLogins = loginsOf(merged);
    await platform.local.set(LISTS[which].changes, merged);
    await platform.local.set(stampKey, Math.max(stamp, Date.parse(winner.updatedAt) || 0));
    if (key(mergedLogins) === key(ours.logins)) return;
    adopted[which] = key(mergedLogins);
    await settings.set({ [which]: mergedLogins });
    return;
  }
  // Older desktop builds still answer with whole-list newest-wins data.
  const theirs = Date.parse(winner.updatedAt);
  if (theirs <= stamp) return;
  adopted[which] = key(winner.logins);
  await platform.local.set(LISTS[which].changes, normalizedChanges(winner));
  await platform.local.set(stampKey, theirs);
  await settings.set({ [which]: winner.logins });
}
// Drop progress for the app to show (the summary only — the twitch.tv session it came from stays in the page).
export async function pushDrops(state: unknown) {
  if (!(await platform.local.get<string>(TOKEN_KEY))) return;
  try {
    await call("/drops", { method: "PUT", body: JSON.stringify(state) });
  } catch {
    /* app not running */
  }
}

/** Hands the app the Kick channels you follow, as plain "kick/<name>" strings (it checks them itself). */
export async function pushKickFollows(slugs: string[]) {
  if (!(await platform.local.get<string>(TOKEN_KEY))) return;
  try {
    await call("/kick-follows", { method: "PUT", body: JSON.stringify({ channels: slugs.map((s) => `kick/${s}`) }) });
  } catch {
    /* app not running */
  }
}
