// Firefox (128+) runs the Chromium layer unchanged: its MV3 `chrome` namespace is promise-based and has every API
// Twitchphile uses. Differences live in manifests/firefox.json (background scripts, add-on id), not here.
export { platform } from "./chromium";
