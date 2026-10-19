// Tiny always-loaded shim: top-nav button + hotkey. The panel (Preact + CSS) loads on first open.
import { platform } from "@platform";
import { onDom } from "../core/dom";
import { settings as settingsIcon, svg } from "./icons";

const BTN_ID = "tp-settings-btn";

type PanelModule = { toggle(): void; openChannelStats(login: string): void };
let panel: Promise<PanelModule> | null = null;
let fontsReady = false;

function loadFonts() {
  if (fontsReady) return;
  fontsReady = true;
  // @font-face doesn't apply inside shadow roots, so register on the document under our own family names.
  for (const [family, file, weight] of [["Exo 2", "exo2", "100 900"], ["Kode Mono", "kodemono", "500"]]) {
    const face = new FontFace(family, `url(${platform.url(`fonts/${file}.woff2`)})`, { weight });
    document.fonts.add(face);
    face.load().catch(() => {});
  }
}

const loadPanel = () => {
  loadFonts();
  return (panel ??= import(platform.url("panel.js")) as Promise<PanelModule>);
};

export function togglePanel() {
  loadPanel().then((m) => m.toggle());
}

/** The channel-stats drawer (same lazily-loaded module as the settings panel). */
export function openStats(login: string) {
  loadPanel().then((m) => m.openChannelStats(login));
}

function ensureButton() {
  if (document.getElementById(BTN_ID)) return;
  // Right-hand column of Twitch's top nav: [compact search (hidden on desktop)] [prime] [notifications/whispers…] [user].
  const column = document.querySelector(".top-nav__menu")?.lastElementChild;
  if (!column) return;
  const before = column.querySelector(":scope > .top-nav__prime") ?? column.lastElementChild;
  // Twitch's icon-button classes (search/whispers use the same ScButtonIcon style).
  const ref = document.querySelector<HTMLButtonElement>(".top-nav__menu button[class*='ScButtonIcon']");
  const btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.type = "button";
  btn.title = btn.ariaLabel = "Twitchphile";
  btn.className = ref?.className ?? "";
  btn.innerHTML = svg(settingsIcon, 20);
  // Signature: a tiny accent dot, otherwise pure Twitch styling.
  Object.assign(btn.style, { position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" });
  if (!ref) Object.assign(btn.style, { width: "30px", height: "30px", color: "inherit", background: "none", border: "0", cursor: "pointer" });
  const dot = document.createElement("span");
  Object.assign(dot.style, {
    position: "absolute", top: "5px", right: "5px", width: "5px", height: "5px", borderRadius: "50%",
    background: "#3CA0FF", boxShadow: "0 0 6px rgba(60,160,255,.6)", pointerEvents: "none",
  });
  btn.append(dot);
  btn.addEventListener("click", togglePanel);
  const slot = document.createElement("div");
  Object.assign(slot.style, { display: "flex", alignItems: "center", padding: "0 5px" });
  slot.append(btn);
  column.insertBefore(slot, before);
}

const onKey = (e: KeyboardEvent) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyO") {
    e.preventDefault();
    togglePanel();
  }
};
let stopButton: (() => void) | null = null;

export function startUi() {
  stopButton = onDom(ensureButton);
  document.addEventListener("keydown", onKey);
}

export function stopUi() {
  stopButton?.();
  document.removeEventListener("keydown", onKey);
  document.getElementById(BTN_ID)?.parentElement?.remove();
  document.querySelector("twitchphile-panel")?.remove();
}
