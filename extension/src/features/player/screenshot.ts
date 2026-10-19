// Screenshot: a player-bar button (and Alt+S) that saves the current frame as PNG.
import { onDom } from "../../core/dom";
import type { Feature } from "../../core/feature";
import { addPlayerButton, channelLogin, video } from "../../core/twitch";
import { camera, pip, svg } from "../../ui/icons";
import { togglePip } from "./hotkeys";
import { osd } from "./osd";

const ID = "tp-screenshot";

export function capture() {
  const v = video();
  if (!v?.videoWidth) return osd("No frame yet");
  const canvas = document.createElement("canvas");
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext("2d")!.drawImage(v, 0, 0);
  canvas.toBlob((blob) => {
    if (!blob) return osd("Capture failed");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${channelLogin() || "twitch"}-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    osd("Frame captured");
  }, "image/png");
}

export const screenshotButton: Feature = {
  key: "screenshotButton",
  start() {
    const stop = onDom(() => addPlayerButton(ID, "Screenshot (Alt+S)", svg(camera, 20), capture));
    return () => (stop(), document.getElementById(ID)?.remove());
  },
};

export const pipButton: Feature = {
  key: "pipButton",
  start() {
    const stop = onDom(() => addPlayerButton("tp-pip", "Picture-in-picture (Alt+P)", svg(pip, 20), togglePip));
    return () => (stop(), document.getElementById("tp-pip")?.remove());
  },
};
