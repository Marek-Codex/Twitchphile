// Runs in the page's MAIN world at document_start, before Twitch's own code: notes the stream tags that Twitch's
// GraphQL responses already carry (directory cards, front page), so features can use them without a single extra
// request — and even when the layout is too narrow to show tags on the cards.
// Read-only: Twitch's request and response are passed through untouched; we only read a clone, after the fact.
// Talks to the content script over DOM events (see core/streams.ts); keeps what it saw for late listeners.
type Seen = Record<string, string[]>; // login → tag names

const seen: Seen = {};
const MAX_DEPTH = 18;

function collect(node: unknown, out: Seen, depth = 0) {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out, depth + 1);
    return;
  }
  const o = node as Record<string, any>;
  const login = o.broadcaster?.login;
  if (typeof login === "string" && Array.isArray(o.freeformTags)) {
    out[login.toLowerCase()] = o.freeformTags.map((t: any) => String(t?.name ?? "")).filter(Boolean);
    return; // a stream node: nothing deeper we need
  }
  for (const k in o) if (o[k] && typeof o[k] === "object") collect(o[k], out, depth + 1);
}

const publish = (batch: Seen) => document.dispatchEvent(new CustomEvent("tp:streams", { detail: JSON.stringify(batch) }));

const originalFetch = window.fetch;
window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
  const res = originalFetch.apply(this, args);
  const url = args[0] instanceof Request ? args[0].url : String(args[0]);
  if (url.startsWith("https://gql.twitch.tv/gql")) {
    res
      .then((r) => (r.ok ? r.clone().json() : null))
      .then((body) => {
        const batch: Seen = {};
        collect(body, batch);
        if (!Object.keys(batch).length) return;
        Object.assign(seen, batch);
        publish(batch);
      })
      .catch(() => {});
  }
  return res;
} as typeof fetch;

// The content script starts later (document_idle); it asks once for everything seen so far.
document.addEventListener("tp:streams-hello", () => publish(seen));
