# Twitchphile Design Sheet

Structure distilled from studying Enhancer's UI (MIT; reference only, no code reused),
identity from the Codex Plexus brand (MarekCodex).

## Principles
- Native first: on twitch.tv surfaces, inherit Twitch fonts/surfaces; brand is a thin accent.
- Tonal dark: near-black stepped surfaces, separation by 1px borders, not shadows.
- Dense & quiet: small type (11–14px), tight gaps (4–12px), fast transitions (150ms).
- Data reads as telemetry: numbers in mono.
- Glass only on floating elements (OSD, popovers, popup header), blur ≤ 10px.

## Structure (observed in Enhancer)
| Aspect | Pattern |
|---|---|
| Surfaces | ~5 stepped grays, 1–2% apart (#0d → #12), borders slightly lighter (#1e/#26) |
| Text | 7-step ramp from white to faint (#fff → #565656) |
| Radius | 4px controls, 8px cards/panels, 50% avatars/dots |
| Spacing | 8px default gap; 12×16 panel padding; 7×14 buttons |
| Type sizes | 11 / 12 / 13 / 14px body, 16–18px headings |
| Motion | `0.15s ease` for hover/color, `0.2s` for layout |
| Elevation | only floating: `0 4px 16px rgba(0,0,0,.3)` + `blur(8px)` |
| Light mode | full token mirror under `prefers-color-scheme: light` |

## Tokens (ours)
```css
:root {
  /* surfaces — tonal, blue-tinted */
  --tp-bg:        #0A0D12;
  --tp-surface:   #0F131A;
  --tp-raised:    #141A23;
  --tp-control:   #0C1016;
  --tp-hover:     #19212C;
  --tp-border:    #1C2531;
  --tp-border-hi: #26344A;

  /* text ramp */
  --tp-text-1: #F2F7FF;
  --tp-text-2: #D7E3F4;
  --tp-text-3: #A3B1C6;
  --tp-text-4: #7C8BA1;
  --tp-text-5: #56637A;

  /* brand */
  --tp-accent:      #3CA0FF;
  --tp-accent-hi:   #6BB8FF;
  --tp-accent-dim:  rgba(60,160,255,.14);
  --tp-accent-glow: rgba(60,160,255,.35);
  --tp-danger:      #FF4D5E;
  --tp-live:        #47D7B2;  /* mint: live rings, live dots, live counts — in both apps */

  /* shape & motion */
  --tp-r-sm: 4px;  --tp-r-md: 8px;
  --tp-gap: 8px;
  --tp-fast: .15s ease;

  /* type */
  --tp-font:      "Exo 2", system-ui, sans-serif;  /* extension pages */
  --tp-font-mono: "Kode Mono", ui-monospace, monospace;    /* data / labels */
  --tp-font-mark: "Aldrich", var(--tp-font);               /* wordmark only */
}
```
On twitch.tv, injected UI uses `var(--font-base)` and Twitch's own color vars;
only `--tp-accent` is carried over.

## Brand intensity by surface
| Surface | Intensity | Treatment |
|---|---|---|
| Popup / options | High | tonal dark, mono uppercase section labels `[ PLAYER ]`, LED-dot toggles, faint 3% noise |
| OSD over video | Medium | glass chip, mono numerals, accent edge |
| Injected into Twitch UI | Low | Twitch styling + 2px accent tick/dot as signature |

## Fonts
Bundled locally as latin-subset woff2 (no remote fonts in extension pages).
Exo 2 (UI), Kode Mono (data), Aldrich (wordmark, later).

## Icons
Phosphor Icons (MIT, phosphoricons.com), **bold** weight to match Twitch's icon heft at 14px.
Only the icons listed in `scripts/icons.mjs` are inlined into `src/ui/icons.ts` — regenerate with `node scripts/icons.mjs`.
