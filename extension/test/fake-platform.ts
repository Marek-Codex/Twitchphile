// In-memory stand-in for src/platform, aliased as "@platform" when tests are bundled.
import type { Platform } from "../src/platform/types";

export const fake = {
  sync: {} as Record<string, unknown>,
  local: {} as Record<string, unknown>,
  tabs: new Map<number, { url: string; active: boolean }>(),
  log: [] as string[],
  badge: "",
  notes: [] as string[],
  nextId: 1,
  // Browser events the code under test subscribes to, so tests can fire them.
  onRemoved: [] as ((id: number, windowClosing: boolean) => void)[],
  onUrlChanged: [] as ((id: number, url: string) => void)[],
  reset() {
    this.sync = {};
    this.local = {};
    this.tabs.clear();
    this.log = [];
    this.badge = "";
    this.notes = [];
    this.nextId = 1;
  },
};

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const name = (url: string) => url.split("/").pop();

export const platform: Platform = {
  alive: () => true,
  storage: {
    get: async (defaults) => ({ ...defaults, ...clone(fake.sync) }) as typeof defaults,
    set: async (values) => void Object.assign(fake.sync, clone(values)),
    remove: async (keys) => keys.forEach((k) => delete fake.sync[k]),
    onChange: () => () => {},
  },
  local: {
    get: async <T>(key: string) => clone(fake.local[key]) as T | undefined,
    set: async (key, value) => void (fake.local[key] = clone(value)),
    remove: async (key) => void delete fake.local[key],
    onChange: () => () => {},
  },
  version: "test",
  url: (p) => p,
  send: async () => undefined as never,
  onMessage() {},
  auth: { redirectUrl: (p) => p, launch: async () => "" },
  tabs: {
    open: async (url) => {
      const id = fake.nextId++;
      fake.tabs.set(id, { url, active: false });
      fake.log.push(`open ${name(url)}`);
      return id;
    },
    close: async (id) => {
      fake.log.push(`close ${name(fake.tabs.get(id)?.url ?? "")}`);
      fake.tabs.delete(id);
    },
    exists: async (id) => fake.tabs.has(id),
    isActive: async (id) => fake.tabs.get(id)?.active ?? false,
    anyMatching: async () => false,
    onRemoved: (cb) => void fake.onRemoved.push(cb),
    navigate: async (id, url) => void fake.tabs.set(id, { url, active: fake.tabs.get(id)?.active ?? false }),
    onUrlChanged: (cb) => void fake.onUrlChanged.push(cb),
  },
  download: async () => {},
  badge: (t) => void (fake.badge = t),
  notify: (_id, title) => void fake.notes.push(title),
  onNotificationClick() {},
  alarm() {},
  isLocked: async () => false,
  scheduleAt: async () => {},
  schedule: async () => {},
  onInstalled() {},
};
