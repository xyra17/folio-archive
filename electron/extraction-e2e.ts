import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Engine } from "./engine";
import type { Store } from "./store";
import { SourceBrowser } from "./browser";
import { parseSnapshot, EXTRACTION_VERSION } from "./extract";
import { defaults, wait } from "./core";
import { PDFLayout } from "./pdf-layout";

const prose =
  "正文讨论如何保存网页内容，保留完整段落、代码、列表与图片，同时排除页面工具。".repeat(
    12,
  );
const content = `<h1>采集回归正文</h1><p>${prose}</p><h2>核心流程</h2>
<ul><li></li><li>&nbsp;<br></li><li><button>图标工具</button></li><li><strong>真实列表项</strong></li></ul>
<div class="concealed"><h2>CSS-HIDDEN-NOISE</h2><p>应排除的隐藏辅助内容</p></div>
<pre><code class="language-js">const shortcut = "Press Esc";\n  keepIndent();</code></pre>
<p style="position:relative;top:1200px">OFFSCREEN-PROSE</p><p>正文结束标记-END</p>`;

export async function runExtractionE2E(store: Store, engine: Engine) {
  let requests = 0;
  let unavailable = false;
  const server = createServer((req, res) => {
    requests++;
    if (unavailable) {
      req.socket.destroy();
      return;
    }
    const mode = req.url?.slice(1) || "main";
    const body =
      mode === "body"
        ? content
        : mode === "virtual"
          ? `<div class="docx-body"><div data-block-id="hidden" data-block-type="text" class="concealed">VIRTUAL-HIDDEN</div><div data-block-id="one" data-block-type="text">${prose}</div><div data-block-id="empty" data-block-type="bullet"><br></div><div data-block-id="item" data-block-type="bullet">真实列表项</div></div>`
          : mode === "lesson"
            ? `<main><h1>Keyboard shortcuts</h1><p>${prose}</p><p>Press Esc to hide this help</p></main>`
            : `<main>${content}</main>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><title>采集回归正文</title><style>.concealed{display:none}#mdbook-help-container{display:none}</style></head><body>
<div id="mdbook-help-container"><h2>Keyboard shortcuts</h2><p>Press Esc to hide this help</p></div>
<div class="concealed"><h2>OUTSIDE-HIDDEN</h2></div><header class="menu-bar"><h1 class="menu-title">菜单标题</h1></header>
<div role="toolbar"><ul><li><button>工具</button></li></ul></div><div role="menu"><p>MENU-NOISE</p></div>${body}</body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const browser = new SourceBrowser();
  const checks: string[] = [];
  const until = async (check: () => boolean) => {
    const end = Date.now() + 60000;
    while (!check()) {
      assert(Date.now() < end, "采集回归等待超时");
      await wait(100);
    }
  };
  try {
    for (const mode of ["main", "body", "virtual", "lesson"]) {
      const snapshot = await browser.inspect(`${base}/${mode}`);
      assert.equal(snapshot.extractionVersion, EXTRACTION_VERSION);
      const parsed = parseSnapshot(snapshot, "c", defaults);
      const text = parsed.blocks.map((b) => b.text).join("\n");
      assert(
        !/CSS-HIDDEN-NOISE|OUTSIDE-HIDDEN|VIRTUAL-HIDDEN|MENU-NOISE|菜单标题/.test(
          text,
        ),
      );
      if (mode === "lesson") {
        assert(text.includes("Keyboard shortcuts"));
        assert(text.includes("Press Esc to hide this help"));
      } else {
        assert(!text.includes("Keyboard shortcuts"));
        assert(!text.includes("Press Esc to hide this help"));
        assert.deepEqual(
          parsed.blocks
            .filter((b) => b.type === "list")
            .flatMap((b) => b.items),
          [mode === "virtual" ? "真实列表项" : "<strong>真实列表项</strong>"],
        );
        if (mode !== "virtual") {
          assert(text.includes("OFFSCREEN-PROSE"));
          assert(text.includes("正文结束标记-END"));
          assert.equal(
            parsed.blocks.find((b) => b.type === "code")?.text,
            'const shortcut = "Press Esc";\n  keepIndent();',
          );
        }
      }
      checks.push(mode);
    }
    const [id] = await engine.create([`${base}/main`]);
    const job = store.get(id);
    await until(() => job.status !== "inspecting");
    assert.equal(job.status, "ready");
    engine.start(id, { formats: ["pdf", "html", "md", "docx"] });
    await until(() => !engine.busy(id));
    assert.equal(job.status, "completed", JSON.stringify(job.issues));
    const html = await fs.readFile(
      job.exports.find((f) => f.format === "html")!.path,
      "utf8",
    );
    const $ = cheerio.load(html);
    assert.equal($(".chapter li").length, 1);
    assert.equal($(".contents").next().attr("id"), "article");
    assert(!$("body").text().includes("保存于"));
    const pdf = new PDFLayout();
    try {
      await pdf.load(job.exports.find((f) => f.format === "pdf")!.path);
      const text = (await pdf.text()).normalize("NFKC");
      assert(!/Keyboard shortcuts|保存于|CSS-HIDDEN-NOISE|菜单标题/.test(text));
      assert(text.replace(/\s/g, "").includes("正文结束标记-END"));
      await fs.writeFile(
        path.join(store.root, "clean-export-first-page.png"),
        await pdf.page(1),
      );
    } finally {
      pdf.close();
    }
    const chapter = job.chapters[0];
    const oldPath = chapter.evidencePath!;
    const oldSnapshot = JSON.parse(await fs.readFile(oldPath, "utf8"));
    delete oldSnapshot.extractionVersion;
    oldSnapshot.pieces.unshift({
      id: "stale",
      text: "STALE-CHECKPOINT-NOISE",
      html: "<p>STALE-CHECKPOINT-NOISE</p>",
    });
    await fs.writeFile(oldPath, JSON.stringify(oldSnapshot));
    const before = requests;
    await engine.action(id, "reexport");
    await until(() => !engine.busy(id));
    assert.equal(job.status, "completed");
    assert.notEqual(chapter.evidencePath, oldPath);
    assert(requests > before);
    assert(
      !chapter.blocks.some((b) => b.text.includes("STALE-CHECKPOINT-NOISE")),
    );
    assert(
      job.events.some((event) =>
        event.message.includes("旧快照需要按新规则重新采集"),
      ),
    );
    const latestPath = chapter.evidencePath!;
    const stale = JSON.parse(await fs.readFile(latestPath, "utf8"));
    delete stale.extractionVersion;
    await fs.writeFile(latestPath, JSON.stringify(stale));
    const pdfFile = job.exports.find((f) => f.format === "pdf")!.path;
    const previousPDF = await fs.readFile(pdfFile);
    unavailable = true;
    await engine.action(id, "reexport");
    await until(() => !engine.busy(id));
    assert.equal(job.status, "failed");
    assert(job.error?.includes("旧快照需要重新采集"));
    assert.deepEqual(await fs.readFile(pdfFile), previousPDF);
    return {
      cases: checks,
      formats: ["pdf", "html", "md", "docx"],
      oldCheckpointRecollected: true,
      unavailableOldCheckpointBlocksExport: true,
      paidCalls: job.coverage.calls,
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
