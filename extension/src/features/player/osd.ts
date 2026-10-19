// On-screen readout: a brief glass chip over the player for volume and action feedback.
import { settings } from "../../core/settings";
import { playerRoot } from "../../core/twitch";
import { injectStyle } from "../../core/util";

const STYLE = `
.tp-osd{position:absolute;top:14%;left:50%;z-index:9999;transform:translate(-50%,-4px);
padding:6px 12px;border-radius:4px;border:1px solid rgba(60,160,255,.35);border-left-width:2px;
background:rgba(10,13,18,.62);backdrop-filter:blur(8px);color:#F2F7FF;
font:600 13px/1.3 "Kode Mono",ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;
pointer-events:none;opacity:0;transition:opacity .15s ease,transform .15s ease}
.tp-osd.on{opacity:1;transform:translate(-50%,0)}`;

let el: HTMLDivElement | null = null;
let timer = 0;

export function osd(text: string) {
  if (!settings.get().showOsd) return;
  if (!el) {
    injectStyle(STYLE);
    el = document.createElement("div");
    el.className = "tp-osd";
  }
  const host = playerRoot() ?? document.body;
  if (el.parentElement !== host) host.append(el);
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(timer);
  timer = window.setTimeout(() => el?.classList.remove("on"), 900);
}
