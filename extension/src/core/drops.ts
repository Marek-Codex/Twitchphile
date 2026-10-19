// Drop campaigns you're progressing, as a compact summary. Twitch only reveals drop progress to its own website
// session, so a twitch.tv tab reads it (page.ts → "drops") and hands the summary here; the session itself never
// leaves the page. The background keeps the latest copy, notifies when a drop becomes claimable, and passes the
// summary (nothing else) to the paired desktop app.
export const DROPS_KEY = "drops";
export const DROPS_STALE_MS = 4 * 60_000; // tabs skip fetching while the cached copy is younger than this

export interface Drop {
  id: string;
  name: string; // the reward, e.g. "Epic Skin"
  image: string;
  minutes: number; // watched so far
  required: number;
  claimed: boolean;
  claimable: boolean; // finished, waiting for you to claim it
}

export interface DropCampaign {
  id: string;
  name: string;
  game: string;
  gameArt: string;
  endsAt: string;
  drops: Drop[];
}

export interface DropsState {
  at: number;
  campaigns: DropCampaign[];
}

// Shapes Twitch's Inventory answer into campaigns. Defensive: any field Twitch renames just drops out.
export function parseInventory(data: any): DropCampaign[] {
  const list = data?.currentUser?.inventory?.dropCampaignsInProgress;
  if (!Array.isArray(list)) return [];
  return list.map((c: any): DropCampaign => ({
    id: String(c?.id ?? ""),
    name: String(c?.name ?? ""),
    game: String(c?.game?.displayName ?? c?.game?.name ?? ""),
    gameArt: String(c?.game?.boxArtURL ?? ""),
    endsAt: String(c?.endAt ?? ""),
    drops: (Array.isArray(c?.timeBasedDrops) ? c.timeBasedDrops : []).map((d: any): Drop => {
      const self = d?.self ?? {};
      const minutes = Number(self.currentMinutesWatched) || 0;
      const required = Number(d?.requiredMinutesWatched) || 0;
      const claimed = Boolean(self.isClaimed);
      const benefit = d?.benefitEdges?.[0]?.benefit ?? {};
      return {
        id: String(d?.id ?? ""),
        name: String(benefit.name ?? d?.name ?? "Drop"),
        image: String(benefit.imageAssetURL ?? ""),
        minutes: Math.min(minutes, required || minutes),
        required,
        claimed,
        claimable: !claimed && Boolean(self.dropInstanceID) && required > 0 && minutes >= required,
      };
    }),
  })).filter((c) => c.id && c.drops.length);
}

// Drops that became claimable since the previous state (for "ready to claim" notifications).
export function newlyClaimable(prev: DropsState | undefined, next: DropsState) {
  const before = new Set(prev?.campaigns.flatMap((c) => c.drops.filter((d) => d.claimable).map((d) => d.id)) ?? []);
  return next.campaigns.flatMap((c) => c.drops.filter((d) => d.claimable && !before.has(d.id)).map((d) => ({ campaign: c, drop: d })));
}
