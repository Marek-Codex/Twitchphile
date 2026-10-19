// Channel stats drawer: Twitch's own facts about a channel (followers, VODs, clips, schedule) plus the history the
// background records from live checks, as a few small charts — and one-click links to the big stats sites.
// Opened from the player-bar button; lives in its own shadow root like the settings panel.
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { platform } from "@platform";
import type { ChannelStats } from "../../core/channel-stats";
import { fmtCompact, fmtDuration } from "../../core/format";
import { sessionAverage, sessionMinutes, startHeatmap, usualStart, type StreamSession } from "../../core/history";
import { Icon } from "../Icon";
import { close as closeIcon } from "../icons";
import css from "./drawer.css";
import { onKick } from "../../core/site";
import { kickStats } from "./kick";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });

// Stats sites that take a channel name (TwitchMetrics also wants the numeric id).
const sites = (login: string, id: string | null) =>
  onKick
    ? ([
        ["StreamsCharts", `https://streamscharts.com/channels/${login}?platform=kick`],
        ["Past broadcasts", `https://kick.com/${login}/videos`],
        ["Clips", `https://kick.com/${login}/clips`],
      ] as [string, string][])
    : [
    ["SullyGnome", `https://sullygnome.com/channel/${login}`],
    ["TwitchTracker", `https://twitchtracker.com/${login}`],
    ["StreamsCharts", `https://streamscharts.com/channels/${login}`],
    ["Chat stats", `https://stats.streamelements.com/c/${login}`],
    id ? ["TwitchMetrics", `https://www.twitchmetrics.net/c/${id}-${login}`] : null,
    ["FFZ", `https://www.frankerfacez.com/channel/${login}`],
    ["Chat logs", `https://logs.ivr.fi/?channel=${login}`],
  ].filter(Boolean) as [string, string][];

function Drawer({ login, onClose }: { login: string; onClose: () => void }) {
  const [data, setData] = useState<ChannelStats | null>(null);
  // Docked at the side, or popped out to a centered window like the settings panel. Remembered.
  const [centered, setCentered] = useState(false);
  useEffect(() => {
    (onKick ? kickStats(login) : platform.send<ChannelStats>({ type: "channel:stats", login })).then(setData);
    platform.local.get<boolean>("statsCentered").then((v) => setCentered(Boolean(v)));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [login]);
  const toggleLayout = () => {
    setCentered(!centered);
    platform.local.set("statsCentered", !centered);
  };

  const drawer = (
    <div class={`drawer${centered ? " center" : ""}`} role="dialog" aria-label={`${login} channel stats`}>
      <header>
        {data?.avatar && <img class="avatar" src={data.avatar} alt="" />}
        <div class="who">
          <div class="name">{data?.name ?? login}</div>
          <div class="meta">
            {data?.type && <span class="pill">{data.type.toUpperCase()}</span>}
            {data?.createdAt && <span>since {new Date(data.createdAt).getFullYear()}</span>}
          </div>
        </div>
        <button class="x" title={centered ? "Dock to the side" : "Pop out to the center"} aria-label={centered ? "Dock to the side" : "Pop out"} onClick={toggleLayout}>
          <Icon icon={centered ? dockIcon : popIcon} size={16} />
        </button>
        <button class="x" aria-label="Close" onClick={onClose}>
          <Icon icon={closeIcon} size={16} />
        </button>
      </header>
      <div class="links">
        {sites(login, data?.id ?? null).map(([label, href]) => (
          <a key={label} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
        ))}
      </div>
      {!data ? <div class="note">LOADING…</div> : <Body d={data} />}
    </div>
  );
  // Centered: a dimmed backdrop behind it (click it to close), as with the settings panel.
  return centered ? (
    <div class="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {drawer}
    </div>
  ) : (
    drawer
  );
}

// Phosphor "arrows-out" / "sidebar-simple" (bold), drawn in the 256 grid the other icons use.
const popIcon = '<path d="M220,48V96a12,12,0,0,1-24,0V77l-35.51,35.52a12,12,0,0,1-17-17L179,60H160a12,12,0,0,1,0-24h48A12,12,0,0,1,220,48ZM95.51,143.51,60,179V160a12,12,0,0,0-24,0v48a12,12,0,0,0,12,12H96a12,12,0,0,0,0-24H77l35.52-35.51a12,12,0,0,0-17-17Z"/>';
const dockIcon = '<path d="M216,36H40A20,20,0,0,0,20,56V200a20,20,0,0,0,20,20H216a20,20,0,0,0,20-20V56A20,20,0,0,0,216,36ZM44,60H148V196H44ZM212,196H172V60h40Z"/>';

function Body({ d }: { d: ChannelStats }) {
  const sessions = d.sessions;
  const now = Date.now();
  const month = now - 30 * 86_400_000;

  // Stream starts: VODs (what Twitch kept, ~60 days) plus what we recorded, one per stream.
  const starts = [...new Set([...d.vods.map((v) => v.createdAt.slice(0, 13)), ...sessions.map((s) => s.start.slice(0, 13))])].map((h) => `${h}:00:00Z`);
  const grid = startHeatmap(starts);
  const usual = usualStart(grid);
  const recent = sessions.filter((s) => s.last >= month);
  const avg = recent.length ? Math.round(recent.reduce((a, s) => a + sessionAverage(s), 0) / recent.length) : null;
  const peak = recent.length ? Math.max(...recent.map((s) => s.peak)) : null;
  const weeks = hoursPerWeek(d, sessions);
  const perWeek = weeks.length ? weeks.slice(-4).reduce((a, w) => a + w.hours, 0) / Math.min(4, weeks.length) : null;
  const streams30 = new Set([...d.vods.filter((v) => Date.parse(v.createdAt) >= month).map((v) => v.createdAt.slice(0, 13)), ...recent.map((s) => s.start.slice(0, 13))]).size;
  const fh = d.followerHistory;
  const fGrowth = fh.length >= 2 ? fh[fh.length - 1][1] - fh[0][1] : null;

  return (
    <>
      <div class="tiles">
        <Tile k="FOLLOWERS" v={d.followers != null ? fmtCompact(d.followers) : "—"} sub={fGrowth != null ? `${fGrowth >= 0 ? "+" : ""}${fmtCompact(fGrowth)} since ${fh[0][0].slice(5)}` : undefined} />
        <Tile k="AVG VIEWERS" v={avg != null ? fmtCompact(avg) : "—"} sub={peak != null ? `peak ${fmtCompact(peak)}` : "30 days"} />
        <Tile k="HOURS / WEEK" v={perWeek != null ? perWeek.toFixed(1) : "—"} sub={`${streams30} streams in 30d`} />
        <Tile k="USUALLY LIVE" v={usual ? hourLabel(usual.hour) : "—"} sub={usual ? usual.days.map((i) => DAYS[i]).join(" · ") || "any day" : "not enough data"} />
      </div>

      {!d.signedIn && (
        <div class="note">
          {onKick ? "Kick didn't answer — try again in a moment." : "Connect your Twitch account (Twitchphile › Live) for followers, VODs, clips and schedule."}
        </div>
      )}

      <div class="sections">
      {d.channel && (
        <Section title="THE CHANNEL">
          <div class="facts">
            {d.channel.title && <div class="ttl">{d.channel.title}</div>}
            <div class="kv">
              {d.channel.game && <span><b>Category</b> {d.channel.game}</span>}
              {d.channel.language && <span><b>Language</b> {languageName(d.channel.language)}</span>}
              {d.team && <span><b>Team</b> {d.team}</span>}
              {d.channel.delay > 0 && <span><b>Delay</b> {d.channel.delay}s</span>}
              {d.channel.branded && <span><b>Branded content</b></span>}
            </div>
            {(d.channel.tags.length > 0 || d.channel.labels.length > 0) && (
              <div class="tags">
                {d.channel.tags.map((t) => <span key={t}>{t}</span>)}
                {d.channel.labels.map((l) => <span key={l} class="lbl" title="Content classification">{labelName(l)}</span>)}
              </div>
            )}
          </div>
        </Section>
      )}

      {d.chat && (
        <Section title="CHAT RIGHT NOW">
          <div class="kv">
            {chatRules(d.chat).map((r) => <span key={r}>{r}</span>)}
          </div>
        </Section>
      )}

      <Section title="VIEWERS PER STREAM" hint="recorded by Twitchphile while they're live">
        {sessions.some((s) => s.peak > 0) ? (
          <ViewerBars sessions={sessions.filter((s) => s.peak > 0).slice(-24)} />
        ) : (
          <Empty
            text={
              onKick
                ? "Kick doesn't publish viewers for past broadcasts. Twitchphile records them while the channel is live, once it's in your Kick follows."
                : "Recording starts with their next stream (needs the channel in your follows or Also watch)."
            }
          />
        )}
      </Section>

      <Section title="HOURS STREAMED PER WEEK">
        {weeks.length ? <WeekBars weeks={weeks.slice(-10)} /> : <Empty text="No past broadcasts to go on." />}
      </Section>

      <Section title="WHEN THEY GO LIVE" hint="your time">
        {starts.length ? <Heatmap grid={grid} /> : <Empty text="No stream starts known yet." />}
      </Section>

      {categories(sessions).length > 0 && (
        <Section title="WHAT THEY PLAY" hint="share of recorded time">
          <Categories rows={categories(sessions)} />
        </Section>
      )}

      {fh.length >= 2 && (
        <Section title="FOLLOWERS" hint={`${fh.length} days recorded`}>
          <Spark points={fh.map(([, n]) => n)} />
        </Section>
      )}

      {d.schedule.length > 0 && (
        <Section title="COMING UP">
          {d.schedule.map((s) => (
            <div class="row" key={s.start}>
              <span class="when">{new Date(s.start).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
              <span class="what">{s.title || s.category || "Stream"}</span>
            </div>
          ))}
        </Section>
      )}

      {d.clips.length > 0 && (
        <Section title="TOP CLIPS · 30 DAYS">
          <div class="clips">
            {d.clips.map((c) => (
              <a class="clip" key={c.url} href={c.url} target="_blank" rel="noopener noreferrer" title={c.title}>
                <img src={c.thumb} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                <span class="t">{c.title}</span>
                <span class="v">{fmtCompact(c.views)} views</span>
              </a>
            ))}
          </div>
        </Section>
      )}

      {d.vods.length > 0 && (
        <Section title="RECENT BROADCASTS">
          {d.vods.slice(0, 8).map((v) => (
            <a class="row vod" key={v.url} href={v.url} target="_blank" rel="noopener noreferrer" title={v.title}>
              <span class="when">{new Date(v.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <span class="what">{v.title}</span>
              <span class="len">{fmtDuration(v.minutes * 60_000)}</span>
            </a>
          ))}
        </Section>
      )}

      {d.emotes.length > 0 && (
        <Section title="CHANNEL EMOTES" hint={`${d.emotes.length}`}>
          <div class="emotes">
            {d.emotes.slice(0, 60).map((e) => (
              <img key={e.name} src={e.url} alt={e.name} title={`${e.name} · ${emoteKind(e)}`} loading="lazy" />
            ))}
          </div>
        </Section>
      )}
      </div>
    </>
  );
}

// ---- Wording for the channel facts

const languageName = (code: string) => {
  try {
    return new Intl.DisplayNames([navigator.language], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

// Twitch's content classification ids → plain words.
const LABELS: Record<string, string> = {
  DebatedSocialIssuesAndPolitics: "Politics & social issues",
  DrugsIntoxication: "Drugs & intoxication",
  SexualThemes: "Sexual themes",
  ViolentGraphic: "Violent & graphic",
  Gambling: "Gambling",
  ProfanityVulgarity: "Profanity",
  MatureGame: "Mature-rated game",
};
const labelName = (id: string) => LABELS[id] ?? id.replace(/([a-z])([A-Z])/g, "$1 $2");

function chatRules(c: NonNullable<ChannelStats["chat"]>) {
  const rules: string[] = [];
  if (c.followersOnly != null) rules.push(c.followersOnly ? `Followers only (${fmtDuration(c.followersOnly * 60_000)}+)` : "Followers only");
  if (c.subOnly) rules.push("Subscribers only");
  if (c.slow != null) rules.push(`Slow mode · ${c.slow}s`);
  if (c.emoteOnly) rules.push("Emote only");
  if (c.unique) rules.push("Unique messages only");
  return rules.length ? rules : ["Open to everyone"];
}

const emoteKind = (e: ChannelStats["emotes"][number]) =>
  e.type === "subscriptions" ? `Tier ${Number(e.tier) / 1000} sub` : e.type === "follower" ? "Follower" : e.type === "bitstier" ? "Bits" : e.type;

const Tile = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (
  <div class="tile">
    <span class="k">{k}</span>
    <b>{v}</b>
    {sub && <span class="sub">{sub}</span>}
  </div>
);

const Section = ({ title, hint, children }: { title: string; hint?: string; children: preact.ComponentChildren }) => (
  <section>
    <h3>
      {title}
      {hint && <span>{hint}</span>}
    </h3>
    {children}
  </section>
);

const Empty = ({ text }: { text: string }) => <div class="empty">{text}</div>;

// ---- Charts (plain SVG; one accent hue, values in tooltips)

function ViewerBars({ sessions }: { sessions: StreamSession[] }) {
  const max = Math.max(...sessions.map((s) => s.peak), 1);
  const w = 100 / sessions.length;
  return (
    <svg class="chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Average and peak viewers per stream">
      {sessions.map((s, i) => {
        const avgH = (sessionAverage(s) / max) * 38;
        const peakY = 40 - (s.peak / max) * 38;
        const label = `${new Date(s.start).toLocaleDateString()} · avg ${fmtCompact(sessionAverage(s))}, peak ${fmtCompact(s.peak)} · ${fmtDuration(sessionMinutes(s) * 60_000)}`;
        return (
          <g key={s.start}>
            <title>{label}</title>
            <rect class="bar" x={i * w + w * 0.15} width={w * 0.7} y={40 - avgH} height={avgH} />
            <rect class="peak" x={i * w + w * 0.15} width={w * 0.7} y={peakY} height={0.8} />
          </g>
        );
      })}
    </svg>
  );
}

type Week = { label: string; hours: number };

// Hours streamed per calendar week (Mon-based), from VODs where they exist, else our recorded sessions.
function hoursPerWeek(d: ChannelStats, sessions: StreamSession[]): Week[] {
  const weekOf = (t: number) => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.getTime();
  };
  const byWeek = new Map<number, number>();
  const add = (start: number, minutes: number) => byWeek.set(weekOf(start), (byWeek.get(weekOf(start)) ?? 0) + minutes);
  const vodHours = new Set(d.vods.map((v) => v.createdAt.slice(0, 13)));
  d.vods.forEach((v) => add(Date.parse(v.createdAt), v.minutes));
  sessions.filter((s) => !vodHours.has(s.start.slice(0, 13))).forEach((s) => add(Date.parse(s.start), sessionMinutes(s)));
  if (!byWeek.size) return [];
  const first = Math.min(...byWeek.keys());
  const weeks: Week[] = [];
  for (let t = first; t <= weekOf(Date.now()); t += 7 * 86_400_000) {
    weeks.push({ label: new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }), hours: (byWeek.get(t) ?? 0) / 60 });
  }
  return weeks;
}

function WeekBars({ weeks }: { weeks: Week[] }) {
  const max = Math.max(...weeks.map((w) => w.hours), 1);
  return (
    <div class="weeks">
      {weeks.map((w) => (
        <div class="wk" key={w.label} title={`Week of ${w.label}: ${w.hours.toFixed(1)}h`}>
          <i style={{ height: `${(w.hours / max) * 100}%` }} />
          <span>{w.label.split(" ")[1] ?? w.label}</span>
        </div>
      ))}
    </div>
  );
}

function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(...grid.flat(), 1);
  return (
    <div class="heat">
      {grid.map((row, d) => (
        <div class="hr" key={d}>
          <span class="dl">{DAYS[d][0]}</span>
          {row.map((n, h) => (
            <i key={h} title={`${DAYS[d]} ${hourLabel(h)}: ${n} start${n === 1 ? "" : "s"}`} style={{ opacity: n ? 0.25 + 0.75 * (n / max) : 1 }} class={n ? "on" : ""} />
          ))}
        </div>
      ))}
      <div class="hr axis">
        <span class="dl" />
        {[0, 6, 12, 18].map((h) => (
          <span key={h} style={{ gridColumn: `${h + 2} / span 6` }}>{hourLabel(h)}</span>
        ))}
      </div>
    </div>
  );
}

function categories(sessions: StreamSession[]) {
  const totals = new Map<string, number>();
  for (const s of sessions) for (const [g, m] of Object.entries(s.games)) totals.set(g, (totals.get(g) ?? 0) + m);
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g, m]) => ({ g, m, share: all ? m / all : 0 }));
}

const Categories = ({ rows }: { rows: { g: string; m: number; share: number }[] }) => (
  <div class="cats">
    {rows.map((r) => (
      <div class="cat" key={r.g} title={`${r.g}: ${fmtDuration(r.m * 60_000)}`}>
        <span class="g">{r.g}</span>
        <span class="b"><i style={{ width: `${r.share * 100}%` }} /></span>
        <span class="p">{Math.round(r.share * 100)}%</span>
      </div>
    ))}
  </div>
);

function Spark({ points }: { points: number[] }) {
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const pts = points.map((p, i) => `${((i / (points.length - 1)) * 100).toFixed(2)},${(38 - ((p - lo) / span) * 34).toFixed(2)}`).join(" ");
  return (
    <svg class="chart spark" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`Followers from ${lo} to ${hi}`}>
      <polyline points={pts} fill="none" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

// ---- Mounting

let host: HTMLElement | null = null;

export function openChannelStats(login: string) {
  closeChannelStats();
  host = document.createElement("twitchphile-stats");
  host.classList.toggle("light", document.documentElement.classList.contains("tw-root--theme-light"));
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const mount = document.createElement("div");
  root.append(style, mount);
  document.body.append(host);
  render(<Drawer login={login} onClose={closeChannelStats} />, mount);
}

export function closeChannelStats() {
  if (!host) return;
  render(null, host.shadowRoot!.lastElementChild!);
  host.remove();
  host = null;
}
