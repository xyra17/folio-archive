import { spawn } from "node:child_process";
import { build } from "esbuild";
import { createServer } from "vite";
const server = await createServer();
await server.listen();
await build({
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.cjs",
  bundle: true,
  platform: "node",
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
const child = spawn("node_modules/.bin/electron", ["."], {
  stdio: "inherit",
  env: { ...process.env, FOLIO_DEV_URL: "http://127.0.0.1:5173" },
});
const close = () => {
  child.kill();
  void server.close();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
