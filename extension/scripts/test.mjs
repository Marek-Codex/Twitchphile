// Bundles each test/*.test.ts with "@platform" → test/fake-platform.ts, then runs Node's built-in test runner.
// No test framework dependency: esbuild (already a dev dep) + node:test.
import * as esbuild from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const out = ".test-dist";
rmSync(out, { recursive: true, force: true });
const tests = readdirSync("test").filter((f) => f.endsWith(".test.ts"));

await esbuild.build({
  entryPoints: tests.map((f) => `test/${f}`),
  outdir: out,
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
  logLevel: "error",
  plugins: [
    {
      name: "fake-platform",
      setup(b) {
        b.onResolve({ filter: /^@platform$/ }, () => ({ path: resolve("test/fake-platform.ts") }));
      },
    },
  ],
});

const run = spawnSync(process.execPath, ["--test", ...tests.map((f) => `${out}/${f.replace(/\.ts$/, ".mjs")}`)], { stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
process.exit(run.status ?? 1);
