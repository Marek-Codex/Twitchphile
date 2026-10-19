// Remembers quality + volume per channel: learns when you change them, re-applies when you come back.
import { platform } from "@platform";
import { PREFS_KEY, type ChannelPrefs } from "../../core/channel-data";
import type { Feature } from "../../core/feature";
import { player, type PlayerState } from "../../core/player";
import { liveChannelLogin } from "../../core/twitch";


const GRACE_MS = 4000; // ignore changes right after we apply (Twitch settling, our own set calls)

export const channelPrefs: Feature = {
  key: "channelPrefs",
  start() {
    let login = "";
    let applied = false;
    let graceUntil = 0;
    let last: Pick<PlayerState, "quality" | "volume"> | null = null;
    let saveTimer = 0;

    const save = (s: PlayerState) => {
      clearTimeout(saveTimer);
      const who = login;
      // Debounced: dragging the volume slider fires many changes.
      saveTimer = window.setTimeout(async () => {
        const all = (await platform.local.get<ChannelPrefs>(PREFS_KEY)) ?? {};
        all[who] = { quality: s.quality ?? undefined, volume: s.volume ?? undefined };
        await platform.local.set(PREFS_KEY, all);
      }, 1000);
    };

    const unsub = player.subscribe(async (s) => {
      const now = liveChannelLogin();
      if (!now) return;
      if (now !== login) (login = now), (applied = false), (last = null);
      if (!s.quality) return; // player not ready yet

      if (!applied) {
        applied = true;
        graceUntil = Date.now() + GRACE_MS;
        const p = ((await platform.local.get<ChannelPrefs>(PREFS_KEY)) ?? {})[login];
        if (p?.quality && p.quality !== s.quality) player.setQuality(p.quality);
        if (p?.volume != null && Math.abs(p.volume - (s.volume ?? -1)) > 0.01) player.setVolume(p.volume);
        last = { quality: s.quality, volume: s.volume };
        return;
      }
      const changed = last && (s.quality !== last.quality || Math.abs((s.volume ?? 0) - (last.volume ?? 0)) > 0.01);
      last = { quality: s.quality, volume: s.volume };
      if (changed && Date.now() > graceUntil) save(s);
    });

    return () => (unsub(), clearTimeout(saveTimer));
  },
};
