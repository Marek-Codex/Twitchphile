// Small shared helpers used across features.

// Adds a <style> to the page; returns its remover. `css` can be updated later via the returned element.
export function injectStyle(css: string) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  return style;
}

// Lowercased, "@"-stripped, de-duplicated set of names (usernames, channel logins).
export const lowerSet = (list: string[]) => new Set(list.map((s) => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean));

// Adds `name` to the list, or removes it if present (case-insensitive). Returns a new list.
export function toggleIn(list: string[], name: string): string[] {
  const n = name.toLowerCase();
  return list.some((x) => x.toLowerCase() === n) ? list.filter((x) => x.toLowerCase() !== n) : [...list, name];
}

// Case-insensitive whole-word matcher for a list of words, or null when the list is empty.
// Uses "not touching a word character" lookarounds rather than \b, which never matches beside symbols
// (so words like "c++" or "!drop" still work).
export function wordRegex(words: string[]): RegExp | null {
  const escaped = words
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return escaped.length ? new RegExp(`(?<!\\w)(?:${escaped.join("|")})(?!\\w)`, "i") : null;
}

// Accent- and case-insensitive form for matching: "Pokémon" and "POKEMON" both become "pokemon".
export const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
