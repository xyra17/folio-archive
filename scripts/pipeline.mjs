import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import electron from "electron";
const data =
  process.env.FOLIO_DATA_DIR || path.resolve(".test-output/pipeline");
await fs.mkdir(data, { recursive: true });
await fs.rm(path.join(data, "pipeline-result.json"), { force: true });
const child = spawn(
  process.env.FOLIO_EXECUTABLE || electron,
  process.env.FOLIO_EXECUTABLE ? [] : ["."],
  {
    stdio: "inherit",
    env: { ...process.env, FOLIO_PIPELINE_E2E: "1", FOLIO_DATA_DIR: data },
  },
);
const timer = setTimeout(() => {
  child.kill("SIGTERM");
  console.error("整套资料验收超过 6 分钟");
}, 360000);
child.on("exit", async (code) => {
  clearTimeout(timer);
  try {
    const r = JSON.parse(
      await fs.readFile(path.join(data, "pipeline-result.json"), "utf8"),
    );
    process.exit(code === 0 && r.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
});
