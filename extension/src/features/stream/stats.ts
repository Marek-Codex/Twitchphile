// Telemetry strip: latency · uptime · viewer trend · watch time, with Phosphor icons.
// Lives in the chat header (replacing "Stream Chat") or beside Twitch's viewer count/uptime under the player.
import { platform } from "@platform";
import { $, onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import type { StreamInfo } from "../../core/gql";
import { player } from "../../core/player";
import { settings } from "../../core/settings";
import { WATCH_KEY, type Counts } from "../../core/channel-data";
import { fmtClock, fmtDuration } from "../../core/format";
import { channelLogin } from "../../core/twitch";
import { injectStyle } from "../../core/util";
import { clock, gauge, hourglass, svg, trendDown, trendFlat, trendUp } from "../../ui/icons";

const ID = "tp-stats";
const STYLE = `
#${ID}{display:flex;align-items:center;justify-content:center;gap:14px;flex:1;min-width:0;
font:600 13px var(--font-base,Inter,sans-serif);font-variant-numeric:tabular-nums;color:var(--color-text-base);
white-space:nowrap;user-select:none}
#${ID} .it{display:inline-flex;align-items:center;gap:5px}
#${ID} .tp-i{flex:none;opacity:.75}
#${ID} .lat{display:inline-flex;align-items:center;gap:6px;padding:2px 6px;border-radius:4px;cursor:pointer;
transition:background .15s ease}
#${ID} .lat:hover{background:var(--color-background-button-text-hover)}
#${ID} .lat:not([data-live]) .v{color:var(--color-text-alt-2)}
#${ID} .lat[data-level="1"] .v{color:#F5A623}
#${ID} .lat[data-level="2"] .v{color:#FF4D5E}
#${ID} .rate{font-size:11px;color:var(--color-text-alt-2)}
#${ID} .up,#${ID} .wt{color:var(--color-text-alt)}
#${ID}.info{flex:0 1 auto;min-width:0;justify-content:flex-start;margin-left:1rem;font:inherit;font-weight:600;font-variant-numeric:tabular-nums}
#${ID}.info .lat{padding:0 4px;margin-left:-4px}
#${ID}.info .trend{order:1}#${ID}.info .wt{order:2}#${ID}.info .up{order:3}#${ID}.info .lat{order:4}
.tp-stats-host>:has(>.live-time){display:none}
#${ID} .trend .tp-i{opacity:1}
#${ID} .trend[data-dir="up"]{color:#3CA0FF}
#${ID} .trend[data-dir="down"]{color:var(--color-text-alt-2)}
#${ID} .trend{position:relative}
#${ID} .spark{display:none;position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);z-index:50;padding:8px 10px;
border-radius:6px;background:var(--color-background-base);border:1px solid var(--color-border-base);box-shadow:0 4px 16px rgba(0,0,0,.4)}
#${ID} .trend:hover .spark{display:block}
#${ID} .spark .sl{display:flex;justify-content:space-between;gap:12px;margin-top:4px;font:500 11px var(--font-base);color:var(--color-text-alt-2)}
#chat-room-header-label.tp-hidden{display:none}`;

const TREND_WINDOW = 5 * 60_000;
const SPARK_WINDOW = 60 * 60_000;
const SAMPLE_MS = 60_000;

export const streamStats: Feature = {
  key: "streamStats",
  start() {
    let strip: HTMLElement | null = null;
    let login = "";
    let info: StreamInfo | null = null;
    let samples: { at: number; n: number }[] = [];
    let unsub: (() => void) | null = null;
    const style = injectStyle(STYLE);

    function hostFor(placement: string): Element | null {
      if (placement === "chat") return $(".stream-chat-header");
      // Nearest ancestor of the uptime that also holds the viewer count = that info row.
      let el = $(".live-time")?.parentElement ?? null;
      while (el && !el.querySelector('[data-a-target="animated-channel-viewers-count"]')) el = el.parentElement;
      return el;
    }

    function place(host: Element, placement: string) {
      if (!strip) build();
      strip!.classList.toggle("info", placement === "info");
      document.querySelectorAll(".tp-stats-host").forEach((h) => h.classList.remove("tp-stats-host"));
      $("#chat-room-header-label")?.classList.toggle("tp-hidden", placement === "chat");
      host.append(strip!);
      visibility();
    }

    function build() {
      strip = document.createElement("div");
      strip.id = ID;
      strip.innerHTML =
        `<span class="it lat" title="Delay behind live — click to jump to live">${svg(gauge)}<span class="v">—</span><span class="rate"></span></span>` +
        `<span class="it up" title="Uptime">${svg(clock)}<span class="v"></span></span>` +
        `<span class="it trend" title="Viewer change, last 5 minutes"><span class="ic"></span><span class="v"></span></span>` +
        `<span class="it wt" title="Your watch time on this channel">${svg(hourglass)}<span class="v"></span></span>`;
      strip.querySelector(".lat")!.addEventListener("click", player.jumpToLive);
      unsub = player.subscribe(renderLatency);
    }

    function visibility() {
      if (!strip) return;
      const s = settings.get();
      const [lat, up, trend, wt] = strip.querySelectorAll<HTMLElement>(".lat,.up,.trend,.wt");
      lat.hidden = !s.statLatency;
      up.hidden = !s.statUptime || !info?.startedAt;
      // Under the player, ours replaces Twitch's uptime (so it can sit later in the row) — only while ours shows.
      strip.parentElement?.classList.toggle("tp-stats-host", s.statsPlacement === "info" && !up.hidden);
      trend.hidden = !s.statViewers || !trend.querySelector(".v")!.textContent;
      wt.hidden = !s.statWatch || !s.watchTime || !wt.querySelector(".v")!.textContent;
    }

    function renderLatency(p: { latency: number | null; rate: number }) {
      const lat = strip?.querySelector<HTMLElement>(".lat");
      if (!lat) return;
      // Trust GQL for live/offline; the player only reports latency once it's actually playing.
      const live = info ? info.live : p.latency != null;
      const l = p.latency;
      lat.toggleAttribute("data-live", live);
      lat.dataset.level = !live || l == null ? "0" : l > 8 ? "2" : l > 4 ? "1" : "0";
      lat.querySelector(".v")!.textContent = !live ? "OFFLINE" : l == null ? "—" : `${l.toFixed(2)}s`;
      lat.querySelector(".rate")!.textContent = live && p.rate !== 1 ? `${p.rate.toFixed(2)}×` : "";
      // Uptime ticks on the same 1s heartbeat — no extra timer.
      const up = strip!.querySelector(".up .v")!;
      if (info?.startedAt) {
        const elapsed = Date.now() - Date.parse(info.startedAt);
        // Under the player, a 4:07:28 clock like Twitch's own; compact in the chat header.
        up.textContent = settings.get().statsPlacement === "info" ? fmtClock(elapsed) : fmtDuration(elapsed);
      }
      visibility();
    }

    async function renderWatch() {
      const wt = strip?.querySelector<HTMLElement>(".wt .v");
      if (!wt) return;
      const sec = login ? ((await platform.local.get<Counts>(WATCH_KEY)) ?? {})[login] ?? 0 : 0;
      wt.textContent = sec >= 60 ? fmtDuration(sec * 1000) : "";
      visibility();
    }

    // Hover card: viewers over the last hour (one point per minute, only while this tab was sampling).
    function renderSpark(trend: HTMLElement) {
      let card = trend.querySelector<HTMLElement>(".spark");
      if (samples.length < 3) return card?.remove();
      if (!card) {
        card = document.createElement("div");
        card.className = "spark";
        trend.append(card);
      }
      const ns = samples.map((s) => s.n);
      const lo = Math.min(...ns);
      const hi = Math.max(...ns);
      const span = hi - lo || 1;
      const t0 = samples[0].at;
      const dt = samples[samples.length - 1].at - t0 || 1;
      const pts = samples.map((s) => `${(((s.at - t0) / dt) * 160).toFixed(1)},${(38 - ((s.n - lo) / span) * 34).toFixed(1)}`).join(" ");
      const mins = Math.round(dt / 60_000);
      card.innerHTML =
        `<svg width="160" height="40" viewBox="0 0 160 40" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="#3CA0FF" stroke-width="1.5" stroke-linejoin="round"/></svg>` +
        `<div class="sl"><span>${lo.toLocaleString()}–${hi.toLocaleString()}</span><span>last ${mins}m</span></div>`;
    }

    function renderTrend() {
      const trend = strip?.querySelector<HTMLElement>(".trend");
      if (!trend) return;
      const now = samples[samples.length - 1];
      // % change over the last 5 minutes; the full hour feeds the hover sparkline.
      const then = samples.find((s) => now && now.at - s.at <= TREND_WINDOW);
      const v = trend.querySelector(".v")!;
      renderSpark(trend);
      if (!now || !then || now === then || !then.n) {
        v.textContent = "";
      } else {
        const pct = Math.round(((now.n - then.n) / then.n) * 100);
        const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
        trend.dataset.dir = dir;
        trend.querySelector(".ic")!.innerHTML = svg(dir === "up" ? trendUp : dir === "down" ? trendDown : trendFlat);
        v.textContent = `${Math.abs(pct)}%`;
      }
      visibility();
    }

    async function sample() {
      if (!login || document.hidden) return;
      info = await platform.send<StreamInfo>({ type: "stream", login });
      if (info?.viewers != null) {
        const at = Date.now();
        samples = [...samples.filter((s) => at - s.at <= SPARK_WINDOW), { at, n: info.viewers }];
      }
      renderTrend();
    }

    const stopDom = onDom((pathChanged) => {
      if (pathChanged || login !== channelLogin()) {
        login = channelLogin();
        info = null;
        samples = [];
        sample();
        renderWatch();
      }
      const placement = settings.get().statsPlacement;
      const host = hostFor(placement);
      if (host && strip?.parentElement !== host) {
        const fresh = !strip;
        place(host, placement);
        if (fresh) renderWatch();
      }
    });
    const sampleTimer = window.setInterval(sample, SAMPLE_MS);
    const offSettings = settings.onChange((c) => {
      if ("statsPlacement" in c) {
        const host = hostFor(settings.get().statsPlacement);
        if (host) place(host, settings.get().statsPlacement);
      }
      visibility();
    });
    const offWatch = platform.local.onChange(WATCH_KEY, () => renderWatch());

    return () => {
      stopDom();
      offSettings();
      offWatch();
      clearInterval(sampleTimer);
      unsub?.();
      strip?.remove();
      style.remove();
      $("#chat-room-header-label")?.classList.remove("tp-hidden");
      document.querySelectorAll(".tp-stats-host").forEach((h) => h.classList.remove("tp-stats-host"));
    };
  },
};
