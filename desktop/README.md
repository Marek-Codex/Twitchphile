# Twitchphile (desktop)

**Your favorites, the moment they go live — on your desktop. nyaa~**

The Twitchphile desktop companion: a slim WinUI 3 window you keep at the edge of the screen, plus a tray icon that
keeps watching when it's closed. The well-behaved half of the family — no ad blocking, no funny business — just your
follows, the second they're live.

- **Live** — favorites that are live right now. Click a card to watch inline (Twitch's official embed player);
  collapse it and the player is gone. Links to the channel, pop-out chat and VODs.
- **Following** — everyone you follow, live first (or A–Z, or recently followed). Star anyone, live or not.
- **Notifications** — Windows toasts with a Watch button when a favorite goes live. Optionally *urgent*:
  Windows lets urgent notifications through Do Not Disturb for apps you allow (Settings → System → Notifications).
- **Browser extension** — pairs over loopback and keeps favorites in sync both ways (see below).

## Project layout

Family layout (like Stretto):

| Project | What |
|---|---|
| `Twitchphile.Core` | No UI: device-code Twitch sign-in, Helix client, favorites store, live watcher, pairing listener |
| `Twitchphile.Tests` | Plain console runner, no packages: `dotnet run --project Twitchphile.Tests` |
| `Twitchphile.App` | WinUI 3 shell, tray icon, notifications, settings |

```
dotnet build Twitchphile.slnx
dotnet run --project Twitchphile.Tests
```

`Twitchphile.App` ships the built browser extension next to the exe (`extension\`), so Load unpacked has a stable
folder — build the extension first (`cd ../extension && npm run build`).

Data lives in `%LocalAppData%\PlexusTwitchphile`: `favorites.json`, `settings.json`, and the Twitch session and
pairing token encrypted with DPAPI (`session.bin`, `pairing.bin`).

## Installable build (MSIX) vs. plain build

The app builds two ways from the same project, and the browser extension pairs with **either** — so a user can
run the loose exe, install the package, or use just the extension on its own; they all share favorites over the
loopback listener.

- **Plain build (default):** `dotnet build` produces a runnable unpackaged exe. Fast, no certificate, and what CI
  runs. At runtime the app has no package identity, so it registers the `twitchphile:` protocol and
  "start with Windows" through the registry (`PackageInfo.IsPackaged` is false).
- **Installable build:** add `-p:GenerateAppxPackageOnBuild=true` to also emit an `.msix` under
  `AppPackages\`. Installed, the app *has* package identity, so the protocol and "start with Windows" come from
  `Package.appxmanifest` (a `StartupTask`) instead — the same code picks the right path at runtime.

```powershell
# Unsigned package — enough to validate the manifest and layout.
dotnet build Twitchphile.App -c Release -p:GenerateAppxPackageOnBuild=true

# Signed, installable package. The signing cert must be in the current user's store (by thumbprint) or passed
# as a .pfx. Publisher "CN=MarekCodex" in Package.appxmanifest must match the certificate's subject exactly.
dotnet build Twitchphile.App -c Release -p:GenerateAppxPackageOnBuild=true `
  -p:AppxPackageSigningEnabled=true -p:PackageCertificateThumbprint=<thumbprint>
```

The manifest declares the `twitchphile:` protocol, a go-live-toast activator (so notifications work when the app
is installed from the package — they're a no-op in the plain build), the `StartupTask`, and `runFullTrust`.

> Note: packaging pulls in `System.Security.Permissions`, which the .NET 10 SDK's MSIX task host can't otherwise
> resolve — the `CopySspNextToMsixPackagingTask` target in the csproj handles that automatically, only when
> packaging, so the plain build never touches it.


## Sign-in

Twitch's device-code flow: the app shows a short code and opens twitch.tv/activate with it pre-filled; you
authorize once and the session refreshes itself. It uses the same public "Phile by MarekCodex" Twitch app as the
extension, and only asks for `user:read:follows`.

## Pairing with the extension

Same pattern as Stretto's handoff listener: a raw loopback `TcpListener` on **127.0.0.1:9616** (Stretto is 9615).

1. The extension (panel → Sync & data → Desktop app → **Pair**) calls `POST /pair`.
2. The app asks you to allow it; approving issues a random token, stored encrypted on both sides.
3. Every other call must carry `x-twitchphile-token`. Web-page origins are refused outright; only
   `chrome-extension://` origins get CORS access.

favorites and hidden channels sync per channel: each addition or removal has its own timestamp, so unrelated
edits on both sides merge. `PUT /favorites` sends the extension's changes and the app answers with the merged
list. Older clients can still send a whole-list timestamp. The extension syncs on every change and live check.

## Icon

Source artwork: `Twitchphile.App/Assets/twitchphile-icon-source-v2.png`, exported to `twitchphile-icon.png` (title bar)
and the multi-size `twitchphile.ico` (exe, taskbar, tray), per the Plexus icon asset convention. The extension ships
the same mark at 16–256 px in `extension/public/icons`.
