import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import electron from "electron";
const urls = process.argv.slice(2);
if (!urls.length) throw new Error("传入已授权访问的来源链接");
const data = process.env.FOLIO_DATA_DIR || path.resolve(".test-output/live");
await fs.mkdir(data, { recursive: true });
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: {
    ...process.env,
    FOLIO_LIVE: "1",
    FOLIO_SMOKE_URLS: JSON.stringify(urls),
    FOLIO_DATA_DIR: data,
  },
});
child.on("exit", (c) => process.exit(c ?? 1));
