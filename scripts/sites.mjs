import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import electron from "electron";
const cases = JSON.parse(await fs.readFile("tests/sites.json", "utf8"));
const data = process.env.FOLIO_DATA_DIR || path.resolve(".test-output/sites");
await fs.mkdir(data, { recursive: true });
await fs.rm(path.join(data, "live-result.json"), { force: true });
const child = spawn(
  process.env.FOLIO_EXECUTABLE || electron,
  process.env.FOLIO_EXECUTABLE ? [] : ["."],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      FOLIO_DATA_DIR: data,
      FOLIO_LIVE: "1",
      FOLIO_SMOKE_STEPS: "160",
      FOLIO_SMOKE_URLS: JSON.stringify(cases.map((c) => c.url)),
      FOLIO_SMOKE_CASES: JSON.stringify(cases),
    },
  },
);
const timer = setTimeout(() => {
  child.kill("SIGTERM");
  console.error("站点测试超过 12 分钟");
}, 720000);
child.on("exit", async (code) => {
  clearTimeout(timer);
  try {
    const result = JSON.parse(
      await fs.readFile(path.join(data, "live-result.json"), "utf8"),
    );
    const failed = result.filter((r) => !r.checks?.passed);
    console.log(
      `站点验证 ${result.length - failed.length}/${cases.length} 通过`,
    );
    for (const r of failed)
      console.log(
        `${r.name}: ${r.status}; ${JSON.stringify(r.checks?.failures || [r.error])}`,
      );
    process.exit(
      code === 0 && result.length === cases.length && !failed.length ? 0 : 1,
    );
  } catch (e) {
    console.error("没有完整站点测试结果", e.message);
    process.exit(1);
  }
});
