// "(chatters)" beside Twitch's viewer count, and per participant in the Stream Together hover card.
import { onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import { player } from "../../core/player";
import { channelLogin } from "../../core/twitch";
import { injectStyle } from "../../core/util";

const CLS = "tp-chatters";
const TTL = 60_000;
const VIEWERS = 'strong[data-a-target="animated-channel-viewers-count"]';
// Live dots in hover cards; the side-nav tooltip has them too, but that's not the Stream Together card.
const INDICATOR = ".tw-dialog-layer .tw-channel-status-indicator";

const STYLE = `.${CLS}{margin-left:4px;font-weight:600;color:var(--color-text-alt-2);font-variant-numeric:tabular-nums}`;
const fmt = (n: number) => n.toLocaleString();

export const chatterCount: Feature = {
  key: "chatterCount",
  start() {
    const style = injectStyle(STYLE);

    const cache = new Map<string, { at: number; count: number | null; pending?: Promise<number | null> }>();

    // Cached per login; concurrent callers share one request.
    function count(login: string): Promise<number | null> {
      const hit = cache.get(login);
      if (hit?.pending) return hit.pending;
      if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.count);
      const pending = player.chatters(login).then((c) => {
        cache.set(login, { at: Date.now(), count: c });
        return c;
      });
      cache.set(login, { at: hit?.at ?? 0, count: hit?.count ?? null, pending });
      return pending;
    }

    function badge(after: Element, login: string) {
      let el = after.parentElement?.querySelector<HTMLElement>(`:scope > .${CLS}`);
      if (!el) {
        el = document.createElement("span");
        el.className = CLS;
        after.after(el);
      }
      if (el.dataset.login === login && el.textContent) return;
      el.dataset.login = login;
      count(login).then((n) => {
        el!.textContent = n == null ? "" : `(${fmt(n)})`;
        el!.title = n == null ? "" : `${fmt(n)} logged-in chatters`;
      });
    }

    const stopDom = onDom(() => {
      const login = channelLogin();
      const viewers = document.querySelector(VIEWERS);
      if (viewers && login) badge(viewers, login);

      document.querySelectorAll(INDICATOR).forEach((dot) => {
        if (dot.closest(".online-side-nav-channel-tooltip__body")) return;
        const name = dot.parentElement?.parentElement?.parentElement?.querySelector("p")?.textContent?.trim().toLowerCase();
        if (name && dot.parentElement) badge(dot.parentElement.lastElementChild ?? dot, name);
      });
    });

    // Refresh the main count once a minute (cached lookups make this cheap).
    const timer = window.setInterval(() => {
      const el = document.querySelector<HTMLElement>(`${VIEWERS} ~ .${CLS}`);
      if (el) el.dataset.login = ""; // stale: next DOM tick refetches, old number stays until then
    }, TTL);

    return () => {
      stopDom();
      clearInterval(timer);
      style.remove();
      document.querySelectorAll(`.${CLS}`).forEach((el) => el.remove());
    };
  },
};
