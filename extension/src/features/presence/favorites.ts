// favorites in the sidebar: a ★ on each followed channel pins it to the top. Same list as the popup stars,
// schedules, badge and auto-open. Reorders with CSS `order` only — Twitch's DOM is never moved, so React can't fight it.
import { onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import { settings } from "../../core/settings";
import { injectStyle, lowerSet, toggleIn } from "../../core/util";
import { star, svg } from "../../ui/icons";

const CARD = '#side-nav a[data-test-selector="followed-channel"]';
const BTN = "tp-fav";
const STYLE = `
.tp-fav-list{display:flex!important;flex-direction:column}
.tp-fav-list>*{order:var(--tp-rank,0)}
.tp-fav-list>.tp-fav-item{order:calc(var(--tp-rank,0) - 100000);position:relative}
.tp-fav-item::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:#3CA0FF;z-index:1}
.${BTN}{position:absolute;right:4px;top:50%;transform:translateY(-50%);z-index:2;display:none;place-items:center;
width:22px;height:22px;border:0;border-radius:4px;cursor:pointer;background:var(--color-background-base);color:var(--color-text-alt-2)}
.${BTN}:hover{color:var(--color-text-base)}
.${BTN}[data-on]{color:#3CA0FF}
.tp-fav-host:hover .${BTN}{display:grid}`;

const loginOf = (a: Element) => a.getAttribute("href")?.slice(1).toLowerCase() ?? "";

// The list item is the ancestor whose parent holds all the channel rows.
export function listItem(card: Element) {
  let item: Element = card;
  while (item.parentElement && !item.parentElement.querySelectorAll(CARD)[1]) item = item.parentElement;
  return item;
}

function starButton(host: HTMLElement) {
  const btn = document.createElement("button");
  btn.className = BTN;
  btn.innerHTML = svg(star, 14);
  btn.addEventListener("click", (e) => {
    e.preventDefault(); // it sits over the channel link
    e.stopPropagation();
    settings.set({ favorites: toggleIn(settings.get().favorites, host.dataset.tpLogin ?? "") });
  });
  host.style.position ||= "relative";
  host.append(btn);
  return btn;
}

export const pinFavorites: Feature = {
  key: "pinFavorites",
  start() {
    const style = injectStyle(STYLE);
    let dirty = true;

    function sync() {
      const cards = document.querySelectorAll(CARD);
      // Fast path: chat mutations fire this constantly; skip unless the sidebar or favorites changed.
      // (Twitch recycles cards for other channels when it re-sorts, hence comparing logins.)
      if (!dirty && [...cards].every((a) => a.parentElement?.dataset.tpLogin === loginOf(a))) return;
      dirty = false;
      const favs = lowerSet(settings.get().favorites);
      cards.forEach((a) => {
        const host = a.parentElement; // wraps the link; our button lives here, never inside the <a>
        const item = listItem(a);
        if (!host || !item.parentElement) return;
        const login = loginOf(a);
        const on = favs.has(login);
        item.parentElement.classList.add("tp-fav-list");
        item.classList.toggle("tp-fav-item", on);
        host.classList.add("tp-fav-host");
        host.dataset.tpLogin = login;
        const btn = host.querySelector<HTMLButtonElement>(`:scope > .${BTN}`) ?? starButton(host);
        btn.toggleAttribute("data-on", on);
        btn.title = btn.ariaLabel = on ? "Remove from favorites" : "Add to favorites";
      });
    }

    const stopDom = onDom(sync);
    const offSettings = settings.onChange((c) => "favorites" in c && ((dirty = true), sync()));

    return () => {
      stopDom();
      offSettings();
      style.remove();
      document.querySelectorAll(`.${BTN}`).forEach((b) => b.remove());
      document.querySelectorAll<HTMLElement>(".tp-fav-list,.tp-fav-item,.tp-fav-host").forEach((el) => {
        el.classList.remove("tp-fav-list", "tp-fav-item", "tp-fav-host");
        delete el.dataset.tpLogin;
      });
    };
  },
};
