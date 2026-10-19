// The settings panel: a modal in a shadow root (isolated from Twitch's CSS), lazy-loaded on first open.
import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { platform } from "@platform";
import { runProbes } from "../../core/probes";
import { PRESETS, presetChanges, type Preset } from "../../core/presets";
import { ESSENTIAL, SCHEMA, type Category, type SettingRow } from "../../core/schema";
import { settings, type Settings } from "../../core/settings";
import { Icon } from "../Icon";
import { close as closeIcon, search } from "../icons";
import { Rows } from "./controls";
import css from "./panel.css";
export { openChannelStats } from "../stats/drawer";
import { Account, DataCard, DataStatus, DesktopCard, Diagnostics, DropsList, PrimeCard, WatchList } from "./sections";

function Panel({ onClose, standalone = false }: { onClose: () => void; standalone?: boolean }) {
  const [s, setS] = useState<Settings>(settings.get());
  const [active, setActive] = useState(SCHEMA[0].id);
  const [query, setQuery] = useState("");
  // "Essentials" shows the settings most people touch; "Everything" shows all of them. Remembered between opens.
  const [view, setView] = useState<"essentials" | "all">("essentials");
  useEffect(() => void platform.local.get<"essentials" | "all">("panelView").then((v) => v && setView(v)), []);
  const pickView = (v: "essentials" | "all") => (setView(v), platform.local.set("panelView", v));

  // Presets: one click applies a setup; the bar that follows offers Undo (back to exactly what changed).
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [applied, setApplied] = useState<{ name: string; count: number; before: Partial<Settings> } | null>(null);
  const applyPreset = (p: Preset) => {
    setPresetsOpen(false);
    const current = settings.get();
    const changes = presetChanges(p, current);
    const keys = Object.keys(changes) as (keyof Settings)[];
    const before = Object.fromEntries(keys.map((k) => [k, current[k]])) as Partial<Settings>;
    if (keys.length) settings.set(changes);
    setApplied({ name: p.name, count: keys.length, before });
    if (p.id === "everything") pickView("all");
  };
  // The hook check inspects the Twitch page it's opened on; the standalone settings page has none.
  const [probes] = useState(() => (standalone ? [] : runProbes(settings.get())));
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const broken = probes.filter((p) => !p.ok && !p.optional).length;
  const checked = probes.filter((p) => !p.optional).length;

  useEffect(() => {
    settings.load().then((v) => setS({ ...v }));
    const off = settings.onChange(() => setS({ ...settings.get() }));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    searchRef.current?.focus();
    return () => (off(), window.removeEventListener("keydown", onKey));
  }, []);

  const matches = useMemo(() => {
    const hit = (r: SettingRow) =>
      q ? `${r.title} ${r.description}`.toLowerCase().includes(q) : view === "all" || ESSENTIAL.has(r.key);
    return SCHEMA.map((c) => ({ ...c, rows: c.rows.filter(hit) }));
  }, [q, view]);

  // Searching shows every matching category; otherwise just the selected one.
  const shown: Category[] = q ? matches.filter((c) => c.rows.length) : matches.filter((c) => c.id === active);
  const go = (id: string) => (setQuery(""), setActive(id));

  return (
    <div class="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="panel" role="dialog" aria-modal="true" aria-label="Twitchphile settings">
        <header>
          <div class="brand">
            <img class="glyph" src={platform.url("icons/64.png")} alt="" />
            <div>
              <div class="name">
                Twitch<b>phile</b>
              </div>
              <span class="meta">CODEX PLEXUS // v{platform.version}</span>
            </div>
          </div>
          <div class="spacer" />
          {probes.length > 0 && (
            <button class={`health${broken ? " bad" : ""}`} title="Check how features hook into this page" onClick={() => go("data")}>
              <i /> {broken ? `${broken} HOOK${broken > 1 ? "S" : ""} BROKEN` : `${checked}/${checked} HOOKS OK`}
            </button>
          )}
          <div class="presets">
            <button class={`preset-btn${presetsOpen ? " open" : ""}`} aria-haspopup="menu" aria-expanded={presetsOpen} onClick={() => setPresetsOpen(!presetsOpen)}>
              PRESETS ▾
            </button>
            {presetsOpen && (
              <div class="preset-menu" role="menu">
                {PRESETS.map((p) => (
                  <button key={p.id} role="menuitem" onClick={() => applyPreset(p)}>
                    <b>{p.name}</b>
                    <span>{p.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div class="views" role="tablist" aria-label="How many settings to show">
            <button role="tab" aria-selected={view === "essentials"} onClick={() => pickView("essentials")}>ESSENTIALS</button>
            <button role="tab" aria-selected={view === "all"} onClick={() => pickView("all")}>EVERYTHING</button>
          </div>
          <div class="search">
            <Icon icon={search} />
            <input ref={searchRef} placeholder="Search settings" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          </div>
          <button class="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon icon={closeIcon} size={18} />
          </button>
        </header>
        <div class="body">
          <nav>
            {matches.map((c) => (
              <button key={c.id} class={`nav-item${!q && c.id === active ? " active" : ""}${q && !c.rows.length ? " dim" : ""}`} onClick={() => go(c.id)}>
                <Icon icon={c.icon} />
                <span class="label">{c.label}</span>
                <span class="count">{c.rows.length}</span>
              </button>
            ))}
            <div class="nav-foot">ALT+O TO TOGGLE</div>
          </nav>
          <div class="content">
            {applied && (
              <div class="applied">
                <span>
                  <b>{applied.name}</b> {applied.count ? `applied — ${applied.count} setting${applied.count === 1 ? "" : "s"} changed.` : "— already set up that way."}
                </span>
                {applied.count > 0 && (
                  <button onClick={() => (settings.set(applied.before), setApplied(null))}>Undo</button>
                )}
                <button aria-label="Dismiss" onClick={() => setApplied(null)}>✕</button>
              </div>
            )}
            {shown.length ? (
              shown.map((c) => (
                <section class="section" key={c.id}>
                  <h2 class="section-title">{c.label}</h2>
                  {c.account && !q && <Account />}
                  {c.rows.length > 0 && <Rows rows={c.rows} s={s} q={q} />}
                  {c.watchList && !q && <WatchList />}
                  {c.drops && !q && settings.get().primeReminder && <PrimeCard />}
                  {c.drops && !q && settings.get().dropsTracker && <DropsList />}
                  {c.data && !q && (
                    <>
                      <DesktopCard />
                      <DataStatus />
                      <DataCard />
                      {!standalone && <Diagnostics results={probes} />}
                    </>
                  )}
                </section>
              ))
            ) : (
              <div class="empty">NO MATCHES FOR "{query}"</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

let host: HTMLElement | null = null;

export function toggle() {
  if (host) return close();
  host = document.createElement("twitchphile-panel");
  host.classList.toggle("light", document.documentElement.classList.contains("tw-root--theme-light"));
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const mount = document.createElement("div");
  root.append(style, mount);
  document.body.append(host);
  render(<Panel onClose={close} />, mount);
}

// The extension's own settings page (options.html): the same panel, filling a browser tab, reachable from the
// toolbar popup and the browser's extension menu — no Twitch tab needed.
export async function openStandalone() {
  await settings.load();
  host = document.createElement("twitchphile-panel");
  host.classList.add("standalone");
  host.classList.toggle("light", matchMedia("(prefers-color-scheme: light)").matches);
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const mount = document.createElement("div");
  root.append(style, mount);
  document.body.append(host);
  render(<Panel standalone onClose={() => window.close()} />, mount);
}

function close() {
  if (!host) return;
  render(null, host.shadowRoot!.lastElementChild!);
  host.remove();
  host = null;
}
