// Tabs that Twitchphile auto-opened ask the background on load whether to lurk (keep quality in the
// background) and/or start muted. Muting goes through Twitch's own button so you can unmute normally.
import { platform } from "@platform";
import { player } from "../../core/player";
import { isMuted, setMuted } from "../../core/twitch";

const MUTE_TRIES = 60; // the player can take a while to mount; give up after a minute

export async function applyLurk() {
  const r = await platform.send<{ lurk: boolean; mute: boolean } | null>({ type: "lurk:check" });
  if (!r) return;
  if (r.lurk) player.lurk();
  if (!r.mute) return;
  let tries = 0;
  const t = setInterval(() => {
    if ((setMuted(true) && isMuted()) || ++tries > MUTE_TRIES) clearInterval(t);
  }, 1000);
}
