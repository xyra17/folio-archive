import { createServer } from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { app, nativeImage, type BrowserWindow } from "electron";
import type { Store } from "./store";
import type { Engine } from "./engine";
import type { Job } from "../shared/types";
import { wait, uid } from "./core";
import { PDFLayout } from "./pdf-layout";
import JSZip from "jszip";
import * as cheerio from "cheerio";
import { chapterTitle } from "../shared/chapters";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function runPipelineE2E(
  store: Store,
  engine: Engine,
  win: BrowserWindow,
) {
  const results: Record<string, unknown> = {};
  let extra = false;
  let allowMissing = false;
  const requests = new Map<string, number>();
  const bitmap = Buffer.alloc(600 * 3000 * 4, 255);
  for (let y = 0; y < 3000; y++)
    for (let x = 0; x < 600; x++) {
      const p = (y * 600 + x) * 4;
      bitmap[p] = Math.floor(y / 500) % 2 ? 70 : 160;
      bitmap[p + 1] = 150;
      bitmap[p + 2] = 100;
    }
  const longImage = nativeImage
    .createFromBitmap(bitmap, { width: 600, height: 3000 })
    .toPNG();
  const prose = (n: number) =>
    `这是第 ${n} 章，验证章节独立内容、原文顺序和正文完整性。`.repeat(18);
  const article = (n: number) =>
    `<h1>第${n}章</h1><p>${prose(n)}</p><h2>本章结束</h2><p>END-CHAPTER-${n} 这里是当前章节的最后一段正文。</p>`;
  const bookTitles = ["第 15 期：评测", "客服邮件分流", "SQL 问数"];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    requests.set(url.pathname, (requests.get(url.pathname) || 0) + 1);
    if (url.pathname === "/cancel-pending") {
      const timer = setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<article>${article(1)}</article>`);
      }, 30000);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    if (url.pathname === "/long.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(longImage);
      return;
    }
    if (url.pathname === "/missing/2" && !allowMissing) {
      res.writeHead(503);
      res.end("Unavailable");
      return;
    }
    let body = "";
    if (url.pathname.startsWith("/direct/")) {
      const n = Number(url.pathname.split("/").at(-1));
      body = `<nav data-chapter-list data-chapter-count="${extra ? 4 : 3}">${Array.from({ length: extra ? 4 : 3 }, (_, i) => `<a href="/direct/${i + 1}">第${i + 1}章</a>`).join("")}</nav><article>${article(n)}</article>`;
    } else if (url.pathname.startsWith("/mdbook/")) {
      const n = Number(url.pathname.split("/").at(-1));
      body = `<nav id="mdbook-sidebar"><mdbook-sidebar-scrollbox><ol class="chapter">${bookTitles.map((title, i) => `<li><a href="/mdbook/${i + 1}"><strong aria-hidden="true">${i + 15}.</strong>${title}<span aria-hidden="true" class="chapter-toggle">装饰</span></a></li>`).join("")}</ol></mdbook-sidebar-scrollbox></nav><article><h1>${bookTitles[n - 1]}</h1><p>${prose(n)}</p></article>`;
    } else if (url.pathname === "/virtual") {
      body = `<nav data-chapter-list data-chapter-count="5"><button aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.querySelector('#tree').hidden=false;render()">展开目录</button><div id="tree" hidden style="height:130px;overflow:auto"><div id="items" style="height:420px;position:relative"></div></div></nav><article id="article">${article(3)}</article><script>
      const tree=document.querySelector('#tree');function render(){const start=Math.floor(tree.scrollTop/70);document.querySelector('#items').innerHTML=Array.from({length:Math.min(3,5-start)},(_,i)=>{const n=start+i+1;return '<div class="section-link" data-chapter-id="'+n+'" style="position:absolute;top:'+((n-1)*70)+'px" onclick="loadChapter('+n+')">第'+n+'章</div>'}).join('')};tree.onscroll=render;
      function loadChapter(n){setTimeout(()=>{document.querySelector('#article').innerHTML='<h1>第'+n+'章</h1><p>'+('这是第 '+n+' 章，验证章节独立内容、原文顺序和正文完整性。').repeat(18)+'</p><p>END-CHAPTER-'+n+' 这是当前章节末尾。</p>';history.replaceState(null,'','?chapter='+n)},100)}
      </script>`;
    } else if (url.pathname.startsWith("/missing/")) {
      const n = Number(url.pathname.split("/").at(-1));
      body = `<nav data-chapter-list><a href="/missing/1">第1章</a><a href="/missing/2">第2章</a></nav><article>${article(n)}</article>`;
    } else if (url.pathname.startsWith("/duplicate/")) {
      const n = Number(url.pathname.split("/").at(-1));
      body = `<nav data-chapter-list><a href="/duplicate/1">第1章</a><a href="/duplicate/2">第2章</a></nav><article><h1>第${n}章</h1><p>${prose(1)}</p></article>`;
    } else if (url.pathname === "/layout") {
      body = `<article>${article(1)}<img src="/long.png" alt="完整长图"><table><thead><tr><th>列一</th><th>列二</th></tr></thead><tbody><tr><td>${"单元格完整文字。".repeat(180)}</td><td>${"cell-content-".repeat(150)}</td></tr></tbody></table><pre><code>${Array.from({ length: 100 }, (_, i) => `line_${i + 1} = '${"long_code_".repeat(5)}'`).join("\n")}</code></pre><p>FINAL-LAYOUT-END</p></article>`;
    } else if (url.pathname === "/truncated") {
      body = `<article>${article(1)}${Array.from({ length: 25 }, () => `<p>${prose(2)}</p>`).join("")}</article>`;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>整套资料测试</title><style>body{font:16px/1.8 system-ui;margin:24px}article{max-width:760px}nav a{display:block}img{max-width:100%}table{width:100%}</style><header><nav><a href="/not-a-chapter">站点菜单</a></nav></header>${body}`,
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const until = async (check: () => boolean) => {
    const end = Date.now() + 120000;
    while (!check()) {
      assert(Date.now() < end, "流程超时");
      await wait(100);
    }
  };
  const start = async (
    route: string,
    formats: Job["options"]["formats"] = ["pdf", "html"],
  ) => {
    const [id] = await engine.create([base + route], {
      formats,
      aiReview: false,
    });
    const job = store.get(id);
    await until(() => job.status !== "inspecting");
    assert.equal(job.status, "ready", job.error);
    engine.start(id);
    await until(() => !engine.busy(id));
    return job;
  };
  try {
    store.settings({
      outputRoot: path.join(store.root, "exports"),
      maxChapters: 50,
      maxScrollSteps: 100,
    });
    // Composer settings exercise renderer-only choices against isolated configuration.
    await wait(300);
    const initialJobCount = store.jobs.size;
    await fs.writeFile(
      path.join(store.root, "workbench-empty.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    assert(
      await win.webContents.executeJavaScript(`(() => {
      const form=document.querySelector('.composer').getBoundingClientRect(), recent=document.querySelector('.recent-section').getBoundingClientRect();
      return recent.top>=form.bottom && Math.abs(recent.left-form.left)<2 && Math.abs(recent.width-form.width)<2 && recent.height<130 && document.documentElement.scrollWidth<=innerWidth;
    })()`),
      "home follows save-first reading order with a compact empty history",
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.save-preferences > summary').click()",
    );
    await wait(100);
    const settingsLayout = async (name: string) => {
      await win.webContents.executeJavaScript(
        "document.querySelector('.preferences-content').scrollIntoView({block:'center'})",
      );
      await wait(120);
      const bounds = await win.webContents.executeJavaScript(`(() => {
        const group=document.querySelector('.preferences-content');
        const rows=[group.querySelector('.template-trigger'),group.querySelector('.ai-control'),group.querySelector('.content-scope')];
        return {noOverflow: group.scrollWidth<=group.clientWidth && document.documentElement.scrollWidth<=innerWidth,
          aligned: rows.every(e=>Math.abs(e.getBoundingClientRect().left-rows[0].getBoundingClientRect().left)<2),
          stacked: rows[1].getBoundingClientRect().top>=rows[0].getBoundingClientRect().bottom-1 && rows[2].getBoundingClientRect().top>=rows[1].getBoundingClientRect().bottom-1,
          controlsInside: [...group.querySelectorAll('button,input')].filter(e=>e.checkVisibility()).every(e=>{const r=e.getBoundingClientRect(),g=group.getBoundingClientRect();return r.left>=g.left && r.right<=g.right})};
      })()`);
      assert(
        bounds.noOverflow &&
          bounds.aligned &&
          bounds.stacked &&
          bounds.controlsInside,
        `${name}: settings layout clipped or misaligned`,
      );
      await fs.writeFile(
        path.join(store.root, `settings-${name}.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
    };
    win.setSize(1180, 820);
    await settingsLayout("desktop");
    // An unconfigured AI switch opens configuration without enabling a paid check.
    await win.webContents.executeJavaScript(
      "document.querySelector('.save-preferences .switch').click()",
    );
    await wait(100);
    assert(
      await win.webContents.executeJavaScript(
        "!!document.querySelector('.ai-settings') && document.querySelector('.save-preferences .switch').getAttribute('aria-checked')==='false'",
      ),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal [aria-label=关闭]').click()",
    );
    // Renderer state fixture only: no credentials, connection test or paid request.
    const originalConfig = { ...store.config };
    store.config = {
      ...store.config,
      modelEndpoint: base,
      model: "isolated-ui-fixture",
      hasApiKey: true,
    };
    store.onChange();
    await wait(100);
    await win.webContents.executeJavaScript(
      "document.querySelector('.save-preferences .switch').click()",
    );
    await wait(100);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.save-preferences .switch').getAttribute('aria-checked')==='true' && document.querySelector('.save-preferences .ai-expanded').innerText.includes('可能产生服务费用')",
      ),
    );
    win.setSize(860, 820);
    await settingsLayout("ai-enabled-narrow");
    await win.webContents.executeJavaScript(
      "document.querySelector('.save-preferences .switch').click()",
    );
    store.config = originalConfig;
    store.onChange();
    await wait(100);
    await win.webContents.executeJavaScript(
      "document.querySelector('.save-preferences .template-trigger').click()",
    );
    await wait(120);
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('.template-option')[1].click()",
    );
    await wait(80);
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal-actions .primary').click()",
    );
    await wait(100);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.save-preferences .template-copy strong').textContent.includes('书刊印刷')",
      ),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.save-preferences .template-trigger').click()",
    );
    await wait(100);
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('.template-option')[0].click()",
    );
    await wait(80);
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal-actions .primary').click()",
    );
    await wait(100);
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('.content-scope > summary').click();
      const input=document.querySelector('.content-scope .field input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'第二章');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await wait(80);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.scope-value').textContent==='已自定义'",
      ),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.content-scope .check-line input').click()",
    );
    await wait(80);
    await settingsLayout("scope-expanded-narrow");
    await win.webContents.executeJavaScript(
      "document.querySelector('.content-scope > summary').click();document.querySelector('.content-scope > summary').click()",
    );
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.content-scope .field input').value==='第二章' && document.querySelector('.content-scope .check-line input').checked",
      ),
    );
    await win.webContents.executeJavaScript(`(() => {
      const input=document.querySelector('.content-scope .field input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await wait(80);
    await win.webContents.executeJavaScript(
      "document.querySelector('.content-scope .check-line input').click()",
    );
    await wait(80);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.scope-value').textContent==='全文'",
      ),
    );
    assert.equal(
      store.jobs.size,
      initialJobCount,
      "settings must not start a save",
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.content-scope > summary').click();document.querySelector('.save-preferences > summary').click()",
    );
    win.setSize(1180, 820);
    results.savePreferencesLayoutAndInteractions = true;
    const direct = await start("/direct/3");
    assert.equal(direct.status, "completed", JSON.stringify(direct.issues));
    assert.deepEqual(
      direct.chapters.map((c) => c.title),
      ["第1章", "第2章", "第3章"],
    );
    assert.equal(direct.reconciliation!.verified, 3);
    assert.equal(direct.chapters[0].capture!.reachedEnd, true);
    const firstId = direct.chapters[0].id;
    extra = true;
    await engine.action(direct.id, "refresh");
    await until(() => !engine.busy(direct.id));
    assert.equal(direct.status, "completed", JSON.stringify(direct.issues));
    assert.equal(direct.chapters.length, 4);
    assert.equal(direct.chapters[0].id, firstId);
    assert.equal(direct.reconciliation!.lastChapter, "第4章");
    results.directoryOrderAndRefresh = true;
    const book = await start("/mdbook/2", ["pdf", "html", "docx", "md"]);
    assert.equal(book.status, "completed", JSON.stringify(book.issues));
    assert.deepEqual(
      book.chapters.map((c) => c.title),
      bookTitles,
    );
    assert.equal(book.reconciliation!.verified, 3);
    results.mdbookFullDirectory = true;
    assert.deepEqual(
      book.chapters.map((c) => c.sourceNumber),
      ["15.", "16.", "17."],
    );
    const numberedHTML = cheerio.load(
      await fs.readFile(
        book.exports.find((f) => f.format === "html")!.path,
        "utf8",
      ),
    );
    assert(
      numberedHTML(".chapter h2")
        .toArray()
        .some((h) => numberedHTML(h).text().includes("16. 客服邮件分流")),
    );
    assert.equal(numberedHTML(".toc-number").eq(1).text(), "16.");
    const numberedPDF = new PDFLayout();
    try {
      await numberedPDF.load(
        book.exports.find((f) => f.format === "pdf")!.path,
      );
      assert(
        (await numberedPDF.text())
          .replace(/\s+/g, "")
          .includes("16.客服邮件分流"),
      );
    } finally {
      numberedPDF.close();
    }
    const word = await JSZip.loadAsync(
      await fs.readFile(book.exports.find((f) => f.format === "docx")!.path),
    );
    assert(
      (await word.file("word/document.xml")!.async("string")).includes(
        "16. 客服邮件分流",
      ),
    );
    assert(
      (
        await fs.readFile(
          book.exports.find((f) => f.format === "md")!.path,
          "utf8",
        )
      ).includes("## 16. 客服邮件分流"),
    );
    // Re-identification upgrades old metadata without starting or discarding selection.
    book.chapters.forEach((c) => {
      c.sourceNumber = undefined;
      c.selected = c.title === "客服邮件分流";
    });
    await win.webContents.executeJavaScript(
      `window.archive.action(${JSON.stringify(book.id)}, "rediscover")`,
    );
    assert.equal(book.status, "ready");
    assert.equal(engine.busy(book.id), false);
    assert.equal(book.chapters.filter((c) => c.selected).length, 1);
    assert.equal(
      chapterTitle(book.chapters.find((c) => c.selected)!),
      "16. 客服邮件分流",
    );
    results.sourceNumberingAcrossFormatsAndRediscovery = true;
    const virtual = await start("/virtual");
    assert.equal(virtual.status, "completed", JSON.stringify(virtual.issues));
    assert.deepEqual(
      virtual.chapters.map((c) => c.title),
      ["第1章", "第2章", "第3章", "第4章", "第5章"],
    );
    for (let i = 0; i < 5; i++)
      assert(
        virtual.chapters[i].blocks.some((b) =>
          b.text.includes(`END-CHAPTER-${i + 1}`),
        ),
      );
    assert.equal(virtual.discovery!.status, "observed");
    assert.equal(virtual.reconciliation!.verified, 5);
    results.collapsedVirtualDirectoryAndDelayedNavigation = true;
    const missing = await start("/missing/1");
    assert.equal(missing.status, "partial");
    assert.equal(missing.reconciliation!.failed.length, 1);
    const missingHTML = await fs.readFile(
      missing.exports.find((f) => f.format === "html")!.path,
      "utf8",
    );
    assert(missingHTML.includes("1 章未完成"));
    assert(!missingHTML.includes("END-CHAPTER-2"));
    allowMissing = true;
    const before = requests.get("/missing/1")!;
    await engine.action(missing.id, "retry-missing");
    await until(() => !engine.busy(missing.id));
    assert.equal(missing.status, "completed", JSON.stringify(missing.issues));
    assert.equal(requests.get("/missing/1"), before);
    results.missingChapterAndTargetedRetry = true;
    const duplicate = await start("/duplicate/1");
    assert.equal(duplicate.status, "partial");
    assert.equal(duplicate.reconciliation!.duplicateGroups.length, 1);
    assert(duplicate.events.some((e) => e.message.includes("检测到重复正文")));
    results.duplicateRetryAndWarning = true;
    store.settings({ maxScrollSteps: 1 });
    const truncated = await start("/truncated", ["html"]);
    assert.equal(truncated.status, "partial");
    assert.equal(truncated.reconciliation!.truncated.length, 1);
    assert.equal(truncated.chapters[0].capture!.retries, 1);
    results.truncationNotReportedAsComplete = true;
    store.settings({ maxScrollSteps: 100 });
    const layout = await start("/layout");
    assert.equal(layout.status, "completed", JSON.stringify(layout.issues));
    assert(layout.coverage.layoutRepairs!.some((x) => x.includes("长图")));
    assert(layout.coverage.layoutRepairs!.some((x) => x.includes("表格")));
    const preview = await fs.readFile(
      path.join(layout.outputDir, "preview.html"),
      "utf8",
    );
    assert(preview.includes("long-image-slice"));
    assert(preview.includes("长图 4/4"));
    const pdf = new PDFLayout();
    try {
      await pdf.load(layout.exports.find((f) => f.format === "pdf")!.path);
      const text = (await pdf.text()).replace(/\s+/g, "");
      assert(text.includes("FINAL-LAYOUT-END"));
      for (let i = 1; i <= 100; i++)
        assert(text.includes(`line_${i}=`), `PDF 缺少第 ${i} 行代码`);
      assert.equal(text.split("单").length - 1, 180);
      assert.equal(text.split("cell").length - 1, 150);
      for (let page = 1; page <= layout.coverage.rulePages!; page++)
        await fs.writeFile(
          path.join(store.root, `layout-page-${page}.png`),
          await pdf.page(page),
        );
      assert.deepEqual(await pdf.audit(), []);
    } finally {
      pdf.close();
    }
    results.layoutRepairAndFinalPDFRecheck = {
      repairs: layout.coverage.layoutRepairs,
      pages: layout.coverage.rulePages,
    };
    // Inject audit failures to verify the bounded repair and unresolved-report path.
    const audit = PDFLayout.prototype.audit;
    try {
      let attempts = 0;
      PDFLayout.prototype.audit = async function (headings) {
        attempts++;
        return attempts === 1
          ? [{ page: 1, code: "text-overflow", message: "故障注入：测试重排" }]
          : audit.call(this, headings);
      };
      await engine.action(layout.id, "reexport");
      await until(() => !engine.busy(layout.id));
      assert.equal(attempts, 2);
      assert.equal(layout.status, "completed", JSON.stringify(layout.issues));
      assert(
        layout.coverage.layoutRepairs!.some((r) => r.includes("重新生成一次")),
      );
      PDFLayout.prototype.audit = async () => [
        { page: 1, code: "text-overflow", message: "故障注入：持续越界" },
      ];
      await engine.action(layout.id, "reexport");
      await until(() => !engine.busy(layout.id));
      assert.equal(layout.status, "partial");
      assert(layout.issues.some((i) => i.code === "layout-text-overflow"));
      const report = JSON.parse(
        await fs.readFile(path.join(layout.outputDir, "归档报告.json"), "utf8"),
      );
      assert.equal(report.aiReview.layoutChecks.length, 1);
      results.boundedRepairAndUnresolvedWarning = true;
    } finally {
      PDFLayout.prototype.audit = audit;
    }
    const bad = await PDFDocument.create();
    const font = await bad.embedFont(StandardFonts.Helvetica);
    bad.addPage([595, 842]).drawRectangle({
      x: 0,
      y: 0,
      width: 595,
      height: 842,
      color: rgb(1, 1, 1),
    });
    bad
      .addPage([595, 842])
      .drawText("overflow", { x: 590, y: 400, size: 20, font });
    bad
      .addPage([595, 842])
      .drawText("ORPHAN HEADING", { x: 50, y: 50, size: 20, font });
    bad
      .addPage([595, 842])
      .drawText("Following body", { x: 50, y: 700, size: 11, font });
    const auditFile = path.join(store.root, "audit-fixture.pdf");
    await fs.writeFile(auditFile, await bad.save());
    const inspector = new PDFLayout();
    try {
      await inspector.load(auditFile);
      const findings = await inspector.audit(["ORPHAN HEADING"]);
      assert(findings.some((f) => f.page === 1 && f.code === "blank-page"));
      assert(findings.some((f) => f.page === 2 && f.code === "text-overflow"));
      assert(findings.some((f) => f.page === 3 && f.code === "orphan-heading"));
    } finally {
      inspector.close();
    }
    results.finalPDFAuditDetectsActualDefects = true;
    await win.webContents.executeJavaScript(
      "Array.from(document.querySelectorAll('.main-nav button')).find(e=>e.textContent.includes('已保存')).click()",
    );
    await wait(300);
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-job-id="${direct.id}"] .job-main').click()`,
    );
    await wait(400);
    assert(
      await win.webContents.executeJavaScript(
        "document.body.innerText.includes('保存范围与检查')",
      ),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.review-summary').open=true",
    );
    await fs.writeFile(
      path.join(store.root, "capture-summary.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    results.uiSummary = true;
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal [aria-label=关闭]').click()",
    );
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-job-id="${book.id}"] .job-main').click()`,
    );
    await wait(200);
    await win.webContents.executeJavaScript(
      "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.includes('保存选项')).click()",
    );
    await wait(150);
    assert(
      await win.webContents.executeJavaScript(
        "Array.from(document.querySelectorAll('.check-line span')).some(e=>e.textContent==='16. 客服邮件分流')",
      ),
    );
    await fs.writeFile(
      path.join(store.root, "numbered-selection.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    results.sourceNumberingInSelectionUI = true;
    // Layout fixtures exercise the real renderer with isolated Store records only.
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal [aria-label=关闭]').click()",
    );
    const detailFixture: Job = {
      ...structuredClone(book),
      id: uid(),
      title: "笨办法学 Agent · 用 LangGraph 上线",
      status: "ready",
      exports: [],
      previewPath: undefined,
      reconciliation: undefined,
      issues: [],
      error: undefined,
      options: { ...book.options, formats: ["pdf"], aiReview: false },
      chapters: Array.from({ length: 27 }, (_, i) => ({
        ...structuredClone(book.chapters[0]),
        id: `detail-chapter-${i}`,
        title:
          i === 0
            ? "前言：任何人都可以写 agent"
            : i === 26
              ? "后记：接口会过时，判断不会"
              : [
                  "理解需求与设计流程",
                  "构建可靠的工具调用",
                  "客服邮件分流与质量评估",
                ][i % 3],
        sourceNumber: i > 0 && i < 26 ? `${i}.` : undefined,
        selected: true,
        status: "discovered",
        assets: [],
        evidencePath: undefined,
      })),
    };
    detailFixture.outputDir = path.join(
      store.config.outputRoot,
      detailFixture.id,
    );
    store.save(detailFixture);
    await wait(250);
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-job-id="${detailFixture.id}"] .job-main').click()`,
    );
    await wait(250);
    const checkLayout = async (name: string) => {
      const bounds = await win.webContents.executeJavaScript(`(() => {
        const modal=document.querySelector('.job-detail-modal'), footer=modal.querySelector('.detail-footer'), list=modal.querySelector('.chapter-list'), scroll=modal.querySelector('.detail-scroll');
        const m=modal.getBoundingClientRect(), f=footer.getBoundingClientRect(), b=footer.querySelector('.primary').getBoundingClientRect();
        return { horizontalOverflow: modal.scrollWidth > modal.clientWidth+1 || scroll.scrollWidth > scroll.clientWidth+1, footerVisible: f.bottom <= innerHeight && b.top >= m.top && b.bottom <= m.bottom, listScrollable: list.scrollHeight>list.clientHeight, allVisible: [...modal.querySelectorAll('.format-choice')].every(e=>{const r=e.getBoundingClientRect();return r.left>=m.left && r.right<=m.right}), counts: footer.innerText.includes('27 / 27'), primaryEnabled: !footer.querySelector('.primary').disabled };
      })()`);
      assert.equal(
        bounds.horizontalOverflow,
        false,
        `${name}: horizontal overflow`,
      );
      assert.equal(bounds.footerVisible, true, `${name}: save action clipped`);
      assert.equal(
        bounds.listScrollable,
        true,
        `${name}: long directory must scroll independently`,
      );
      assert.equal(bounds.allVisible, true, `${name}: format controls clipped`);
      assert.equal(bounds.counts, true);
      assert.equal(bounds.primaryEnabled, true);
      await fs.writeFile(
        path.join(store.root, `detail-${name}.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
    };
    win.setSize(1180, 820);
    await wait(200);
    await checkLayout("desktop");
    // Empty selections and empty formats must disable the relocated save action.
    await win.webContents.executeJavaScript(
      "document.querySelector('.chapter-picker .text-button').click()",
    );
    await wait(80);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.detail-footer .primary').disabled && document.querySelector('.detail-footer-copy').innerText.includes('0 / 27')",
      ),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.chapter-picker .text-button').click();document.querySelector('.format-choice.chosen').click()",
    );
    await wait(80);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.detail-footer .primary').disabled && document.querySelector('.detail-footer-copy').innerText.includes('请至少选择一种格式')",
      ),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.format-choice').click();document.querySelector('.chapter-list').scrollTop=99999",
    );
    await wait(80);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.chapter-list .check-line:last-child').getBoundingClientRect().bottom <= document.querySelector('.chapter-list').getBoundingClientRect().bottom",
      ),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.chapter-list').scrollTop=0",
    );
    // Opening a nested template dialog must return to the same selection.
    await win.webContents.executeJavaScript(
      "document.querySelector('.job-detail-modal .template-trigger').click()",
    );
    await wait(200);
    assert.equal(
      await win.webContents.executeJavaScript(
        "document.querySelector('.job-detail-modal').inert",
      ),
      true,
    );
    await win.webContents.executeJavaScript(
      "[...document.querySelectorAll('.modal')].at(-1).querySelector('[aria-label=关闭]').click()",
    );
    await wait(80);
    assert.equal(
      await win.webContents.executeJavaScript(
        "document.querySelector('.job-detail-modal').inert",
      ),
      false,
    );
    await checkLayout("template-return");
    win.setSize(860, 650);
    await wait(200);
    await checkLayout("compact");
    win.setMinimumSize(600, 600);
    win.setSize(680, 760);
    await wait(200);
    await checkLayout("narrow");
    await win.webContents.executeJavaScript(
      "document.querySelector('.technical').open=true;document.querySelector('.detail-scroll').scrollTop=99999",
    );
    await wait(100);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.detail-footer .primary').getBoundingClientRect().bottom<=innerHeight",
      ),
    );
    await fs.writeFile(
      path.join(store.root, "detail-maintenance.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    assert.deepEqual(detailFixture.options.formats, ["pdf"]);
    assert.equal(
      detailFixture.status,
      "ready",
      "layout interactions must not auto-start a save",
    );
    assert.equal(detailFixture.chapters.filter((c) => c.selected).length, 27);
    results.detailLayoutAndSelectionStates = true;
    // Single articles use the full settings area; running jobs disable all save controls.
    await win.webContents.executeJavaScript(
      "document.querySelector('.job-detail-modal [aria-label=关闭]').click()",
    );
    detailFixture.chapters = detailFixture.chapters.slice(0, 1);
    store.save(detailFixture);
    await wait(200);
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-job-id="${detailFixture.id}"] .job-main').click()`,
    );
    await wait(150);
    assert.equal(
      await win.webContents.executeJavaScript(
        "!!document.querySelector('.chapter-picker')",
      ),
      false,
    );
    detailFixture.status = "running";
    store.save(detailFixture);
    await wait(150);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.detail-footer .primary').disabled && [...document.querySelectorAll('.job-detail-modal .format-choice')].every(e=>e.disabled)",
      ),
    );
    detailFixture.status = "ready";
    store.save(detailFixture);
    results.detailSingleArticleAndBusyState = true;
    await win.webContents.executeJavaScript(
      "document.querySelector('.job-detail-modal [aria-label=关闭]').click()",
    );
    win.setSize(1180, 820);
    await wait(150);
    const rowSelector = `[data-job-id="${detailFixture.id}"]`;
    const keyOnRow = async (key: string, repeat = false) => {
      await win.webContents.executeJavaScript(`(() => {
        const target=document.querySelector(${JSON.stringify(rowSelector)}+' .job-main');
        target.focus();
        target.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},repeat:${JSON.stringify(repeat)},bubbles:true,cancelable:true}));
      })()`);
      await wait(80);
    };
    await keyOnRow("Delete", true);
    assert.equal(
      await win.webContents.executeJavaScript(
        "!!document.querySelector('.row-confirm')",
      ),
      false,
      "key repeat must not open destructive confirmation",
    );
    await keyOnRow("Delete");
    assert(
      store.jobs.has(detailFixture.id),
      "Delete must only ask for confirmation",
    );
    assert(
      await win.webContents.executeJavaScript(
        `document.querySelector(${JSON.stringify(rowSelector)}+' .row-confirm').contains(document.activeElement) && !document.activeElement.classList.contains('confirm-action')`,
      ),
      "safe keep action gets initial focus",
    );
    await keyOnRow("Escape");
    assert.equal(
      await win.webContents.executeJavaScript(
        "!!document.querySelector('.row-confirm')",
      ),
      false,
    );
    assert(store.jobs.has(detailFixture.id));
    // An input outside a task must retain normal text editing behavior.
    await win.webContents.executeJavaScript(
      "document.querySelector('.search input').dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true}))",
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        "!!document.querySelector('.row-confirm')",
      ),
      false,
    );
    await keyOnRow("Backspace");
    await fs.writeFile(
      path.join(store.root, "row-remove-confirm.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    const rowLayout = () =>
      win.webContents.executeJavaScript(`(() => {
      const row = document.querySelector(${JSON.stringify(rowSelector)});
      const panel = row.querySelector('.row-confirm');
      const shortcuts = document.querySelector('.job-keyboard-hint');
      return {
        statusInMetadata: !!row.querySelector('.job-main .job-metadata .status'),
        shortcutsCollapsed: !shortcuts.open && !shortcuts.querySelector('span').checkVisibility(),
        height: panel.getBoundingClientRect().height,
        noOverflow: panel.scrollWidth <= panel.clientWidth && row.scrollWidth <= row.clientWidth,
      };
    })()`);
    const desktopRow = await rowLayout();
    assert(desktopRow.statusInMetadata);
    assert(
      desktopRow.shortcutsCollapsed,
      "shortcut instructions are hidden until requested",
    );
    assert(
      desktopRow.height <= 260,
      "removal choices must remain readable within the task row",
    );
    assert(
      await win.webContents.executeJavaScript(
        `document.querySelector(${JSON.stringify(rowSelector)}+' .removal-choices input').checked`,
      ),
      "record-only is the default",
    );
    assert(desktopRow.noOverflow, "desktop task row must not overflow");
    win.setSize(860, 820);
    await wait(150);
    assert(
      (await rowLayout()).noOverflow,
      "narrow task confirmation must not clip",
    );
    await fs.writeFile(
      path.join(store.root, "row-remove-narrow.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.job-keyboard-hint summary').click()",
    );
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.job-keyboard-hint > span').checkVisibility()",
      ),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.job-keyboard-hint summary').click()",
    );
    win.setSize(1180, 820);
    await wait(100);
    results.compactRowLayoutAndShortcuts = true;
    const retained = path.join(
      detailFixture.outputDir,
      "row-removal-retains-files.txt",
    );
    await fs.mkdir(detailFixture.outputDir, { recursive: true });
    await fs.writeFile(retained, "keep exported files");
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(rowSelector)}+' .confirm-action').click()`,
    );
    await until(() => !store.jobs.has(detailFixture.id));
    assert.equal(await fs.readFile(retained, "utf8"), "keep exported files");
    results.rowActionsKeyboardAndSafeRemove = true;
    // Real OS trash operation only on newly created isolated task directories.
    const diskId = uid();
    const diskJob: Job = {
      ...structuredClone(detailFixture),
      id: diskId,
      outputDir: path.join(store.config.outputRoot, diskId),
    };
    const cacheDir = path.join(store.root, "checkpoints", diskId);
    await fs.mkdir(diskJob.outputDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(diskJob.outputDir, "isolated-removal-marker.txt"),
      "created solely for removal verification",
    );
    await fs.writeFile(
      path.join(cacheDir, "isolated-removal-marker.txt"),
      "created solely for removal verification",
    );
    store.save(diskJob);
    await wait(200);
    const diskSelector = `[data-job-id="${diskId}"]`;
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(diskSelector)}+' .job-remove').click()`,
    );
    await wait(150);
    await win.webContents.executeJavaScript(
      `document.querySelectorAll(${JSON.stringify(diskSelector)}+' .removal-choices input')[1].click()`,
    );
    await wait(100);
    assert(
      await win.webContents.executeJavaScript(
        `document.querySelector(${JSON.stringify(diskSelector)}+' .confirm-action').textContent.includes('废纸篓')`,
      ),
    );
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(diskSelector)}+' .removal-paths summary').click()`,
    );
    await fs.writeFile(
      path.join(store.root, "remove-disk-files.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(diskSelector)}+' .confirm-action').click()`,
    );
    await until(() => !store.jobs.has(diskId));
    await assert.rejects(fs.access(diskJob.outputDir));
    await assert.rejects(fs.access(cacheDir));
    assert.equal(
      await fs.readFile(retained, "utf8"),
      "keep exported files",
      "other archives must survive file removal",
    );
    results.recordAndDiskRemovalIPC = {
      passed: true,
      isolatedJobId: diskId,
      systemTrash: true,
    };
    await win.webContents.executeJavaScript(
      "document.querySelector('.main-nav button').click()",
    );
    await wait(150);
    await win.webContents.executeJavaScript(
      "document.querySelector('.recent-section').scrollIntoView({block:'center'})",
    );
    const recentLayout = async () =>
      win.webContents.executeJavaScript(`(() => {
      const section=document.querySelector('.recent-section');
      const rows=[...section.querySelectorAll('.job-row')];
      return {count:rows.length, heights:rows.map(e=>e.getBoundingClientRect().height),
        noOverflow:document.documentElement.scrollWidth<=innerWidth,
        actionsInside:rows.every(e=>{const a=e.querySelector('.job-actions').getBoundingClientRect(),r=e.getBoundingClientRect();return a.right<=r.right+1 && a.top>=r.top && a.bottom<=r.bottom+1})};
    })()`);
    for (const width of [1180, 860]) {
      win.setSize(width, 760);
      await wait(150);
      const layout = await recentLayout();
      assert(
        layout.count > 0 &&
          layout.heights.every((h: number) => h <= 90) &&
          layout.noOverflow &&
          layout.actionsInside,
        JSON.stringify(layout),
      );
      results["recentLayout" + width] = layout;
      await fs.writeFile(
        path.join(store.root, `recent-${width}.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
    await fs.writeFile(
      path.join(store.root, "workbench-populated.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('.main-nav button')[1].click()",
    );
    await wait(150);
    // Cancel a genuinely pending source read through the renderer and IPC.
    const [cancelId] = await engine.create([base + "/cancel-pending"], {
      formats: ["pdf"],
      aiReview: false,
    });
    const cancelJob = store.get(cancelId);
    assert(
      await win.webContents.executeJavaScript(
        `window.archive.remove(${JSON.stringify(cancelId)},'files').then(()=>false,()=>true)`,
      ),
      "busy tasks cannot be removed",
    );
    await until(() => engine.busy(cancelId));
    await wait(200);
    const cancelSelector = `[data-job-id="${cancelId}"]`;
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(cancelSelector)}+' .job-cancel').click()`,
    );
    await wait(100);
    assert.notEqual(
      cancelJob.status,
      "cancelled",
      "cancel requires confirmation",
    );
    await fs.writeFile(
      path.join(store.root, "row-cancel-confirm.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(cancelSelector)}+' .confirm-action').click()`,
    );
    await until(
      () => cancelJob.status === "cancelled" && !engine.busy(cancelId),
    );
    assert(store.jobs.has(cancelId), "cancel must not remove the record");
    await wait(150);
    assert.equal(
      await win.webContents.executeJavaScript(
        `!!document.querySelector(${JSON.stringify(cancelSelector)}+' .job-remove')`,
      ),
      true,
    );
    await fs.writeFile(
      path.join(store.root, "row-actions.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    results.rowActionsCancelIPC = true;

    results.paidCalls = 0;
    results.ok = true;
  } catch (error) {
    results.ok = false;
    results.error = String(error);
    console.error(error);
  } finally {
    store.flush();
    await fs.writeFile(
      path.join(store.root, "pipeline-result.json"),
      JSON.stringify(results, null, 2),
    );
    server.close();
    app.exit(results.ok ? 0 : 1);
  }
}
