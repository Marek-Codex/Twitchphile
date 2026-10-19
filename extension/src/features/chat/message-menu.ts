// Hover toolbar on chat messages. A single element is reused and moved to whichever line is hovered.
import { $ } from "../../core/dom";
import { listen, type Feature } from "../../core/feature";
import { settings } from "../../core/settings";
import { injectStyle, lowerSet, toggleIn } from "../../core/util";
import { at, copy, star, svg, tag } from "../../ui/icons";

const LINE = ".chat-line__message";
const ID = "tp-msg-menu";

const STYLE = `
${LINE}{position:relative}
#${ID}{position:absolute;top:-14px;right:36px;z-index:5;display:flex;align-items:center;gap:1px;padding:2px;
background:var(--color-background-base);border:1px solid var(--color-border-base);border-radius:6px;
box-shadow:0 2px 8px rgba(0,0,0,.35)}
#${ID} button{display:grid;place-items:center;width:26px;height:24px;border:0;border-radius:4px;background:none;
color:var(--color-text-alt);cursor:pointer;transition:background .15s ease,color .15s ease}
#${ID} button:hover{background:var(--color-background-button-text-hover);color:var(--color-text-base)}
#${ID} button[data-on]{color:#3CA0FF}
#${ID} input{width:120px;height:24px;padding:0 6px;border:1px solid #3CA0FF;border-radius:4px;outline:none;
background:var(--color-background-input);color:var(--color-text-base);font:12px var(--font-base)}
#${ID}::after{content:"";position:absolute;right:-1px;top:-1px;width:4px;height:4px;border-radius:50%;background:#3CA0FF}`;

const lineData = (line: Element) => ({
  login: line.querySelector("[data-a-user]")?.getAttribute("data-a-user")?.toLowerCase() ?? "",
  text: line.querySelector('[data-a-target="chat-line-message-body"]')?.textContent ?? "",
});

function mention(login: string) {
  const input = $<HTMLElement>('[data-a-target="chat-input"]');
  if (!input) return;
  input.focus();
  // Twitch's input is a rich editor; insertText goes through its own input handling.
  document.execCommand("insertText", false, `@${login} `);
}

export const messageMenu: Feature = {
  key: "messageMenu",
  start() {
    const style = injectStyle(STYLE);
    const menu = document.createElement("div");
    menu.id = ID;
    let current: Element | null = null;
    let editing = false;

    function render() {
      if (!current) return;
      const { login } = lineData(current);
      const s = settings.get();
      const btn = (act: string, ic: string, title: string, on = false) =>
        `<button data-act="${act}" title="${title}" aria-label="${title}"${on ? " data-on" : ""}>${svg(ic, 16)}</button>`;
      menu.innerHTML =
        btn("copy", copy, "Copy message") +
        btn("mention", at, `Mention @${login}`) +
        (s.chatHighlight ? btn("star", star, "Highlight user", lowerSet(s.highlightUsers).has(login)) : "") +
        (s.nicknames ? btn("tag", tag, "Set nickname", Boolean(s.nicknameMap[login])) : "");
    }

    function nicknameInput(login: string) {
      editing = true;
      const input = document.createElement("input");
      input.placeholder = "Nickname (empty clears)";
      input.value = settings.get().nicknameMap[login] ?? "";
      const done = (save: boolean) => {
        if (!editing) return;
        editing = false;
        if (save) {
          const map = { ...settings.get().nicknameMap };
          const v = input.value.trim();
          if (v) map[login] = v;
          else delete map[login];
          settings.set({ nicknameMap: map });
        }
        render();
      };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation(); // keep Twitch hotkeys out
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") done(false);
      });
      input.addEventListener("blur", () => done(true));
      menu.replaceChildren(input);
      input.focus();
      input.select();
    }

    menu.addEventListener("click", (e) => {
      const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (!act || !current) return;
      e.stopPropagation();
      const { login, text } = lineData(current);
      const s = settings.get();
      if (act === "copy") navigator.clipboard.writeText(text);
      if (act === "mention") mention(login);
      if (act === "star") settings.set({ highlightUsers: toggleIn(s.highlightUsers, login) });
      if (act === "tag") return nicknameInput(login);
      render();
    });

    const offOver = listen("mouseover", (e) => {
      if (editing) return;
      const line = (e.target as Element).closest?.(LINE);
      if (!line || line === current || !lineData(line).login) return;
      current = line;
      render();
      line.append(menu);
    });
    const offLeave = listen("mouseleave", (e) => {
      if (!editing && e.target instanceof Element && e.target.matches(".chat-scrollable-area__message-container")) {
        menu.remove();
        current = null;
      }
    });
    const offSettings = settings.onChange(() => !editing && render());

    return () => {
      offOver();
      offLeave();
      offSettings();
      menu.remove();
      style.remove();
    };
  },
};
