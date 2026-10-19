<div align="center">

# Twitchphile

**Be there for every stream you care about — in your browser or on your desktop. nyaa~**

![README visits](https://count.getloli.com/@marek-codex.twitchphile?theme=booru-lewd)

![Manifest](https://img.shields.io/badge/Manifest-V3-3CA0FF?style=flat-square)
![Chromium](https://img.shields.io/badge/Chromium-Brave%20%7C%20Chrome%20%7C%20Edge%20%7C%20Opera-07111C?style=flat-square&logo=googlechrome&logoColor=white)
![Firefox](https://img.shields.io/badge/Firefox-115%2B-A03CFF?style=flat-square&logo=firefox&logoColor=white)
![Desktop](https://img.shields.io/badge/Desktop-.NET%2010%20%7C%20WinUI%203-512BD4?style=flat-square&logo=dotnet&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-A03CFF?style=flat-square)

</div>

A quality-of-life suite for people who watch a *lot* of Twitch — and the odd Kick
channel too. favorites that follow you everywhere, the moment someone goes live, a
browse page that stops shouting at you, per-channel stats, calmer chat, and a desktop
companion that lives quietly in your tray. It's the well-behaved one in the family:
no ad blocking, no paywall tricks, nothing funny — just Twitch, nicer.

**Two halves, one product.** A browser extension and a .NET desktop app that pair over
a loopback socket (port **9616**) and keep your favorites in sync. Use one, the other,
or both — each is perfectly happy on its own.

| Folder | What | Stack |
|---|---|---|
| [`extension/`](extension/) | Player tweaks, chat tools, stream stats, lurking QoL, favorites, browse declutter | TypeScript, MV3, esbuild, Preact |
| [`desktop/`](desktop/) | Tray companion: favorites the moment they're live, notifications, pop-out stats & chat | .NET 10, WinUI 3 |

Both speak the same design language ([`docs/design.md`](docs/design.md)) — one palette
(`#3CA0FF` blue, `#0C2745` navy, `#47D7B2` mint) and one icon family, browser to desktop.

## Why it exists

Watching Twitch shouldn't mean fighting the interface. Every feature here is something
Twitch could ship tomorrow and we'd cheer — it reads what your own signed-in session can
already see, runs entirely on your machine, and sends nothing home. That's the whole
philosophy, in one breath: make the site you already use feel like it was built for you.

## The two halves

- **Extension** — load unpacked (Chromium) or the `.xpi` (Firefox). Full details in
  [`extension/README.md`](extension/README.md).
- **Desktop app** — `dotnet build`, or package it as an installable `.msix`. Details in
  [`desktop/README.md`](desktop/README.md).

**Pair them once:** extension → *Sync & data → Desktop app → Pair*, approve it in the app,
and favorites sync both ways forever after. Star someone in either place; it shows up in
both. (They also work completely independently if you only ever want one.)

## For maintainers

CI builds and tests both halves on every push to `main` — `dotnet build`/`test` for the
desktop, `tsc`/`npm test`/`npm run build` for the extension. Version and changelog are
shared across both.

## Support

Twitchphile is free and always will be. But if it decluttered your evening and you're
feeling generous, the sleep-deprived cat who forged it runs on caffeine and validation:

[![Ko-fi](https://img.shields.io/badge/Support_me_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/MarekCodex)

No pressure — go watch your streams. nyaa~

