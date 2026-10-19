// Entry for options.html: the settings panel as its own page (see openStandalone in panel/panel.tsx).
// Loads the same panel.js the Twitch page uses, rather than bundling a second copy of it.
import { platform } from "@platform";

type PanelModule = { openStandalone(): Promise<void> };
(import(platform.url("panel.js")) as Promise<PanelModule>).then((m) => m.openStandalone());
