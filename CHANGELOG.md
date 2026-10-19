# Changelog

All notable changes to Twitchphile are documented here.

## [0.4.0]

### Added
- MIT license, EditorConfig, and GitHub Actions CI
- Kick follows now appear in the Following lists (extension popup + desktop app), not just when live
- `npm run icons` / `npm run fonts` / `npm run prepare` scripts so a fresh clone builds out of the box
- **Installable desktop app (single-project MSIX):** `Package.appxmanifest` plus a `-p:GenerateAppxPackageOnBuild=true` build path emits a signed, installable `.msix`. The plain `dotnet build` still produces the unpackaged exe, and the same binary works either way — the app detects package identity at runtime (`PackageInfo`) and uses the manifest's `twitchphile:` protocol and `StartupTask` when installed, or the registry when run loose. The browser extension pairs with both.

### Changed
- Bumped `typescript` to `^5.8.0` and `esbuild` to `^0.25.0` (previous versions did not exist)
- Removed redundant MSBuild `<Content>` include for `dist/chromium` — `extension/build.mjs` is the single source of truth for copying the extension beside the desktop app
- Desktop app version aligned to `0.4.0`; "Start with Windows" now uses a `StartupTask` when packaged (the Run key can't target a packaged exe)
- Spelling pass to American English throughout (color, favorite, canceled, theater, etc.). The `favourites`/`pinFavourites` settings keys, the `greyscale` key, and the desktop `favourites.json` file were renamed to their American spellings, with automatic migrations on both sides so existing installs keep their data

### Fixed
- `screenshot.ts` imported `pip` icon that didn't exist — added `picture-in-picture` to the Phosphor icon manifest
- Duplicate `scripts` key in `extension/package.json`
- MSIX packaging on the .NET 10 SDK: the task host can't resolve `System.Security.Permissions`, so a csproj target copies it next to the packaging task automatically (packaging builds only — the plain build is untouched)


## [0.3.0]

### Added
- Kick live-tracking in background (public channel data, no sign-in needed)
- Drop progress sync from extension to desktop app
- Prime sub reminder (30-day cycle)
- Auto-open with rotation, raid handling, and dismiss-on-close
- Channel stats drawer (Twitch + Kick) with history heatmaps, hours-per-week, top clips
- Backup / restore (settings, watch time, claims, per-channel prefs)
- Presets (Clean, Lurker, Chatter, Stats, Everything) with Undo
- Desktop app: WinUI 3 window, tray icon, inline WebView2 player, urgent notifications, URL scheme (`twitchphile://`)
- Extension ↔ desktop pairing over loopback (127.0.0.1:9616), shared sign-in, per-channel favorites/hidden merge
- Firefox build (packed .xpi)
