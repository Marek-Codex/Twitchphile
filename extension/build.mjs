// Usage: node build.mjs <target> [--watch]
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, statSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const target = process.argv[2] ?? "chromium";
const watch = process.argv.includes("--watch");
const out = `dist/${target}`;

// "@platform" → the target's browser layer (src/platform/<target>.ts).
const platformAlias = {
  name: "platform",
  setup(b) {
    b.onResolve({ filter: /^@platform$/ }, () => ({ path: resolve(`src/platform/${target}.ts`) }));
  },
};

// `import css from "./x.css"` → the file's text, minified (it's injected into a shadow root at runtime).
const cssText = {
  name: "css-text",
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async (args) => {
      const { code } = await esbuild.transform(readFileSync(args.path, "utf8"), { loader: "css", minify: !watch });
      return { contents: code, loader: "text" };
    });
  },
};

function writeStatic() {
  const base = JSON.parse(readFileSync("manifests/base.json", "utf8"));
  const over = JSON.parse(readFileSync(`manifests/${target}.json`, "utf8"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  writeFileSync(`${out}/manifest.json`, JSON.stringify({ ...base, ...over, version: pkg.version }, null, 2));
  cpSync("src/ui/popup/index.html", `${out}/popup.html`);
  cpSync("src/ui/options.html", `${out}/options.html`);
  cpSync("public", out, { recursive: true });
}

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  target: "chrome120",
  jsx: "automatic",
  jsxImportSource: "preact",
  plugins: [platformAlias, cssText],
  logLevel: "info",
};

const builds = [
  { ...common, entryPoints: { content: "src/content.ts" }, format: "iife", outdir: out },
  { ...common, entryPoints: { page: "src/page.ts" }, format: "iife", outdir: out },
  { ...common, entryPoints: { sniff: "src/sniff.ts" }, format: "iife", outdir: out },
  { ...common, entryPoints: { background: "src/background.ts" }, format: "esm", outdir: out },
  { ...common, entryPoints: { popup: "src/ui/popup/main.tsx" }, format: "esm", outdir: out },
  { ...common, entryPoints: { panel: "src/ui/panel/panel.tsx" }, format: "esm", outdir: out },
  { ...common, entryPoints: { options: "src/ui/options.ts" }, format: "esm", outdir: out },
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeStatic();

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  const size = (d) => readdirSync(d, { withFileTypes: true })
    .reduce((n, e) => n + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
  console.log(`\n${out}: ${(size(out) / 1024).toFixed(1)} KB total`);
  // The desktop app ships the extension beside its exe, and that copy is what the browser loads (the setup window
  // points there). Refresh it on every Chromium build, so a reload in the browser picks up the change without
  // rebuilding the app as well.
  if (target === "chromium") {
    // Allow overriding where the desktop app's output lives (TFM/RID can differ per machine).
    const appBase = process.env.TWITCHPHILE_APP_OUT ?? resolve("../desktop/Twitchphile.App/bin/x64");
    for (const config of ["Debug", "Release"]) {
      // Find the actual output folder: net10.0-windows10.0.26100.0/win-x64/extension (current SDK),
      // or win-x64/extension (older layouts), or TWITCHPHILE_APP_OUT if set.
      let app = null;
      for (const base of [process.env.TWITCHPHILE_APP_OUT, resolve(appBase, `${config}/net10.0-windows10.0.26100.0/win-x64`), resolve(appBase, `${config}/win-x64`)].filter(Boolean)) {
        const candidate = resolve(base, "extension");
        try { statSync(candidate); app = candidate; break; } catch {}
      }
      if (!app) continue; // that build of the app doesn't exist
      rmSync(app, { recursive: true, force: true });
      cpSync(out, app, { recursive: true });
      console.log(`→ ${app}`);
    }
  }
  // Firefox installs a packed .xpi (a zip with manifest.json at its root). Windows' tar writes zips with -a.
  if (target === "firefox") {
    const xpi = resolve("dist/twitchphile-firefox.xpi");
    rmSync(xpi, { force: true });
    // Windows' own bsdtar (Git's GNU tar on PATH can't write zips), given the entries so no shell globbing is needed.
    const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    execFileSync(tar, ["-a", "-cf", xpi, ...readdirSync(out)], { cwd: out });
    console.log(`${xpi}`);
  }
}
