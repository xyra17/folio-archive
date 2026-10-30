import { build } from "esbuild";
await build({
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  packages: "external",
  sourcemap: true,
});
await build({
  entryPoints: ["electron/preload.ts"],
  outfile: "dist-electron/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});

import fs from "node:fs/promises";
for (const name of ["cmaps", "standard_fonts", "wasm"])
  await fs.cp(`node_modules/pdfjs-dist/${name}`, `dist/pdf-assets/${name}`, {
    recursive: true,
  });

await import("./notices.mjs");
