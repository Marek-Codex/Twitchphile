import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { fake } from "./fake-platform";
import { syncAutoOpen } from "../src/core/auto-open";
import { updateAlerts, isQuietHour, ENDED_KEY, type EndedStream } from "../src/core/alerts";
import { mergeCounts, mergePrefs } from "../src/core/backup";
import { contrast, luminance, readable } from "../src/core/color";
import { fmtClock, fmtCompact, fmtDuration } from "../src/core/format";
import { refreshLive, LIVE_AT_KEY, LIVE_KEY, type LiveChannel } from "../src/core/live";
import { cleanSettings, migrateSettings, settings } from "../src/core/settings";
import { newlyClaimable, parseInventory } from "../src/core/drops";
import { hasDrops, languageOf } from "../src/core/tags";
import { PRIME_BUTTON, primeReadyAt } from "../src/core/prime";
import { ESSENTIAL, SCHEMA } from "../src/core/schema";
import { PRESETS, presetChanges } from "../src/core/presets";
import { DEFAULTS } from "../src/core/settings";
import { recordFollowers, recordLive, sessionAverage, sessionMinutes, startHeatmap, usualStart } from "../src/core/history";
import { fold, lowerSet, toggleIn, wordRegex } from "../src/core/util";
import { desktopStatus, favoritesChanged, initializeSyncState, syncfavorites } from "../src/core/desktop";

const ch = (login: string, viewers = 100): LiveChannel => ({
  login, name: login, title: "t", game: "g", viewers, startedAt: "2026-01-01T00:00:00Z", thumb: "", followed: true,
});
let now = 0;
Date.now = () => now;
const open = () => [...fake.tabs.values()].map((t) => t.url.split("/").pop()).sort();

beforeEach(() => {
  fake.reset();
  now = 0;
});

test("live check pages through followed streams and keeps its cache on a failed page", async () => {
  fake.local.twitchAuth = { token: "test", userId: "me", login: "me", expiresAt: 100000 };
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  const row = (login: string) => ({
    user_id: login, user_login: login, user_name: login, title: "", game_name: "", viewer_count: 1,
    started_at: "2026-01-01T00:00:00Z", thumbnail_url: "https://example.test/{width}x{height}",
  });
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      paths.push(url);
      return Response.json(url.includes("after=next")
        ? { data: [row("second")], pagination: {} }
        : { data: [row("first")], pagination: { cursor: "next" } });
    };
    assert.deepEqual((await refreshLive()).map((c) => c.login), ["first", "second"]);
    assert.equal(paths.length, 2);
    const cached = fake.local[LIVE_KEY];
    const checkedAt = fake.local[LIVE_AT_KEY];
    globalThis.fetch = async (input) => String(input).includes("after=next")
      ? new Response(null, { status: 503 })
      : Response.json({ data: [row("first")], pagination: { cursor: "next" } });
    await assert.rejects(refreshLive(), /live check failed/);
    assert.deepEqual(fake.local[LIVE_KEY], cached);
    assert.equal(fake.local[LIVE_AT_KEY], checkedAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quiet hours wrap midnight, and muted channels remain in the live list without notifications", async () => {
  const s = await settings.load();
  Object.assign(s, { notifyQuietHours: true, notifyQuietStart: 23, notifyQuietEnd: 8 });
  assert.equal(isQuietHour(s, new Date(2026, 0, 1, 23)), true);
  assert.equal(isQuietHour(s, new Date(2026, 0, 2, 7)), true);
  assert.equal(isQuietHour(s, new Date(2026, 0, 2, 8)), false);
  Object.assign(s, { notifyQuietStart: 9, notifyQuietEnd: 17 });
  assert.equal(isQuietHour(s, new Date(2026, 0, 2, 12)), true);
  assert.equal(isQuietHour(s, new Date(2026, 0, 2, 18)), false);

  Object.assign(fake.sync, { notifyLive: true, favorites: ["a", "b"], notifyMutedChannels: ["B"] });
  await updateAlerts([]); // baseline
  await updateAlerts([ch("a"), ch("b")]);
  assert.deepEqual(fake.notes, ["a is live"]);
  assert.deepEqual((fake.local.liveSeen as LiveChannel[]).map((c) => c.login), ["a", "b"]);

  const hour = new Date().getHours();
  Object.assign(fake.sync, { favorites: ["a", "b", "c"], notifyQuietHours: true, notifyQuietStart: hour, notifyQuietEnd: (hour + 1) % 24 });
  await updateAlerts([ch("a"), ch("b"), ch("c")]);
  assert.deepEqual(fake.notes, ["a is live"], "quiet hours suppress new alerts");
  assert.deepEqual((fake.local.liveSeen as LiveChannel[]).map((c) => c.login), ["a", "b", "c"], "quiet checks still advance the baseline");
});

test("auto-open: respects tab limit, biggest streams first", async () => {
  Object.assign(fake.sync, { autoOpen: true, favorites: ["a", "b", "c"], autoOpenMax: 2 });
  await syncAutoOpen([ch("a", 10), ch("b", 900), ch("c", 500)]);
  assert.deepEqual(open(), ["b", "c"]);
});

test("auto-open: closes only its own tabs when a channel ends", async () => {
  Object.assign(fake.sync, { autoOpen: true, favorites: ["a", "b"], autoOpenMax: 5, autoClose: true });
  await syncAutoOpen([ch("a"), ch("b")]);
  fake.tabs.set(99, { url: "https://www.twitch.tv/mine", active: false }); // a tab you opened
  await syncAutoOpen([ch("b")]);
  assert.deepEqual(open(), ["b", "mine"]);
});

test("auto-open: rotation is fair and never rotates the active tab", async () => {
  Object.assign(fake.sync, { autoOpen: true, favorites: ["a", "b", "c"], autoOpenMax: 2, autoOpenRotate: true, rotateMinutes: 30 });
  const live = [ch("a"), ch("b"), ch("c")];
  await syncAutoOpen(live);
  assert.deepEqual(open(), ["a", "b"]);
  now = 10 * 60_000;
  await syncAutoOpen(live);
  assert.deepEqual(open(), ["a", "b"], "no rotation mid-turn");
  now = 31 * 60_000;
  await syncAutoOpen(live);
  assert.deepEqual(open(), ["b", "c"], "oldest swapped for never-shown");
  [...fake.tabs.values()].forEach((t) => (t.active = true));
  now = 200 * 60_000;
  await syncAutoOpen(live);
  assert.deepEqual(open(), ["b", "c"], "active tabs are never rotated");
});

test("auto-open: with \"switch to them\", starring someone already live doesn't yank you there", async () => {
  Object.assign(fake.sync, { autoOpen: true, favorites: ["a"], autoOpenMax: 5, autoOpenFocus: true });
  await syncAutoOpen([ch("a")]);
  assert.deepEqual(open(), ["a"], "an existing favorite going live opens");

  Object.assign(fake.sync, { favorites: ["a", "b"] }); // you star b while b is live
  await syncAutoOpen([ch("a"), ch("b")]);
  assert.deepEqual(open(), ["a"], "starring a live channel doesn't open it");

  await syncAutoOpen([ch("a")]); // b goes offline…
  await syncAutoOpen([ch("a"), ch("b")]); // …and comes back
  assert.deepEqual(open(), ["a", "b"], "next time b goes live, it opens");
});

test("auto-open: background tabs open for favorites starred (or synced) while live", async () => {
  Object.assign(fake.sync, { autoOpen: true, favorites: ["a"], autoOpenMax: 5 });
  await syncAutoOpen([ch("a")]);
  Object.assign(fake.sync, { favorites: ["a", "b", "c"] });
  await syncAutoOpen([ch("a"), ch("b"), ch("c")]);
  assert.deepEqual(open(), ["a", "b", "c"]);
});

// Lets the auto-open queue finish handling a fired browser event (the fake platform is all in-memory promises).
const settle = () => new Promise((r) => setTimeout(r, 20));

test("auto-open: quitting the browser isn't dismissing each stream; closing one tab is", async () => {
  Object.assign(fake.sync, { autoOpen: true, favorites: ["a", "b"], autoOpenMax: 5, autoClose: false });
  await syncAutoOpen([ch("a"), ch("b")]);
  const [idA, idB] = [...fake.tabs.keys()];
  fake.tabs.delete(idA);
  fake.onRemoved.forEach((cb) => cb(idA, true)); // window closing
  fake.tabs.delete(idB);
  fake.onRemoved.forEach((cb) => cb(idB, false)); // you closed b
  await settle();
  await syncAutoOpen([ch("a"), ch("b")]);
  assert.deepEqual(open(), ["a"], "a reopens after a restart; b stays dismissed");
});

test("auto-open: a raided tab moves to the next live favorite", async () => {
  Object.assign(fake.sync, { autoOpen: true, favorites: ["a", "b"], autoOpenMax: 1, raidAction: "next" });
  fake.local.liveNow = [ch("a", 900), ch("b", 10)];
  await syncAutoOpen([ch("a", 900), ch("b", 10)]);
  assert.deepEqual(open(), ["a"], "tab limit 1: only the biggest");
  const [id] = [...fake.tabs.keys()];
  fake.tabs.set(id, { url: "https://www.twitch.tv/raidtarget?referrer=raid", active: false });
  fake.onUrlChanged.forEach((cb) => cb(id, "https://www.twitch.tv/raidtarget?referrer=raid"));
  await settle();
  assert.deepEqual(open(), ["b"], "the raided tab now shows b");
});

test("alerts: badge counts live favorites; first check never notifies", async () => {
  Object.assign(fake.sync, { favorites: ["a"], notifyLive: true, liveBadge: true });
  await updateAlerts([ch("a"), ch("b")]);
  assert.equal(fake.badge, "1");
  assert.deepEqual(fake.notes, []);
});

test("alerts: notifies a favorite going live and records who ended", async () => {
  Object.assign(fake.sync, { favorites: ["a", "c"], notifyLive: true });
  await updateAlerts([ch("a"), ch("b")]);
  now = 5 * 60_000;
  await updateAlerts([ch("a"), ch("c")]); // b ended, c went live
  assert.deepEqual(fake.notes, ["c is live"]);
  const ended = fake.local[ENDED_KEY] as EndedStream[];
  assert.deepEqual(ended.map((e) => e.login), ["b"]);
});

test("alerts: hidden channels are excluded from badge and ended list", async () => {
  Object.assign(fake.sync, { hiddenChannels: ["b"] });
  await updateAlerts([ch("a"), ch("b")]);
  assert.equal(fake.badge, "1");
  await updateAlerts([]);
  assert.deepEqual((fake.local[ENDED_KEY] as EndedStream[]).map((e) => e.login), ["a"]);
});

test("settings: cleanSettings keeps only known keys with matching shapes", () => {
  const out = cleanSettings({
    clickToPause: false, // ok
    volumeStep: "5", // wrong type
    highlightUsers: ["x", 3], // array with a non-string
    nicknameMap: ["not", "an", "object"], // array where an object belongs
    favorites: ["a"], // ok
    evil: true, // unknown
  });
  assert.deepEqual(out, { clickToPause: false, favorites: ["a"] });
});

test("backup: counters merge by max, prefs keep local values", () => {
  assert.deepEqual(mergeCounts({ a: 100, b: 5 }, { a: 50, b: 9, c: 1, d: "x" }), { a: 100, b: 9, c: 1 });
  assert.deepEqual(mergePrefs({ a: { quality: "720p" } }, { a: { quality: "160p" }, b: { volume: 0.4 } }), {
    a: { quality: "720p" },
    b: { volume: 0.4 },
  });
});

test("color: readable() reaches 4.5:1 on both themes", () => {
  const dark = luminance([24, 24, 27]);
  for (const c of ["rgb(0, 0, 255)", "rgb(30, 30, 30)", "rgb(138, 43, 226)"]) {
    const out = readable(c, true).match(/\d+/g)!.map(Number);
    assert.ok(contrast(luminance(out), dark) >= 4.5, `${c} → ${out}`);
  }
  const pale = readable("rgb(255, 255, 180)", false).match(/\d+/g)!.map(Number);
  assert.ok(contrast(luminance(pale), 1) >= 4.5);
  assert.equal(readable("not a color", true), "not a color");
});

// A stand-in for the desktop app's /favorites: newest-wins, like PairingListener.
type SyncList = { logins: string[]; updatedAt: string };

// The app's /favorites and /hidden lists, newest-wins like PairingListener. `calls` records /favorites only.
function fakeDesktop(list: SyncList, hidden: SyncList = { logins: [], updatedAt: new Date(0).toISOString() }) {
  const calls: string[] = [];
  const hiddenCalls: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    (path === "/hidden" ? hiddenCalls : calls).push(`${init?.method ?? "GET"} ${path}`);
    const incoming = JSON.parse(String(init?.body ?? "{}"));
    const current = path === "/hidden" ? hidden : list;
    const winner = Date.parse(incoming.updatedAt) > Date.parse(current.updatedAt) ? incoming : current;
    if (path === "/hidden") hidden = winner;
    else list = winner;
    return new Response(JSON.stringify(winner), { status: 200 });
  }) as typeof fetch;
  return { calls, hiddenCalls, current: () => list, hidden: () => hidden };
}

test("desktop sync: hidden channels sync on their own stamp", async () => {
  fake.local.desktopToken = "t";
  Object.assign(fake.sync, { favorites: ["fav"], hiddenChannels: ["mine"] });
  fakeDesktop({ logins: ["fav"], updatedAt: new Date(0).toISOString() }, { logins: ["spammy"], updatedAt: new Date(9000).toISOString() });
  await syncfavorites();
  assert.deepEqual(fake.sync.hiddenChannels, ["spammy"]);
  assert.deepEqual(fake.sync.favorites, ["fav"]);
  assert.equal(fake.local.hiddenUpdatedAt, 9000);
});

test("desktop sync: does nothing until paired", async () => {
  const desktop = fakeDesktop({ logins: ["x"], updatedAt: new Date(0).toISOString() });
  await syncfavorites();
  assert.deepEqual(desktop.calls, []);
});

test("desktop sync: stale pairing token is replaced when the app resets", async () => {
  fake.local.desktopToken = "old";
  const paths: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path === "/ping") return Response.json({ paired: false });
    if (path === "/pair") return Response.json({ token: "new" });
    return Response.json({ logins: [], updatedAt: new Date(0).toISOString() });
  }) as typeof fetch;
  assert.equal(await desktopStatus(), "paired");
  assert.equal(fake.local.desktopToken, "new");
  assert.deepEqual(paths, ["/ping", "/pair", "/favorites", "/hidden"]);
});

test("desktop sync: a newer local change wins and is sent to the app", async () => {
  fake.local.desktopToken = "t";
  await initializeSyncState();
  Object.assign(fake.sync, { favorites: ["mine"] });
  const desktop = fakeDesktop({ logins: ["old"], updatedAt: new Date(1000).toISOString() });
  now = 5000;
  await favoritesChanged(["mine"]);
  assert.deepEqual(desktop.current().logins, ["mine"]);
  assert.deepEqual(fake.sync.favorites, ["mine"]);
});

test("desktop sync: a newer app list is adopted, without bouncing it back", async () => {
  fake.local.desktopToken = "t";
  fake.local.favoritesUpdatedAt = 1000;
  Object.assign(fake.sync, { favorites: ["mine"] });
  const desktop = fakeDesktop({ logins: ["from-app"], updatedAt: new Date(9000).toISOString() });
  await syncfavorites();
  assert.deepEqual(fake.sync.favorites, ["from-app"]);
  assert.equal(fake.local.favoritesUpdatedAt, 9000);
  // The storage-change event for our own adoption must not stamp it as a new local change.
  now = 20_000;
  await favoritesChanged(["from-app"]);
  assert.equal(fake.local.favoritesUpdatedAt, 9000);
  assert.equal(desktop.calls.length, 1);
});

test("desktop sync: independent channel edits merge and removals stay removed", async () => {
  fake.local.desktopToken = "t";
  await initializeSyncState();
  const remote = { present: true, updatedAt: new Date(6000).toISOString() };
  let appChanges: Record<string, { present: boolean; updatedAt: string }> = { remote };
  now = 5000;
  Object.assign(fake.sync, { favorites: ["local"] });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const incoming = JSON.parse(String(init?.body)) as { changes: typeof appChanges };
    if (path === "/hidden") return Response.json({ logins: [], updatedAt: new Date(0).toISOString(), changes: {} });
    for (const [login, entry] of Object.entries(incoming.changes)) {
      const old = appChanges[login];
      if (!old || Date.parse(entry.updatedAt) > Date.parse(old.updatedAt)) appChanges[login] = entry;
    }
    return Response.json({
      logins: Object.entries(appChanges).filter(([, e]) => e.present).map(([login]) => login),
      updatedAt: new Date(Math.max(...Object.values(appChanges).map((e) => Date.parse(e.updatedAt)))).toISOString(),
      changes: appChanges,
    });
  }) as typeof fetch;
  await favoritesChanged(["local"]);
  assert.deepEqual(new Set(fake.sync.favorites as string[]), new Set(["local", "remote"]));
  now = 7000;
  await settings.set({ favorites: ["remote"] });
  await favoritesChanged(["remote"]);
  assert.equal(appChanges.local.present, false);
  assert.deepEqual(fake.sync.favorites, ["remote"]);
});

test("settings: migration renames old keys and splits the old favorites switch", async () => {
  // An earlier build: favorites list lived under autoOpenChannels, and "favorites" was the sidebar-pin switch.
  Object.assign(fake.sync, { autoOpenChannels: ["a", "b"], favorites: false, statChatters: false });
  await migrateSettings();
  assert.deepEqual(fake.sync, { favorites: ["a", "b"], pinFavorites: false, chatterCount: false });
  await migrateSettings(); // idempotent
  assert.deepEqual(fake.sync, { favorites: ["a", "b"], pinFavorites: false, chatterCount: false });
});

test("settings: load() replaces wrongly-shaped stored values with defaults", async () => {
  Object.assign(fake.sync, { favorites: true, volumeStep: 7 }); // an un-migrated boolean where a list belongs
  const s = await settings.load();
  assert.deepEqual(s.favorites, []);
  assert.equal(s.volumeStep, 7);
});

test("util: lowerSet, toggleIn, wordRegex", () => {
  assert.deepEqual([...lowerSet([" @Foo", "foo", "Bar", ""])], ["foo", "bar"]);
  assert.deepEqual(toggleIn(["Foo", "bar"], "foo"), ["bar"]);
  assert.deepEqual(toggleIn(["bar"], "Foo"), ["bar", "Foo"]);
  const re = wordRegex(["spoiler", "c++", " "])!;
  assert.ok(re.test("no Spoiler please"));
  assert.ok(!re.test("spoilers"), "whole words only");
  assert.ok(re.test("I like c++ a lot"), "regex characters are escaped");
  assert.equal(wordRegex([" ", ""]), null);
});

test("format: durations, clock and compact numbers", () => {
  assert.equal(fmtDuration(59_000), "0m");
  assert.equal(fmtDuration(45 * 60_000), "45m");
  assert.equal(fmtDuration((2 * 60 + 5) * 60_000), "2h 05m");
  assert.equal(fmtDuration(150 * 3_600_000), "150h");
  assert.equal(fmtClock((4 * 3600 + 7 * 60 + 28) * 1000), "4:07:28");
  assert.equal(fmtCompact(950), "950");
  assert.equal(fmtCompact(4831), "4.8K");
  assert.equal(fmtCompact(25_100), "25K");
});

test("util: fold matches titles regardless of case and accents", () => {
  assert.equal(fold("Pokémon ÄËÖÜ"), "pokemon aeou");
  const re = wordRegex(["Pokémon", "gambling"].map(fold))!;
  assert.ok(re.test(fold("POKEMON marathon")));
  assert.ok(re.test(fold("late night Gámbling")));
  assert.ok(!re.test(fold("pokemonsters")), "whole words only");
});

const inventory = (minutes: number, claimed = false) => ({
  currentUser: { inventory: { dropCampaignsInProgress: [{
    id: "c1", name: "Summer Event", endAt: "2026-10-01T00:00:00Z", game: { displayName: "Rust", boxArtURL: "art" },
    timeBasedDrops: [{ id: "d1", name: "fallback", requiredMinutesWatched: 120,
      benefitEdges: [{ benefit: { name: "Hazmat Skin", imageAssetURL: "img" } }],
      self: { currentMinutesWatched: minutes, isClaimed: claimed, dropInstanceID: minutes >= 120 ? "inst" : null } }],
  }] } },
});

test("drops: parses Twitch's Inventory into campaigns", () => {
  const [c] = parseInventory(inventory(45));
  assert.equal(c.game, "Rust");
  assert.deepEqual(c.drops[0], { id: "d1", name: "Hazmat Skin", image: "img", minutes: 45, required: 120, claimed: false, claimable: false });
  assert.equal(parseInventory(inventory(130))[0].drops[0].minutes, 120, "progress capped at the requirement");
  assert.deepEqual(parseInventory(null), [], "logged out / unexpected shape → nothing");
  assert.deepEqual(parseInventory({ currentUser: { inventory: {} } }), []);
});

test("drops: notifies once when a drop becomes claimable, not when claimed", () => {
  const at = (m: number, claimed = false) => ({ at: 0, campaigns: parseInventory(inventory(m, claimed)) });
  assert.equal(newlyClaimable(at(60), at(120)).length, 1, "just finished");
  assert.equal(newlyClaimable(at(120), at(120)).length, 0, "still claimable: no repeat");
  assert.equal(newlyClaimable(at(120), at(120, true)).length, 0, "claimed is not claimable");
  assert.equal(newlyClaimable(undefined, at(120)).length, 1, "first check reports what's ready");
});

test("streams: language and Drops from tags, in the streamer's own language", () => {
  assert.equal(languageOf(["news", "English", "DropsEnabled"]), "EN");
  assert.equal(languageOf(["Español", "DropsActivados"]), "ES");
  assert.equal(languageOf(["Japanese"]), "JA");
  assert.equal(languageOf(["gaming"]), null);
  assert.ok(hasDrops(["DropsEnabled"]) && hasDrops(["DropsActivados"]) && hasDrops(["DropsAktiviert"]));
  assert.ok(!hasDrops(["Dropshipping", "dropshot"]), "not every word starting with drops");
});

test("prime: free again 30 days after use; matches Twitch's Prime button labels", () => {
  assert.equal(primeReadyAt({ login: "a", at: 0 }), 30 * 86_400_000);
  for (const label of ["Subscribe free with Prime", "Use Prime Sub", "Prime Gaming"]) assert.ok(PRIME_BUTTON.test(label), label);
  assert.ok(!PRIME_BUTTON.test("Subscribe"), "a plain subscribe isn't a Prime use");
  assert.ok(!PRIME_BUTTON.test("Primetime"), "whole word only");
});

test("history: one session per stream with peak, average and time per game", () => {
  const start = "2026-10-01T18:00:00Z";
  const t0 = Date.parse(start);
  const sample = (viewers: number, game: string) => [{ login: "A", viewers, startedAt: start, game, title: "t" }];
  let h = recordLive({}, sample(100, "Rust"), t0 + 5 * 60_000);
  h = recordLive(h, sample(300, "Rust"), t0 + 7 * 60_000);
  h = recordLive(h, sample(200, "Chess"), t0 + 9 * 60_000);
  h = recordLive(h, sample(200, "Chess"), t0 + 60 * 60_000); // 51-minute gap: not counted as game time
  const [s] = h.a;
  assert.equal(h.a.length, 1, "same started_at = same session, login lowercased");
  assert.equal(s.peak, 300);
  assert.equal(sessionAverage(s), 200);
  assert.equal(Math.round(sessionMinutes(s)), 60);
  assert.deepEqual(s.games, { Rust: 2, Chess: 2 });
  h = recordLive(h, [{ login: "a", viewers: 50, startedAt: "2026-10-02T18:00:00Z", game: "Rust", title: "t" }], t0 + 86_400_000);
  assert.equal(h.a.length, 2, "a new started_at starts a new session");
});

test("history: one follower reading per day; start heatmap and usual start", () => {
  let f = recordFollowers({}, "a", 100, "2026-10-01");
  f = recordFollowers(f, "a", 110, "2026-10-01");
  f = recordFollowers(f, "a", 120, "2026-10-02");
  assert.deepEqual(f.a, [["2026-10-01", 110], ["2026-10-02", 120]]);
  const starts = [1, 8, 15, 22].map((d) => new Date(2026, 9, d, 19, 0).toISOString()); // four Thursdays, 7pm local
  const grid = startHeatmap(starts);
  assert.equal(grid[3][19], 4, "Thursday (Mon = 0) at 19:00");
  assert.deepEqual(usualStart(grid), { days: [3], hour: 19 });
  assert.equal(usualStart(startHeatmap(starts.slice(0, 2))), null, "too little data to say");
});

test("settings: every Essentials row exists, and its parent switch is also an Essential", () => {
  const rows = new Map(SCHEMA.flatMap((c) => c.rows).map((r) => [r.key, r]));
  for (const key of ESSENTIAL) {
    const row = rows.get(key);
    assert.ok(row, `${key} has a panel row`);
    if (row.requires) assert.ok(ESSENTIAL.has(row.requires), `${key} needs ${row.requires} in Essentials too`);
  }
});

test("settings: each panel group is one block (a split group shows its heading twice)", () => {
  for (const c of SCHEMA) {
    const seen: string[] = [];
    for (const r of c.rows) if (r.group && r.group !== seen.at(-1)) {
      assert.ok(!seen.includes(r.group), `${c.label}: "${r.group}" is split by another group`);
      seen.push(r.group);
    }
  }
});

test("presets: switches only, never both on and off; changes are only what differs", () => {
  for (const p of PRESETS) {
    for (const k of [...p.on, ...p.off]) assert.equal(typeof DEFAULTS[k], "boolean", `${p.name}: ${k} is an on/off switch`);
    assert.deepEqual(p.on.filter((k) => p.off.includes(k)), [], `${p.name} lists a setting as both on and off`);
  }
  const lurker = PRESETS.find((p) => p.id === "lurker")!;
  const once = { ...DEFAULTS, ...presetChanges(lurker, { ...DEFAULTS }) };
  assert.ok(once.autoOpen && once.lurkMode && !once.autoOpenFocus);
  assert.deepEqual(presetChanges(lurker, once), {}, "applying twice changes nothing");
  const everything = PRESETS.find((p) => p.id === "everything")!;
  assert.ok(everything.on.includes("autoClaim") && !everything.on.includes("grayscale") && !everything.on.includes("skipWarnings"));
});
