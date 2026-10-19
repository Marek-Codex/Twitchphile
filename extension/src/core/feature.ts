// The feature contract — the spine of the whole extension. A feature is gated by one setting; start()
// returns its own cleanup, so toggling a feature off is exactly as clean as turning it on. Features run
// on Twitch unless they opt into Kick too. One shape, ninety-odd features, zero special cases.
import { settings, type SettingKey } from "./settings";
import { SITE, type Site } from "./site";

// A feature is gated by one setting; start() returns its own cleanup. Features run on Twitch unless they list the
// sites they support — the same setting then applies on every site listed (one set of toggles, not one per site).
export interface Feature {
  key: SettingKey;
  sites?: Site[];
  start(): () => void;
}

export function runFeatures(all: Feature[]) {
  const features = all.filter((f) => (f.sites ?? ["twitch"]).includes(SITE));
  const stops = new Map<SettingKey, () => void>();
  const sync = () => {
    const s = settings.get();
    for (const f of features) {
      const on = Boolean(s[f.key]);
      if (on && !stops.has(f.key)) stops.set(f.key, f.start());
      else if (!on && stops.has(f.key)) {
        stops.get(f.key)!();
        stops.delete(f.key);
      }
    }
  };
  const off = settings.onChange(sync);
  sync();
  // Stops every running feature (used when the extension is reloaded out from under this page).
  return () => {
    off();
    stops.forEach((stop) => {
      try {
        stop();
      } catch {}
    });
    stops.clear();
  };
}

export function listen<K extends keyof DocumentEventMap>(
  type: K,
  fn: (e: DocumentEventMap[K]) => void,
  opts: AddEventListenerOptions = { capture: true },
) {
  document.addEventListener(type, fn, opts);
  return () => document.removeEventListener(type, fn, opts);
}
