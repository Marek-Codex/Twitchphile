import type { Platform } from "./types";

// After the extension reloads, content scripts already in open tabs are orphaned: chrome.* throws
// "Extension context invalidated". Calls from content scripts go through here and quietly no-op instead.
const alive = () => {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
};
const guard = async <T,>(call: () => Promise<T>, fallback: T): Promise<T> => {
  if (!alive()) return fallback;
  try {
    return await call();
  } catch (e) {
    if (!alive()) return fallback;
    throw e;
  }
};

type StorageListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
const onStorage = (fn: StorageListener) => {
  chrome.storage.onChanged.addListener(fn);
  return () => chrome.storage.onChanged.removeListener(fn);
};

export const platform: Platform = {
  alive,
  version: chrome.runtime.getManifest().version,
  url: (path) => chrome.runtime.getURL(path),
  storage: {
    get: (defaults) => guard(() => chrome.storage.sync.get(defaults) as Promise<typeof defaults>, defaults),
    set: (values) => guard(() => chrome.storage.sync.set(values), undefined),
    remove: (keys) => guard(() => chrome.storage.sync.remove(keys), undefined),
    onChange: (cb) =>
      onStorage((changes, area) => {
        if (area === "sync") cb(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
      }),
  },
  local: {
    get: <T,>(key: string) => guard(async () => (await chrome.storage.local.get(key))[key] as T | undefined, undefined),
    set: (key, value) => guard(() => chrome.storage.local.set({ [key]: value }), undefined),
    remove: (key) => guard(() => chrome.storage.local.remove(key), undefined),
    onChange: (key, cb) =>
      onStorage((changes, area) => {
        if (area === "local" && key in changes) cb(changes[key].newValue);
      }),
  },
  send: (message) => guard(() => chrome.runtime.sendMessage(message), undefined as never),
  onMessage(cb) {
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      Promise.resolve(cb(message, sender.tab?.id)).then(respond, (e) => respond({ error: String(e) }));
      return true;
    });
  },
  auth: {
    redirectUrl: (path) => chrome.identity.getRedirectURL(path),
    launch: async (url) => {
      const result = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
      if (!result) throw new Error("Authorization was canceled.");
      return result;
    },
  },
  tabs: {
    // No tab-level muting: Chromium won't let users unmute extension-muted tabs. Lurk tabs mute Twitch's player instead.
    open: async (url, { active = false } = {}) => (await chrome.tabs.create({ url, active })).id,
    close: (id) => chrome.tabs.remove(id).catch(() => {}),
    exists: (id) => chrome.tabs.get(id).then(() => true, () => false),
    isActive: (id) => chrome.tabs.get(id).then((t) => t.active, () => false),
    anyMatching: async (urlPattern) => (await chrome.tabs.query({ url: urlPattern })).length > 0,
    onRemoved: (cb) => chrome.tabs.onRemoved.addListener((id, info) => cb(id, info.isWindowClosing)),
    navigate: async (id, url) => void (await chrome.tabs.update(id, { url }).catch(() => {})),
    onUrlChanged: (cb) => chrome.tabs.onUpdated.addListener((id, change) => change.url && cb(id, change.url)),
  },
  download: async (url, filename) => {
    await chrome.downloads.download({ url, filename });
  },
  badge(text) {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: "#3CA0FF" });
    chrome.action.setBadgeTextColor?.({ color: "#041018" });
  },
  notify(id, title, message) {
    chrome.notifications.create(id, { type: "basic", iconUrl: "icons/128.png", title, message, priority: 0 });
  },
  onNotificationClick(cb) {
    chrome.notifications.onClicked.addListener((id) => {
      chrome.notifications.clear(id);
      cb(id);
    });
  },
  onInstalled: (cb) => chrome.runtime.onInstalled.addListener(() => cb()),
  isLocked: async () => (await chrome.idle.queryState(60)) === "locked",
  async scheduleAt(name, when) {
    if (when == null) await chrome.alarms.clear(name);
    else await chrome.alarms.create(name, { when: Math.max(when, Date.now() + 60_000) });
  },
  alarm(name, cb) {
    chrome.alarms.onAlarm.addListener((a) => a.name === name && cb());
  },
  // (Re)creates only when missing or the period changed, so worker restarts don't reset the timer.
  async schedule(name, periodMinutes) {
    const a = await chrome.alarms.get(name);
    if (a?.periodInMinutes !== periodMinutes) await chrome.alarms.create(name, { periodInMinutes: periodMinutes, delayInMinutes: 0.1 });
  },
};
