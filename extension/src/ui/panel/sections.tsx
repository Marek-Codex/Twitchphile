// The panel's special cards: Twitch account, watch-time leaderboard, backup, hook diagnostics.
import { channelLabel, channelUrl } from "../../core/channels";
import { useEffect, useRef, useState } from "preact/hooks";
import { platform } from "@platform";
import { mergeCounts, mergePrefs, type Backup } from "../../core/backup";
import { DROPS_KEY, type DropsState } from "../../core/drops";
import { DESKTOP_SYNC_AT_KEY } from "../../core/desktop";
import { FOLLOWS_KEY } from "../../core/follows";
import { LIVE_AT_KEY } from "../../core/live";
import { SCHEDULE_KEY } from "../../core/schedule";
import { PRIME_KEY, primeReadyAt, type PrimeUse } from "../../core/prime";
import { channelLogin } from "../../core/twitch";
import { CLAIMS_KEY, dayKey, PREFS_KEY, WATCH_DAYS_KEY, WATCH_HOURS_KEY, WATCH_KEY, type ChannelPrefs, type Counts } from "../../core/channel-data";
import { fmtDuration } from "../../core/format";
import type { ProbeResult } from "../../core/probes";
import { SCHEMA } from "../../core/schema";
import { cleanSettings, settings } from "../../core/settings";

const localOr = <T,>(key: string, fallback: T) => platform.local.get<T>(key).then((v) => v ?? fallback);

type AccountInfo = { login: string; borrowed: boolean } | null;

export function Account() {
  const [account, setAccount] = useState<AccountInfo | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    platform.send<AccountInfo>({ type: "auth:status" }).then(setAccount);
  }, []);

  const run = async (type: "auth:connect" | "auth:disconnect") => {
    setBusy(true);
    setError("");
    const res = await platform.send<AccountInfo | { error: string }>({ type });
    if (res && "error" in res) setError(res.error.replace(/^Error: /, ""));
    else setAccount(res);
    setBusy(false);
  };

  if (account === undefined) return null;
  const desc = !account
    ? "Connect to see your followed channels go live — or pair the desktop app and share its sign-in."
    : account.borrowed
      ? "Using the desktop app's sign-in. Sign out there to disconnect."
      : "Used to see which followed channels are live. Shared with the desktop app when paired.";
  return (
    <div class="card account">
      <div class="row">
        <div class={`led${account ? " on" : ""}`} />
        <div class="info">
          <div class="title">{account ? <>Connected as <b>{account.login}</b></> : "Twitch account"}</div>
          <div class="desc">{error || desc}</div>
        </div>
        {!account?.borrowed && (
          <button class={`btn${account ? "" : " primary"}`} disabled={busy} onClick={() => run(account ? "auth:disconnect" : "auth:connect")}>
            {busy ? "…" : account ? "Disconnect" : "Connect Twitch"}
          </button>
        )}
      </div>
    </div>
  );
}

// Today, this week, and a two-week bar chart of time watched (all channels).
// When in the week you watch: weekday × hour, all-time.
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function WatchHabits({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 1);
  if (max <= 1) return null;
  const hourName = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });
  return (
    <div class="card history">
      <div class="totals"><div><span class="k">WHEN YOU WATCH</span></div></div>
      <div class="habits">
        {DAY_NAMES.map((d, di) => (
          <div class="hr" key={d}>
            <span class="dl">{d[0]}</span>
            {hours.slice(di * 24, di * 24 + 24).map((sec, h) => (
              <i key={h} class={sec ? "on" : ""} style={{ opacity: sec ? 0.25 + 0.75 * (sec / max) : 1 }} title={`${d} ${hourName(h)}: ${fmtDuration(sec * 1000)}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function WatchHistory({ days }: { days: Counts }) {
  const now = new Date();
  const recent = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (13 - i));
    return { key: dayKey(d), label: d.toLocaleDateString(undefined, { weekday: "narrow" }), sec: days[dayKey(d)] ?? 0 };
  });
  const week = recent.slice(7).reduce((s, d) => s + d.sec, 0);
  const max = Math.max(...recent.map((d) => d.sec), 1);
  const fmt = (sec: number) => (sec >= 60 ? fmtDuration(sec * 1000) : "0m");
  return (
    <div class="card history">
      <div class="totals">
        <div><span class="k">TODAY</span><b>{fmt(recent[13].sec)}</b></div>
        <div><span class="k">LAST 7 DAYS</span><b>{fmt(week)}</b></div>
        <div><span class="k">DAILY AVG</span><b>{fmt(Math.round(week / 7))}</b></div>
      </div>
      <div class="chart" aria-label="Time watched, last 14 days">
        {recent.map((d, i) => (
          <div class="day" key={d.key} title={`${d.key}: ${fmt(d.sec)}`}>
            <i class={i === 13 ? "today" : ""} style={{ height: `${(d.sec / max) * 100}%` }} />
            <span>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WatchList() {
  const [watch, setWatch] = useState<Counts | null>(null);
  const [claims, setClaims] = useState<Counts>({});
  const [days, setDays] = useState<Counts>({});
  const [hours, setHours] = useState<number[]>([]);
  useEffect(() => {
    localOr<Counts>(WATCH_DAYS_KEY, {}).then(setDays);
    localOr<number[]>(WATCH_HOURS_KEY, []).then(setHours);
    localOr<Counts>(WATCH_KEY, {}).then(setWatch);
    localOr<Counts>(CLAIMS_KEY, {}).then(setClaims);
  }, []);
  if (!watch) return null;

  const top = Object.entries(watch).filter(([, sec]) => sec >= 60).sort((a, b) => b[1] - a[1]).slice(0, 25);
  const max = top[0]?.[1] ?? 1;
  const total = Object.values(watch).reduce((sum, sec) => sum + sec, 0);
  return (
    <div class="section">
      <h2 class="section-title">Top channels · {fmtDuration(total * 1000)} total</h2>
      <WatchHistory days={days} />
      {hours.length === 168 && <WatchHabits hours={hours} />}
      <div class="card">
        {top.length ? (
          top.map(([login, sec], i) => (
            <a class="row wl" key={login} href={channelUrl(login)}>
              <span class="rank">{String(i + 1).padStart(2, "0")}</span>
              <div class="info">
                <div class="title">
                  {channelLabel(login)}
                  {claims[login] > 0 && <span class="chests"> · {claims[login]} bonus chest{claims[login] > 1 ? "s" : ""}</span>}
                </div>
                <div class="bar"><i style={{ width: `${(sec / max) * 100}%` }} /></div>
              </div>
              <span class="dur">{fmtDuration(sec * 1000)}</span>
            </a>
          ))
        ) : (
          <div class="empty">NOTHING TRACKED YET — GO WATCH SOMETHING</div>
        )}
      </div>
    </div>
  );
}

export function PrimeCard() {
  const [use, setUse] = useState<PrimeUse | null | undefined>(undefined);
  useEffect(() => {
    localOr<PrimeUse | null>(PRIME_KEY, null).then(setUse);
    return platform.local.onChange(PRIME_KEY, (v) => setUse((v as PrimeUse) ?? null));
  }, []);
  if (use === undefined) return null;

  const here = channelLogin();
  const left = use ? primeReadyAt(use) - Date.now() : 0;
  const status = !use
    ? "Not tracked yet. It's noted automatically when you use Prime in Twitch's subscribe menu."
    : left > 0
      ? `Used${use.login ? ` on ${use.login}` : ""} · free again in ${fmtDuration(left)}`
      : `Free again now${use.login ? ` — last used on ${use.login}` : ""}`;
  return (
    <div class="card account">
      <div class="row">
        <div class={`led${use && left <= 0 ? " on" : ""}`} />
        <div class="info">
          <div class="title">Prime sub</div>
          <div class="desc">{status}</div>
        </div>
        <button class="btn" onClick={() => platform.send({ type: "prime:used", login: here })} title={here ? `Mark it as used today on ${here}` : "Mark it as used today"}>
          Used today
        </button>
        {use && <button class="btn" onClick={() => platform.send({ type: "prime:used", clear: true })}>Clear</button>}
      </div>
    </div>
  );
}

export function DropsList() {
  const [state, setState] = useState<DropsState | null | undefined>(undefined);
  useEffect(() => {
    localOr<DropsState | null>(DROPS_KEY, null).then(setState);
    return platform.local.onChange(DROPS_KEY, (v) => setState(v as DropsState));
  }, []);
  if (state === undefined) return null;

  const campaigns = state?.campaigns ?? [];
  const left = (iso: string) => {
    const ms = Date.parse(iso) - Date.now();
    return Number.isFinite(ms) && ms > 0 ? `${fmtDuration(ms)} left` : "ending";
  };
  return (
    <div class="section">
      <h2 class="section-title">Drop campaigns{state ? ` · checked ${fmtDuration(Math.max(60_000, Date.now() - state.at))} ago` : ""}</h2>
      <div class="card">
        {campaigns.length ? (
          campaigns.map((c) => (
            <div key={c.id}>
              <div class="row">
                <div class="info">
                  <div class="title">{c.game || c.name}</div>
                  <div class="desc">{c.name} · {left(c.endsAt)}</div>
                </div>
              </div>
              {c.drops.map((d) => (
                <a class="row wl" key={d.id} href="https://www.twitch.tv/drops/inventory">
                  <div class="info">
                    <div class="title">
                      {d.name}
                      {d.claimable && <span class="chests"> · ready to claim</span>}
                      {d.claimed && <span class="chests"> · claimed</span>}
                    </div>
                    <div class="bar"><i style={{ width: `${d.required ? (d.minutes / d.required) * 100 : 0}%` }} /></div>
                  </div>
                  <span class="dur">{d.claimed ? "✓" : `${Math.floor(d.minutes / 60)}h ${String(d.minutes % 60).padStart(2, "0")}m / ${Math.floor(d.required / 60)}h`}</span>
                </a>
              ))}
            </div>
          ))
        ) : (
          <div class="empty">{state ? "NO DROP CAMPAIGNS IN PROGRESS" : "OPEN TWITCH WHILE LOGGED IN TO CHECK YOUR DROPS"}</div>
        )}
      </div>
    </div>
  );
}

async function exportBackup() {
  const payload: Backup = {
    app: "twitchphile",
    version: platform.version,
    exportedAt: new Date().toISOString(),
    settings: await settings.load(),
    watchtime: await localOr<Counts>(WATCH_KEY, {}),
    claims: await localOr<Counts>(CLAIMS_KEY, {}),
    channelPrefs: await localOr<ChannelPrefs>(PREFS_KEY, {}),
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  a.download = `twitchphile-backup-${payload.exportedAt.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Settings are replaced by the backup's (validated); counters merge by max; per-channel prefs fill gaps.
async function importBackup(file: File) {
  const data = JSON.parse(await file.text()) as Partial<Backup>;
  if (data?.app !== "twitchphile") throw new Error("Not a Twitchphile backup.");
  const clean = cleanSettings(data.settings);
  await settings.set(clean);
  await platform.local.set(WATCH_KEY, mergeCounts(await localOr<Counts>(WATCH_KEY, {}), data.watchtime));
  await platform.local.set(CLAIMS_KEY, mergeCounts(await localOr<Counts>(CLAIMS_KEY, {}), data.claims));
  await platform.local.set(PREFS_KEY, mergePrefs(await localOr<ChannelPrefs>(PREFS_KEY, {}), data.channelPrefs));
  return `Restored ${Object.keys(clean).length} settings and watch time for ${Object.keys(data.watchtime ?? {}).length} channels.`;
}

export function DataCard() {
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div class="card">
      <div class="row">
        <div class="info">
          <div class="title">Backup</div>
          <div class="desc">{msg || "Settings, favorites, nicknames, watch time, bonus chests and per-channel quality in one file."}</div>
        </div>
        <button class="btn" onClick={() => fileRef.current?.click()}>Import</button>
        <button class="btn primary" onClick={() => exportBackup().then(() => setMsg("Backup downloaded."))}>Export</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!f) return;
            importBackup(f).then(setMsg, (err) => setMsg(err instanceof SyntaxError ? "That file isn't valid JSON." : String(err.message)));
          }}
        />
      </div>
    </div>
  );
}

export function DataStatus() {
  const [times, setTimes] = useState<{ live: number; follows: number; schedule: number; desktop: number } | null>(null);
  useEffect(() => {
    Promise.all([
      platform.local.get<number>(LIVE_AT_KEY),
      platform.local.get<{ at: number }>(FOLLOWS_KEY),
      platform.local.get<{ at: number }>(SCHEDULE_KEY),
      platform.local.get<number>(DESKTOP_SYNC_AT_KEY),
    ]).then(([live, follows, schedule, desktop]) => setTimes({ live: live ?? 0, follows: follows?.at ?? 0, schedule: schedule?.at ?? 0, desktop: desktop ?? 0 }));
  }, []);
  if (!times) return null;
  const seen = (at: number) => at > 0 ? `${new Date(at).toLocaleString()} · ${fmtDuration(Math.max(0, Date.now() - at))} ago` : "Not checked yet";
  return (
    <div class="card">
      {([
        ["Live streams", times.live],
        ["Following", times.follows],
        ["Schedules", times.schedule],
        ["Desktop sync", times.desktop],
      ] as const).map(([label, at]) => (
        <div class="row" key={label}>
          <div class={`led${at ? " on" : ""}`} />
          <div class="info"><div class="title">{label}</div><div class="desc">{seen(at)}</div></div>
        </div>
      ))}
    </div>
  );
}

type DesktopStatus = "absent" | "unpaired" | "paired";
const DESKTOP_TEXT: Record<DesktopStatus | "pairing", string> = {
  absent: "Not running. Start the Twitchphile desktop app to sync favorites and hidden channels with it.",
  unpaired: "Found the desktop app. Pair to sync favorites and hidden channels both ways.",
  pairing: "Approve the request in the desktop app…",
  paired: "Paired — favorites and hidden channels stay in sync with the desktop app.",
};

export function DesktopCard() {
  const [status, setStatus] = useState<DesktopStatus | "pairing" | null>(null);
  useEffect(() => {
    platform.send<DesktopStatus>({ type: "desktop:status" }).then(setStatus);
  }, []);
  if (!status) return null;

  const pair = async () => {
    setStatus("pairing");
    setStatus(await platform.send<DesktopStatus>({ type: "desktop:pair" }));
  };
  return (
    <div class="card account">
      <div class="row">
        <div class={`led${status === "paired" ? " on" : ""}`} />
        <div class="info">
          <div class="title">Desktop app</div>
          <div class="desc">{DESKTOP_TEXT[status]}</div>
        </div>
        {status === "unpaired" && (
          <button class="btn primary" onClick={pair}>
            Pair
          </button>
        )}
        {status === "absent" && (
          // The app registers the twitchphile: link type, so this starts it (the browser asks first).
          <a class="btn" href="twitchphile://open" onClick={() => setTimeout(() => platform.send<DesktopStatus>({ type: "desktop:status" }).then(setStatus), 5000)}>
            Start app
          </a>
        )}
      </div>
    </div>
  );
}

export function Diagnostics({ results }: { results: ProbeResult[] }) {
  const title = (key: string) => SCHEMA.flatMap((c) => c.rows).find((r) => r.key === key)?.title ?? key;
  return (
    <div class="section">
      <h2 class="section-title">Hooks on this page</h2>
      <div class="card">
        {results.length ? (
          results.map(({ probe, ok, optional }) => (
            <div class="row" key={probe.feature + probe.label}>
              <div class={`led ${ok || optional ? "on" : "bad"}`} />
              <div class="info">
                <div class="title">{title(probe.feature)}</div>
                <div class="desc">
                  {probe.label} — {ok ? "found" : optional ? "not available on this channel (Channel Points may be disabled)" : <>not found <code>{probe.selector}</code>. Twitch may have changed this page.</>}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div class="empty">NO HOOKS APPLY ON THIS PAGE — OPEN A LIVE CHANNEL TO CHECK</div>
        )}
      </div>
    </div>
  );
}
