// Subsets the bundled fonts to the characters the UI actually uses (keeps Exo 2's weight axis).
// Usage: node scripts/fonts.mjs   (sources come from the @fontsource packages in node_modules)
import subsetFont from "subset-font";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
const EXTRA = "·–—→←×…▲▼■’‘“”•°√✓×";
const text = ASCII + EXTRA;

const jobs = [
  ["node_modules/@fontsource-variable/exo-2/files/exo-2-latin-wght-normal.woff2", "public/fonts/exo2.woff2"],
  ["node_modules/@fontsource/kode-mono/files/kode-mono-latin-500-normal.woff2", "public/fonts/kodemono.woff2"],
];
for (const [src, dest] of jobs) {
  const input = readFileSync(src);
  const out = await subsetFont(input, text, { targetFormat: "woff2" });
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, out);
  console.log(`${dest}: ${(input.length / 1024).toFixed(1)} KB → ${(out.length / 1024).toFixed(1)} KB`);
}
