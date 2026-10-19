# Twitchphile (extension)

**Be there for every stream you care about — in your browser. nyaa~**

An obnoxiously lightweight Twitch suite for Brave / Chromium. One extension instead of a dozen: player and chat
upgrades, live telemetry, lurking done right, and a clean way to keep up with who's live. Every feature is a switch,
and a switched-off feature costs nothing. It's the well-behaved one in the family — no ad blocking, no funny business,
just Twitch, nicer.

---

## What it does

| Area | Highlights |
|---|---|
| **Player** | Click-to-pause, scroll volume, on-screen readout, screenshot, cinema mode (player + chat fullscreen), picture-in-picture, remembered quality & volume per channel, real clock time on VODs, clip download, auto-recover from player errors, mute during ads, mute tabs you leave |
| **Stream** | Telemetry strip — latency (click → jump to live), uptime, viewer trend with hover sparkline, your watch time — in the chat header or under the player; chatter count beside viewers (incl. Stream Together); latency reducer |
| **Chat** | Highlight users & keywords, hover message menu (copy · mention · highlight · nickname), nicknames, mention spotlight, copy emote, opt-in image previews, mention & keyword chimes |
| **Filters** | Bot dimming, readable name colors (WCAG 4.5:1), mute users & words, Giphy mini/hide |
| **Live** | Toolbar popup of who's live, favorites (★ pins in the sidebar too), also-watch non-followed channels, badge count, go-live notifications, upcoming schedules, recently ended |
| **Auto-open** | Opens favorites when they go live — tab limit, fair rotation, lurk mode (full quality in background), closes when they end, never touches your own tabs |
| **Points** | Auto-claim bonus chests (works in background tabs), drops claiming, per-channel chest tally |
| **Declutter** | Hide Stories, Twitch extensions, leaderboard, highlight stack; filter channels & categories out of browse pages; stop homepage autoplay |
| **Data** | Watch-time leaderboard, backup export/import, live hook diagnostics |

**Hotkeys** — Alt+L live · Alt+←/→ skip 10s · Alt+, / Alt+. VOD speed · Alt+S screenshot · Alt+P PiP · Alt+F cinema · Alt+C chat · **Alt+O settings** (Alt+T stays Twitch's).

## Install (development)

```bash
npm install
npm run build
```

Then in Brave: `brave://extensions` → **Developer mode** → **Load unpacked** → `extension/dist/chromium`.

The manifest carries a fixed key, so the extension ID is always `jdemjjgkcelbkaacdfdbnnnifhoomhop` — the Twitch
OAuth redirect `https://jdemjjgkcelbkaacdfdbnnnifhoomhop.chromiumapp.org/twitch-oauth` is registered once and never
changes. The private key lives in `keys/` (git-ignored) — back it up.

| Script | |
|---|---|
| `npm run build` | Production build → `dist/chromium` + `dist/firefox` (prints total size) |
| `npm run build:chromium` | Chromium-only build |
| `npm run build:firefox` | Firefox-only build → `dist/twitchphile-firefox.xpi` |
| `npm run package` | Build + package the distributable zips/`.xpi` (below) |
| `npm run watch` | Rebuild Chromium on save |
| `npm test` | Logic tests (node:test, no framework) |
| `npm run typecheck` | TypeScript |
| `npm run icons` | Regenerate inlined Phosphor icons |
| `npm run fonts` | Re-subset bundled fonts |
| `npm run prepare` | Runs `icons` + `fonts` (auto-runs on `npm install`) |

## Distribution

`npm run package` builds and drops the release artifacts in the parent folder (`Brave Extensions\`), same
convention as the rest of the family. Ship them via GitHub Releases — no store listing.

- **`Twitchphile-<ver>-dragdrop.zip`** — `manifest.json` at the archive root; drag it onto a browser's
  extensions page.
- **`Twitchphile-<ver>-unpacked.zip`** — files under `Twitchphile/`; unzip, then Load unpacked → that folder.
- **`Twitchphile-<ver>.xpi`** — Firefox (already produced by the build).

**Keep the fixed `key` in the manifest.** It pins the extension ID to `jdemjjgkcelbkaacdfdbnnnifhoomhop`, which
is exactly what lets the desktop app recognize it and pair silently. Strip that key and the ID changes — pairing
still works, but only after the one-time in-app approval (like Firefox always does).

## How it's built

```
src/
  platform/   the only code that touches chrome.* (chromium.ts; firefox.ts when needed)
  core/       shared plumbing: settings, schema, DOM watcher, chat stream, Twitch APIs, auth, live, auto-open…
  features/   one small module per feature — { key, start() → stop() }
  ui/         top-bar button, settings panel (Preact, shadow DOM, lazy-loaded), popup
  page.ts     tiny MAIN-world bridge to Twitch's player (latency, quality, chatters, lurk mode)
  content.ts  registers features
  background.ts
```

Principles:

- **Lightweight first.** One shared, frame-coalesced DOM observer; one shared chat observer; CSS-only where possible;
  the settings panel and fonts load only when opened; nothing runs for a disabled feature.
- **Native feel.** On Twitch pages we borrow Twitch's own classes, colors and fonts; the brand (tonal dark,
  `#3CA0FF`, Exo 2 + Kode Mono) lives in the panel and popup. See [`docs/design.md`](docs/design.md).
- **Honest automation.** Auto-claim and drops only press buttons Twitch shows you; ad-mute never blocks ads;
  no channel-hopping farms.
- **Resilient.** Hook diagnostics show when a Twitch redesign breaks a selector; orphaned scripts shut down
  quietly after an extension reload.

## Privacy

Everything stays in your browser. Settings sync via your browser account (`storage.sync`); your Twitch token, watch
time and caches are device-local. Network calls go only to Twitch (`gql.twitch.tv`, `api.twitch.tv`, `id.twitch.tv`)
— plus image hosts only if you enable chat image previews.

## Credits

Visual and feature inspiration from [Enhancer](https://github.com/enhancer-app/enhancer) (MIT) and
[Twitch Lurker](https://github.com/mikeyaworski/Twitch-Lurker); all code here is original.
Icons: [Phosphor](https://phosphoricons.com) (MIT). Fonts: Exo 2, Kode Mono (OFL).

Forged by the same sleep-deprived cat as the rest of the family — runs on caffeine and validation. nyaa~
