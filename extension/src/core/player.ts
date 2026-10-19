// Isolated-world side of the MAIN-world page bridge (src/page.ts).
export interface PlayerState {
  latency: number | null;
  rate: number;
  paused: boolean;
  quality: string | null; // "auto" or a name like "720p60"
  volume: number | null;
}

const subs = new Set<(s: PlayerState) => void>();
let last: PlayerState | null = null;

const cmd = (name: string, value?: unknown) =>
  document.dispatchEvent(new CustomEvent("tp:cmd", { detail: JSON.stringify({ cmd: name, value }) }));

document.addEventListener("tp:state", (e) => {
  last = JSON.parse((e as CustomEvent<string>).detail);
  subs.forEach((cb) => cb(last!));
});

export const player = {
  // Ref-counted: the bridge only polls while at least one feature listens.
  subscribe(cb: (s: PlayerState) => void) {
    subs.add(cb);
    if (subs.size === 1) cmd("sub");
    else if (last) cb(last);
    return () => {
      subs.delete(cb);
      if (!subs.size) cmd("unsub");
    };
  },
  // Chatter count via the page (needs Twitch's integrity token). Resolves null on failure/timeout.
  chatters: (login: string) =>
    new Promise<number | null>((resolve) => {
      const done = (count: number | null) => {
        clearTimeout(timer);
        document.removeEventListener("tp:chatters", on);
        resolve(count);
      };
      const on = (e: Event) => {
        const r = JSON.parse((e as CustomEvent<string>).detail);
        if (r.login === login) done(r.count);
      };
      const timer = setTimeout(() => done(null), 10_000);
      document.addEventListener("tp:chatters", on);
      cmd("chatters", login);
    }),
  // Raw Inventory data via the page (needs the logged-in twitch.tv session). Null when logged out / on failure.
  inventory: () =>
    new Promise<unknown>((resolve) => {
      const done = (data: unknown) => {
        clearTimeout(timer);
        document.removeEventListener("tp:drops", on);
        resolve(data);
      };
      const on = (e: Event) => done(JSON.parse((e as CustomEvent<string>).detail));
      const timer = setTimeout(() => done(null), 15_000);
      document.addEventListener("tp:drops", on);
      cmd("drops");
    }),
  setRate: (rate: number) => cmd("rate", rate),
  setQuality: (name: string) => cmd("quality", name),
  setVolume: (v: number) => cmd("volume", v),
  seekBy: (seconds: number) => cmd("seek", seconds),
  lurk: () => cmd("lurk"),
  jumpToLive: () => cmd("live"),
};
