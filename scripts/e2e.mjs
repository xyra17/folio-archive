import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import electron from "electron";
const data = process.env.FOLIO_DATA_DIR || path.resolve(".test-output/e2e");
await fs.mkdir(data, { recursive: true });
await fs.rm(path.join(data, "e2e-result.json"), { force: true });
const child = spawn(
  process.env.FOLIO_EXECUTABLE || electron,
  process.env.FOLIO_EXECUTABLE ? [] : ["."],
  {
    stdio: "inherit",
    env: { ...process.env, FOLIO_E2E: "1", FOLIO_DATA_DIR: data },
  },
);
const timer = setTimeout(() => {
  child.kill("SIGTERM");
  console.error("Electron 测试超过 180 秒");
}, 180000);
child.on("exit", async (code) => {
  clearTimeout(timer);
  try {
    const result = JSON.parse(
      await fs.readFile(path.join(data, "e2e-result.json"), "utf8"),
    );
    process.exit(code === 0 && result.ok === true ? 0 : 1);
  } catch {
    console.error("Electron 退出但没有生成完整验收结果");
    process.exit(1);
  }
});
