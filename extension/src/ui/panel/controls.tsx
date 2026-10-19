// Setting rows and their controls, rendered from the schema.
import { channelName } from "../../core/channels";
import type { SettingRow } from "../../core/schema";
import { settings, type Settings } from "../../core/settings";

// Wraps the first occurrence of the search query in <mark>.
function highlight(text: string, q: string) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

const set = (key: keyof Settings, value: unknown) => settings.set({ [key]: value });

function Chip({ label, onRemove, removeLabel }: { label: preact.ComponentChildren; onRemove: () => void; removeLabel: string }) {
  return (
    <span class="chip">
      {label}
      <button aria-label={removeLabel} onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

function Control({ row, s }: { row: SettingRow; s: Settings }) {
  const value = s[row.key];
  const c = row.control;

  switch (c.type) {
    case "toggle":
      return <button class="toggle" role="switch" aria-checked={Boolean(value)} aria-label={row.title} onClick={() => set(row.key, !value)} />;

    case "select":
      return (
        <div class="seg" role="radiogroup" aria-label={row.title}>
          {c.options.map((o) => (
            <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => set(row.key, o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      );

    case "map": {
      const map = value as Record<string, string>;
      const entries = Object.entries(map);
      if (!entries.length) return <div class="chips muted">{c.empty}</div>;
      return (
        <div class="chips">
          {entries.map(([k, v]) => (
            <Chip
              key={k}
              label={<>{k} <span class="arrow">→</span> {v}</>}
              removeLabel={`Remove ${k}`}
              onRemove={() => set(row.key, Object.fromEntries(entries.filter(([key]) => key !== k)))}
            />
          ))}
        </div>
      );
    }

    case "list": {
      const items = value as string[];
      const add = (raw: string) => {
        const next = raw
          .split(/\r?\n/) // one entry per line — a category/tag name with a comma in it stays whole
          .map((v) => (c.placeholder === "channel" ? channelName(v) : v.trim()))
          .filter((v) => v && !items.includes(v));
        if (next.length) set(row.key, [...items, ...next]);
      };
      return (
        <div class="chips">
          {items.map((item) => (
            <Chip key={item} label={item} removeLabel={`Remove ${item}`} onRemove={() => set(row.key, items.filter((i) => i !== item))} />
          ))}
          <input
            placeholder={`+ ${c.placeholder}`}
            aria-label={`Add ${c.placeholder}`}
            onKeyDown={(e) => {
              const input = e.currentTarget;
              if (e.key === "Enter") { // Enter commits; comma is a normal character now (names contain them)
                e.preventDefault();
                add(input.value);
                input.value = "";
              } else if (e.key === "Backspace" && !input.value && items.length) {
                set(row.key, items.slice(0, -1));
              }
            }}
            onBlur={(e) => {
              add(e.currentTarget.value);
              e.currentTarget.value = "";
            }}
          />
        </div>
      );
    }

    case "number":
      return (
        <label class="num">
          <input
            type="number"
            min={c.min}
            max={c.max}
            value={Number(value)}
            aria-label={row.title}
            onChange={(e) => {
              const n = Math.min(c.max, Math.max(c.min, Number(e.currentTarget.value) || c.min));
              e.currentTarget.value = String(n);
              set(row.key, n);
            }}
          />
          {c.unit && <span class="unit">{c.unit}</span>}
        </label>
      );
  }
}

// Consecutive rows sharing a `group` become one card under a small heading.
export function Rows({ rows, s, q }: { rows: SettingRow[]; s: Settings; q: string }) {
  const groups: { title?: string; rows: SettingRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.title === row.group) last.rows.push(row);
    else groups.push({ title: row.group, rows: [row] });
  }
  return (
    <>
      {groups.map((g, i) => (
        <div class="group" key={g.title ?? i}>
          {g.title && <h3 class="group-title">[ {g.title} ]</h3>}
          <Card rows={g.rows} s={s} q={q} />
        </div>
      ))}
    </>
  );
}

// A choice with many (or long) options goes below its description, full width, instead of squeezing the text into
// a narrow column beside it.
const wideSelect = (c: SettingRow["control"]) =>
  c.type === "select" && (c.options.length > 3 || c.options.reduce((n, o) => n + o.label.length, 0) > 28);

function Card({ rows, s, q }: { rows: SettingRow[]; s: Settings; q: string }) {
  return (
    <div class="card">
      {rows.map((row) => {
        const cls = [
          "row",
          row.requires && "nested",
          row.requires && !s[row.requires] && "disabled",
          (row.control.type === "list" || row.control.type === "map" || wideSelect(row.control)) && "stack",
        ];
        return (
          <div key={row.key} class={cls.filter(Boolean).join(" ")}>
            <div class="info">
              <div class="title">{highlight(row.title, q)}</div>
              <div class="desc">{highlight(row.description, q)}</div>
            </div>
            <Control row={row} s={s} />
          </div>
        );
      })}
    </div>
  );
}
