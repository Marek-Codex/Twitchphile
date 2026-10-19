// On VODs: the real-world clock time of the moment you're watching, in the player bar.
import { platform } from "@platform";
import { $, onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import { video, vodId } from "../../core/twitch";
import { clock, svg } from "../../ui/icons";

const ID = "tp-realtime";
const fmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

export const realTime: Feature = {
  key: "realTime",
  start() {
    let id = "";
    let start: number | null = null;
    let el: HTMLElement | null = null;
    let bound: HTMLVideoElement | null = null;

    const render = () => {
      const v = video();
      if (!el || start == null || !v) return;
      const at = new Date(start + v.currentTime * 1000);
      el.querySelector(".v")!.textContent = fmt.format(at);
      el.title = `Real time at this point: ${fmtDay.format(at)}, ${fmt.format(at)}`;
    };

    const stopDom = onDom(() => {
      const now = vodId();
      if (now !== id) {
        id = now;
        start = null;
        el?.remove();
        el = null;
        if (id) {
          platform.send<string | null>({ type: "video", id }).then((iso) => {
            if (id === now && iso) (start = Date.parse(iso)), render();
          });
        }
      }
      if (!id) return;
      const group = $(".player-controls__left-control-group");
      if (group && !group.contains(el)) {
        el = document.createElement("div");
        el.id = ID;
        Object.assign(el.style, {
          display: "inline-flex", alignItems: "center", gap: "5px", marginLeft: "10px", color: "#fff",
          font: "600 13px var(--font-base)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        });
        el.innerHTML = `${svg(clock)}<span class="v"></span>`;
        group.append(el);
        render();
      }
      const v = video();
      if (v && v !== bound) {
        bound?.removeEventListener("timeupdate", render);
        v.addEventListener("timeupdate", render);
        bound = v;
      }
    });

    return () => {
      stopDom();
      bound?.removeEventListener("timeupdate", render);
      el?.remove();
    };
  },
};
