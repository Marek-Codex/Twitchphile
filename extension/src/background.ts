// Service worker: the always-on half. Message router, the live-check alarm, and reactions to settings
// changes. Lives in the background so favorites keep updating and notifications fire even with no
// Twitch tab open — the desk never fully closes.
import { channelUrl } from "./core/channels";
import { KICK_FOLLOWS_KEY, type KickFollow } from "./core/kick-live";
import { platform } from "@platform";
import { updateAlerts } from "./core/alerts";
import { connect, disconnect, getAuth, ownAuth } from "./core/auth";
import { clearDismissed, isLurkTab, syncAutoOpen } from "./core/auto-open";
import { addDaily, CLAIMS_KEY, increment, WATCH_KEY } from "./core/channel-data";
import { refreshFollows } from "./core/follows";
import { getClipDownload, getStream, getVideoStart } from "./core/gql";
import { LIVE_KEY, refreshLive, type LiveChannel } from "./core/live";
import { refreshSchedule } from "./core/schedule";
import { autoPair, desktopStatus, favoritesChanged, initializeSyncState, listChanged, offerSession, pairDesktop, syncfavorites } from "./core/desktop";
import { migrateSettings, settings } from "./core/settings";
import { DROPS_KEY, DROPS_STALE_MS, newlyClaimable, type DropCampaign, type DropsState } from "./core/drops";
import { pushDrops, pushKickFollows } from "./core/desktop";
import { channelHistory, channelStats, recordCheck } from "./core/channel-stats";
import { PRIME_KEY, primeReadyAt, type PrimeUse } from "./core/prime";

let dropsLease = 0;

const account = async () => {
  const a = await getAuth();
  return a ? { login: a.login, borrowed: Boolean(a.borrowed) } : null;
};

// Lend our own sign-in to a paired desktop app that has none.
async function shareSignIn() {
  const own = await ownAuth();
  if (own) await offerSession(own.token);
}

// One live check: refresh who's live, then everything that depends on it.
let ticking: Promise<LiveChannel[]> | null = null;
async function runTick() {
  await autoPair().catch(() => {});
  const live = await refreshLive();
  recordCheck(live).catch(() => {}); // channel history for the stats drawer
  await Promise.all([syncAutoOpen(live), updateAlerts(live), refreshSchedule().catch(() => []), syncfavorites(), shareSignIn()]);
  return live;
}

// The alarm, popup refresh and settings can all request a check at once. Share the same
// result so a second request cannot consume extra API quota or race the alerts baseline.
function tick(): Promise<LiveChannel[]> {
  if (ticking) return ticking;
  const run = runTick();
  ticking = run;
  void run.finally(() => { if (ticking === run) ticking = null; }).catch(() => {});
  return run;
}

const cachedLive = async () => (await platform.local.get<LiveChannel[]>(LIVE_KEY)) ?? [];

const handlers: Record<string, (msg: Record<string, unknown>, tabId?: number) => unknown> = {
  "auth:status": account,
  "auth:connect": async () => {
    await connect();
    void tick().catch(() => {}); // a temporary Helix failure must not fail sign-in
    return account();
  },
  "auth:disconnect": async () => {
    await disconnect();
    await tick();
    return null;
  },
  "live:refresh": async (msg) => {
    if (msg.fresh) await clearDismissed();
    return tick();
  },
  "kick:follows": async (msg) => {
    const next = (msg.follows as KickFollow[]) ?? [];
    const prev = (await platform.local.get<KickFollow[]>(KICK_FOLLOWS_KEY)) ?? [];
    await platform.local.set(KICK_FOLLOWS_KEY, next);
    void pushKickFollows(next.map((f) => f.slug));
    if (next.map((f) => f.slug).join() !== prev.map((f) => f.slug).join()) void tick().catch(() => {});
  },
  "follows:refresh": (msg) => refreshFollows(Boolean(msg.force)),
  "desktop:status": desktopStatus,
  "desktop:pair": async () => {
    const status = await pairDesktop();
    await shareSignIn();
    return status;
  },
  stream: (msg) => getStream(String(msg.login)),
  video: (msg) => getVideoStart(String(msg.id)),
  "watch:add": (msg) => {
    addDaily(Number(msg.seconds));
    return increment(WATCH_KEY, String(msg.login), Number(msg.seconds));
  },
  "claim:add": (msg) => increment(CLAIMS_KEY, String(msg.login), 1),
  "clip:download": async (msg) => {
    const clip = await getClipDownload(String(msg.slug));
    if (!clip) return { ok: false, error: "Clip not found" };
    await platform.download(clip.url, clip.filename);
    return { ok: true };
  },
  // One tab at a time refreshes drop progress: whoever asks first while the copy is stale gets a lease.
  "drops:due": async () => {
    const cached = await platform.local.get<DropsState>(DROPS_KEY);
    if (cached && Date.now() - cached.at < DROPS_STALE_MS) return false;
    if (Date.now() < dropsLease) return false;
    dropsLease = Date.now() + 30_000;
    return true;
  },
  "drops:update": async (msg) => {
    dropsLease = 0;
    if (!Array.isArray(msg.campaigns)) return;
    const prev = await platform.local.get<DropsState>(DROPS_KEY);
    const next: DropsState = { at: Date.now(), campaigns: msg.campaigns as DropCampaign[] };
    await platform.local.set(DROPS_KEY, next);
    if (settings.get().dropsNotify)
      for (const { campaign, drop } of newlyClaimable(prev, next))
        platform.notify(`drop:${drop.id}`, "Drop ready to claim", `${drop.name} · ${campaign.game || campaign.name}`);
    pushDrops(next);
  },
  // Prime sub used (detected in the subscribe flow, or marked by hand in the panel): remind in 30 days.
  // `at` lets the panel back-date it; null clears the reminder.
  "prime:used": async (msg) => {
    if (msg.clear) {
      await platform.local.remove(PRIME_KEY);
      return platform.scheduleAt("prime", null);
    }
    const use: PrimeUse = { login: String(msg.login ?? ""), at: Number(msg.at) || Date.now() };
    await platform.local.set(PRIME_KEY, use);
    await platform.scheduleAt("prime", primeReadyAt(use));
  },
  "channel:stats": (msg) => channelStats(String(msg.login)),
  "channel:history": (msg) => channelHistory(String(msg.login), typeof msg.followers === "number" ? msg.followers : null),
  // Content scripts can't raise desktop notifications themselves.
  notify: (msg) => platform.notify(String(msg.id), String(msg.title), String(msg.message)),
  // Auto-opened tabs ask on load what to do: lurk mode (keep quality) and/or start muted.
  "lurk:check": async (_msg, tabId) => {
    if (!(await isLurkTab(tabId))) return null;
    const s = await settings.load();
    return { lurk: s.lurkMode, mute: s.autoOpenMuted };
  },
};

platform.onMessage((msg, tabId) => handlers[msg.type]?.(msg, tabId));
platform.onInstalled(() => migrateSettings());
void initializeSyncState().then(() => autoPair()).catch(() => {}); // seed legacy lists before first sync
// Timer-driven checks rest while the computer is locked: nobody's there to see them, and it saves API calls
// overnight. The first check after unlocking catches up (alerts compare against the last list seen).
platform.alarm("live", async () => {
  if (!(await platform.isLocked())) await tick().catch(() => {}); // keep last good state; retry at the next alarm
});
settings.load().then((s) => platform.schedule("live", s.pollMinutes));
platform.alarm("prime", async () => {
  const use = await platform.local.get<PrimeUse>(PRIME_KEY);
  if (!use || !settings.get().primeReminder) return;
  platform.notify("prime:" + use.login, "Your Prime sub is free again", use.login ? `Resub ${use.login}, or give it to someone new.` : "Give it to a channel you like.");
});

platform.onNotificationClick((id) => {
  if (id.startsWith("prime:")) return void platform.tabs.open(id.slice(6) ? channelUrl(id.slice(6)) : "https://www.twitch.tv/subscriptions", { active: true });
  if (id.startsWith("drop:")) return void platform.tabs.open("https://www.twitch.tv/drops/inventory", { active: true });
  if (id.startsWith("live:")) platform.tabs.open(channelUrl(id.slice(5)), { active: true });
});

// React to settings right away, using the cached live list where possible (no extra API call).
settings.onChange(async (changed) => {
  const has = (...keys: string[]) => keys.some((k) => k in changed);
  if (has("pollMinutes")) platform.schedule("live", settings.get().pollMinutes);
  if (has("watchChannels")) return tick().catch(() => {}); // a new channel to look up
  if (has("favorites")) {
    refreshSchedule(true).catch(() => {});
    favoritesChanged(settings.get().favorites);
  }
  if (has("hiddenChannels")) listChanged("hiddenChannels", settings.get().hiddenChannels);
  if (has("favorites", "autoOpen", "autoOpenAll", "autoOpenMax", "autoOpenRotate", "autoClose")) syncAutoOpen(await cachedLive());
  if (has("favorites", "hiddenChannels", "liveBadge")) updateAlerts(await cachedLive());
});
