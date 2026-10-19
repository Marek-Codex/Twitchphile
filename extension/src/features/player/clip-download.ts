// Download button on clip pages (clips.twitch.tv/<slug> and twitch.tv/<channel>/clip/<slug>).
import { platform } from "@platform";
import { onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import { toast } from "../../core/toast";
import { addPlayerButton, clipSlug } from "../../core/twitch";
import { download as downloadIcon, svg } from "../../ui/icons";

const ID = "tp-clip-dl";

async function download(e: MouseEvent) {
  const res = await platform.send<{ ok: boolean; error?: string }>({ type: "clip:download", slug: clipSlug() });
  toast(res?.ok ? "Downloading clip…" : (res?.error ?? "Download failed"), e.clientX, e.clientY);
}

export const clipDownload: Feature = {
  key: "clipDownload",
  start() {
    const stopDom = onDom(() => {
      if (clipSlug()) addPlayerButton(ID, "Download clip", svg(downloadIcon, 20), download);
      else document.getElementById(ID)?.remove();
    });
    return () => (stopDom(), document.getElementById(ID)?.remove());
  },
};
