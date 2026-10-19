// Sidebar upgrades for Twitch's followed list: uptime on each live channel, a glow on streams that just started,
// "Show more" pressed for you until every live channel is listed, and your own sort order.
// Uptime comes from the live list the background already keeps (needs the Twitch account connected), so this
// makes no requests of its own. Sorting uses CSS `order` only, like favorites — Twitch's DOM is never moved.
import { platform } from "@platform";
import { WATCH_KEY, type Counts } from "../../core/channel-data";
import { onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import type { LiveChannel } from "../../core/live";
import { settings } from "../../core/settings";
import { injectStyle } from "../../core/util";
import { listItem } from "./favorites";

const LIVE_KEY = "liveNow"; // core/live.ts (imported as a type only: that module is background-side)
const ROW = '#side-nav a[data-test-selector="followed-channel"]';
const LIVE_STATUS = '[data-a-target="side-nav-live-status"]';
const FRESH_MS = 15 * 60_000; // "just went live" window
const UP = "tp-side-up";

const STYLE = `
.tp-side-sorted{display:flex!important;flex-direction:column}
.tp-side-sorted>*{order:var(--tp-rank,0)}
.${UP}{display:block;text-align:right;font-size:1.1rem;line-height:1.3;color:var(--color-text-alt-2);font-variant-numeric:tabular-nums;white-space:nowrap}
.tp-side-fresh img{box-shadow:0 0 0 2px #3CA0FF;border-radius:50%;animation:tp-side-pulse 2s ease-in-out infinite}
@keyframes tp-side-pulse{50%{box-shadow:0 0 0 2px rgba(60,160,255,.25)}}`;

const loginOf = (a: Element) => a.getAttribute("href")?.slice(1).toLowerCase() ?? "";
const isLive = (a: Element) => {
  const s = a.querySelector(LIVE_STATUS);
  return Boolean(s) && !/offline/i.test(s!.textContent ?? "");
};
const short = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};

export const sidebarPlus: Feature = {
  key: "sidebarPlus",
  start() {
    const style = injectStyle(STYLE);
    let started = new Map<string, number>(); // login → stream start (ms)
    let watched: Counts = {};
    let lastSig = "";
    let lastExpand = 0;

    const load = async () => {
      const live = (await platform.local.get<LiveChannel[]>(LIVE_KEY)) ?? [];
      started = new Map(live.map((c) => [c.login.toLowerCase(), Date.parse(c.startedAt)]));
      watched = (await platform.local.get<Counts>(WATCH_KEY)) ?? {};
      lastSig = "";
      sync();
    };

    // Twitch lists live channels first; if the last one showing is still live, there may be more behind "Show more".
    function expand(rows: Element[]) {
      if (!settings.get().sidebarExpand || Date.now() - lastExpand < 1500 || !rows.length) return;
      if (!isLive(rows[rows.length - 1])) return;
      const section = rows[0].closest(".side-nav-section");
      const more = [...(section?.querySelectorAll("button") ?? [])].find((b) => /show more/i.test(b.textContent ?? ""));
      if (!more) return;
      lastExpand = Date.now();
      more.click();
    }

    function sync() {
      const s = settings.get();
      const rows = [...document.querySelectorAll(ROW)];
      expand(rows);
      // Fast path: this runs on every page change; redo the work only when rows, data or the minute changed.
      const sig = `${Math.floor(Date.now() / 60_000)}|${s.sidebarSort}|${s.sidebarUptime}|${s.sidebarFresh}|${rows.map(loginOf).join(",")}`;
      if (sig === lastSig) return;
      lastSig = sig;

      const now = Date.now();
      const ranked = rows.map((a, i) => ({ a, i, login: loginOf(a), live: isLive(a), since: started.get(loginOf(a)) }));
      for (const r of ranked) {
        const status = r.a.querySelector(LIVE_STATUS);
        let up = r.a.querySelector<HTMLElement>(`.${UP}`);
        const showUp = s.sidebarUptime && r.live && r.since != null && status;
        if (showUp && !up) {
          up = document.createElement("span");
          up.className = UP;
          status!.append(up);
        }
        if (showUp) up!.textContent = short(now - r.since!);
        else up?.remove();
        r.a.classList.toggle("tp-side-fresh", Boolean(s.sidebarFresh && r.live && r.since != null && now - r.since < FRESH_MS));
      }

      // Custom order among live channels; offline ones keep Twitch's order after them.
      // No entry for "twitch": keep Twitch's own order.
      const key: Partial<Record<string, (r: (typeof ranked)[number]) => number | string>> = {
        newest: (r) => -(r.since ?? 0),
        longest: (r) => r.since ?? Infinity,
        name: (r) => r.login,
        watched: (r) => -(watched[r.login] ?? 0),
      };
      const by = key[s.sidebarSort];
      const order = by
        ? [...ranked].sort((x, y) => Number(y.live) - Number(x.live) || (by(x) < by(y) ? -1 : by(x) > by(y) ? 1 : x.i - y.i))
        : ranked;
      order.forEach((r, rank) => {
        const item = listItem(r.a) as HTMLElement;
        if (by) {
          item.parentElement?.classList.add("tp-side-sorted");
          item.style.setProperty("--tp-rank", String(rank));
        } else item.style.removeProperty("--tp-rank");
      });
    }

    load();
    const offLive = platform.local.onChange(LIVE_KEY, load);
    const offWatch = platform.local.onChange(WATCH_KEY, load);
    const stopDom = onDom(sync);
    const offSettings = settings.onChange((c) => Object.keys(c).some((k) => k.startsWith("sidebar")) && ((lastSig = ""), sync()));
    const minute = window.setInterval(sync, 60_000); // uptimes tick even when the page is quiet

    return () => {
      stopDom();
      offLive();
      offWatch();
      offSettings();
      clearInterval(minute);
      style.remove();
      document.querySelectorAll(`.${UP}`).forEach((e) => e.remove());
      document.querySelectorAll(".tp-side-fresh").forEach((e) => e.classList.remove("tp-side-fresh"));
      document.querySelectorAll(".tp-side-sorted").forEach((e) => e.classList.remove("tp-side-sorted"));
      document.querySelectorAll<HTMLElement>("#side-nav [style*='--tp-rank']").forEach((e) => e.style.removeProperty("--tp-rank"));
    };
  },
};
