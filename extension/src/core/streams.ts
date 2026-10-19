// Isolated-world side of src/sniff.ts: stream tags Twitch's own responses carried, by channel login.
// Lets features read tags (and the language and Drops that Twitch expresses as tags) without extra requests.
export { hasDrops, languageOf } from "./tags";

const tags = new Map<string, string[]>();
const subs = new Set<() => void>();

document.addEventListener("tp:streams", (e) => {
  const batch = JSON.parse((e as CustomEvent<string>).detail) as Record<string, string[]>;
  for (const [login, t] of Object.entries(batch)) tags.set(login, t);
  subs.forEach((cb) => cb());
});
document.dispatchEvent(new CustomEvent("tp:streams-hello"));

export const streamTags = (login: string) => tags.get(login.toLowerCase());

/** Called whenever new stream data arrives (e.g. to re-check cards). */
export function onStreams(cb: () => void) {
  subs.add(cb);
  return () => void subs.delete(cb);
}
