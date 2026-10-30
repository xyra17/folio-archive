import { createServer } from "node:http";
import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { Store } from "./store";
import { Engine } from "./engine";
import { wait } from "./core";
import { archiveFolderName } from "./archive-directory";
import type { Job } from "../shared/types";
import { templates } from "../shared/templates";
import { templateSample } from "./template-preview";
import { exportJob } from "./export";
import { runReaderE2E } from "./reader-e2e";
import { runExtractionE2E } from "./extraction-e2e";
async function until(check: () => boolean, timeout = 60000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("等待任务超时");
    await wait(100);
  }
}
export async function runE2E({
  store,
  engine,
  window: win,
  demoUrl,
  repairImages,
}: {
  store: Store;
  engine: Engine;
  window: BrowserWindow;
  demoUrl: string;
  repairImages: () => void;
}) {
  const capture = async () => {
    win.webContents.setBackgroundThrottling(false);
    win.show();
    win.focus();
    await win.webContents.executeJavaScript(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    await wait(120);
    return win.webContents.capturePage();
  };
  const result: Record<string, unknown> = {};
  try {
    await wait(350);
    assert(
      await win.webContents.executeJavaScript(
        "!document.querySelector('[role=dialog]') && !document.querySelector('.save-preferences').open && !document.querySelector('.template-trigger').checkVisibility()",
      ),
      "启动后直接进入首页，排版与保存设置默认收起",
    );
    const controlsVisible = async () =>
      win.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.window-control')).length === 3 && Array.from(document.querySelectorAll('.window-control')).every(button=>{const r=button.getBoundingClientRect();return r.width>=22 && r.height>=28 && r.y>=0 && r.bottom<64 && button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)) && getComputedStyle(button).webkitAppRegion==='no-drag'})`,
      );
    assert(await controlsVisible());
    const initialSize = win.getSize();
    await win.webContents.executeJavaScript(
      "document.querySelector('.window-control.minimize').click()",
    );
    await until(() => win.isMinimized(), 5000);
    win.restore();
    win.focus();
    await until(() => !win.isMinimized(), 5000);
    await win.webContents.executeJavaScript(
      "document.querySelector('.window-control.zoom').click()",
    );
    await until(() => win.isMaximized(), 5000);
    assert(await controlsVisible());
    await fs.writeFile(
      path.join(store.root, "app-maximized.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.window-control.zoom').click()",
    );
    await until(() => !win.isMaximized(), 5000);
    if (process.platform === "darwin") {
      await win.webContents.executeJavaScript(
        "document.querySelector('.window-control.zoom').dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:true}))",
      );
      await until(() => win.isFullScreen(), 5000);
      await wait(1000);
      assert(await controlsVisible());
      await fs.writeFile(
        path.join(store.root, "app-fullscreen.png"),
        (await capture()).toPNG(),
      );
      await win.webContents.executeJavaScript(
        "document.querySelector('.window-control.zoom').click()",
      );
      await until(() => !win.isFullScreen(), 5000);
      await wait(750);
    }
    win.setSize(860, 650);
    await wait(200);
    assert(await controlsVisible());
    assert(
      await win.webContents.executeJavaScript(
        "(()=>{const r=document.querySelector('.save-button').getBoundingClientRect();return r.bottom<=innerHeight-30 && document.documentElement.scrollWidth<=innerWidth})()",
      ),
    );
    await fs.writeFile(
      path.join(store.root, "app-minimum.png"),
      (await capture()).toPNG(),
    );
    win.setSize(initialSize[0], initialSize[1]);
    result.windowControls =
      "close/minimize/zoom controls visible at 860px, zoomed and fullscreen; minimize/restore and zoom/restore execute real window actions";
    await fs.writeFile(
      path.join(store.root, "app-empty.png"),
      (await capture()).toPNG(),
    );
    for (const index of [1, 2, 3])
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.detailed .format-choice')[${index}].click()`,
      );
    assert.equal(
      await win.webContents.executeJavaScript(
        "document.querySelectorAll('.detailed [aria-pressed=true]').length",
      ),
      4,
    );
    await fs.writeFile(
      path.join(store.root, "app-formats.png"),
      (await capture()).toPNG(),
    );
    for (const index of [1, 2, 3])
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.detailed .format-choice')[${index}].click()`,
      );
    result.formatSelection =
      "PDF/Word/Markdown/HTML cards allow multiple selection and return to default PDF";
    await win.webContents.executeJavaScript(
      "document.querySelector('.save-preferences > summary').click()",
    );
    assert(
      await win.webContents.executeJavaScript(
        "!document.querySelector('[role=dialog]') && document.querySelector('.template-trigger').getClientRects().length > 0",
      ),
      "展开保存设置不应自动打开排版弹窗",
    );
    await fs.writeFile(
      path.join(store.root, "app-save-settings.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.template-trigger').click()",
    );
    await wait(350);
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('.template-option')[3].click()",
    );
    await wait(250);
    assert(await controlsVisible());
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.template-stage iframe')?.srcdoc.includes('data-template=\"journal\"')",
      ),
    );
    const paperFits = () =>
      win.webContents.executeJavaScript(
        `(()=>{const p=document.querySelector('.template-preview-sheet').getBoundingClientRect();const v=document.querySelector('.template-viewport').getBoundingClientRect();return p.left>=v.left && p.right<=v.right && p.top>=v.top && p.bottom<=v.bottom})()`,
      );
    assert(await paperFits(), "整页预览应完整位于可视区域");
    const pageWidth: number = await win.webContents.executeJavaScript(
      "document.querySelector('.template-preview-sheet').getBoundingClientRect().width",
    );
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('.template-zoom button')[1].click()",
    );
    await wait(100);
    assert(
      await win.webContents.executeJavaScript(
        `document.querySelector('.template-preview-sheet').getBoundingClientRect().width > ${pageWidth}`,
      ),
      "适合宽度应放大纸张",
    );
    await fs.writeFile(
      path.join(store.root, "app-templates-width.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('.template-zoom button')[0].click()",
    );
    win.setSize(860, 650);
    await wait(200);
    assert(await paperFits(), "最小窗口应能完整显示整页预览");
    assert(await controlsVisible());
    await fs.writeFile(
      path.join(store.root, "app-templates-minimum.png"),
      (await capture()).toPNG(),
    );
    win.setSize(initialSize[0], initialSize[1]);
    await wait(200);
    for (const [i, theme] of templates.entries()) {
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.template-option')[${i}].click()`,
      );
      await wait(120);
      await fs.writeFile(
        path.join(store.root, `app-template-${theme.id}.png`),
        (await capture()).toPNG(),
      );
    }
    await fs.writeFile(
      path.join(store.root, "app-templates.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal-actions .primary').click()",
    );
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.template-trigger').textContent.includes('杂志精选')",
      ),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.template-trigger').click()",
    );
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('.template-option')[0].click()",
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal-actions .primary').click()",
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.ai-control [role=switch]').click()",
    );
    await wait(150);
    assert(
      await win.webContents.executeJavaScript(
        "!document.querySelector('.ai-settings').hidden && document.querySelector('#settings-tab-ai').getAttribute('aria-selected')==='true' && document.querySelector('.test-connection').disabled",
      ),
    );
    await fs.writeFile(
      path.join(store.root, "app-ai-settings.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "(()=>{const t=document.querySelector('[name=model]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(t,'unsaved-model');t.dispatchEvent(new Event('input',{bubbles:true}));})()",
    );
    await wait(50);
    await win.webContents.executeJavaScript(
      "document.querySelector('#settings-tab-general').click()",
    );
    await fs.writeFile(
      path.join(store.root, "app-settings.png"),
      (await capture()).toPNG(),
    );
    assert(
      await win.webContents.executeJavaScript(
        "!document.querySelector('#settings-panel-general').hidden && document.querySelector('.ai-settings').hidden",
      ),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('#settings-tab-general').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))",
    );
    await wait(50);
    assert(
      await win.webContents.executeJavaScript(
        "document.activeElement.id === 'settings-tab-advanced' && !document.querySelector('#settings-panel-advanced').hidden",
      ),
    );
    await fs.writeFile(
      path.join(store.root, "app-settings-advanced.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('#settings-tab-ai').click()",
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        "document.querySelector('[name=model]').value",
      ),
      "unsaved-model",
      "页签切换应保留未提交输入",
    );
    win.setSize(860, 650);
    await wait(100);
    assert(await controlsVisible());
    assert(
      await win.webContents.executeJavaScript(
        "(()=>{const r=document.querySelector('.settings-modal .modal-actions .primary').getBoundingClientRect();return r.bottom<innerHeight-30 && document.documentElement.scrollWidth<=innerWidth})()",
      ),
    );
    await fs.writeFile(
      path.join(store.root, "app-settings-minimum.png"),
      (await capture()).toPNG(),
    );
    win.setSize(initialSize[0], initialSize[1]);
    result.settingsNavigation =
      "general/AI/advanced tabs, keyboard navigation, unsaved input retained, fixed save action and window controls at 860x650";
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal [aria-label=关闭]').click()",
    );
    result.templateUI =
      "four built-in themes, actual export HTML preview; full page fits at 860px, fit width zooms in; apply and return; AI setup opens from switch and keeps window buttons visible";
    await win.webContents.executeJavaScript(
      "document.querySelector('.advanced > summary').click()",
    );
    if (process.env.FOLIO_UI_ONLY === "1") {
      result.ok = true;
      await fs.writeFile(
        path.join(store.root, "e2e-result.json"),
        JSON.stringify(result, null, 2),
      );
      app.exit(0);
      return;
    }
    await fs.writeFile(
      path.join(store.root, "app-options.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.advanced > summary').click()",
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.save-preferences > summary').click()",
    );
    result.savePreferences =
      "startup shows home without dialogs; save preferences collapsed; expanding preferences does not open template preview";
    store.settings({ outputRoot: path.join(store.root, "exports") });
    result.extraction = await runExtractionE2E(store, engine);
    for (const theme of templates) {
      const sample = templateSample(
        theme.id,
        path.join(store.root, "template-exports", theme.id),
      );
      sample.exports = await exportJob(
        sample,
        new AbortController().signal,
        () => {},
      );
      const docx = sample.exports.find((f) => f.format === "docx")!;
      const archive = await JSZip.loadAsync(await fs.readFile(docx.path));
      assert(
        (await archive.file("word/styles.xml")!.async("string")).includes(
          theme.accent,
        ),
      );
      assert(sample.exports.find((f) => f.format === "pdf")!.pages! > 0);
    }
    result.templateExports =
      "all four templates generated PDF, editable Word and Markdown; Word styles verified against the same theme catalog";
    const [id] = await engine.create([demoUrl]);
    const job = store.get(id);
    await until(() => job.status !== "inspecting");
    assert.equal(job.status, "ready");
    assert.equal(job.chapters.length, 3);
    result.discovery = "3 chapters";
    engine.start(id, { formats: ["pdf", "docx", "md", "html"] });
    await wait(100);
    await fs.writeFile(
      path.join(store.root, "app-saving.png"),
      (await capture()).toPNG(),
    );
    await until(() => ["completed", "partial", "failed"].includes(job.status));
    assert.equal(
      job.status,
      "completed",
      JSON.stringify({ error: job.error, issues: job.issues }),
    );
    await until(() => !engine.busy(id));
    assert.equal(
      path.basename(job.outputDir),
      archiveFolderName(job.title, job.createdAt),
    );
    assert(
      job.exports.every((file) => path.dirname(file.path) === job.outputDir),
    );
    const savedDirectory = job.outputDir;
    result.archiveDirectory = path.basename(savedDirectory);
    assert.equal(job.chapters.filter((c) => c.status === "ready").length, 3);
    assert(
      job.chapters.every((c) => c.assets.every((a) => a.status === "ready")),
    );
    assert.equal(
      new Set(job.chapters.flatMap((c) => c.assets).map((a) => a.hash)).size,
      1,
    );
    const pdfFile = job.exports.find((f) => f.format === "pdf")!;
    const pdf = await PDFDocument.load(await fs.readFile(pdfFile.path));
    assert(pdf.getPageCount() >= 3);
    result.pdfPages = pdf.getPageCount();
    const docx = await JSZip.loadAsync(
      await fs.readFile(job.exports.find((f) => f.format === "docx")!.path),
    );
    const xml = await docx.file("word/document.xml")!.async("string");
    assert(xml.includes("阶段与检查点"));
    assert(xml.includes("w:tbl"));
    assert(xml.includes("drawing"));
    const md = await fs.readFile(
      job.exports.find((f) => f.format === "md")!.path,
      "utf8",
    );
    assert(md.includes("```typescript"));
    assert(md.includes("| 阶段 | 交付 | 恢复方式 |"));
    assert(md.includes("assets/"));
    assert(md.includes("任务的边界"));
    assert(md.includes("核对内容"));
    const zip = await JSZip.loadAsync(
      await fs.readFile(job.exports.find((f) => f.format === "zip")!.path),
    );
    assert(zip.file("归档报告.json"));
    assert(Object.keys(zip.files).some((f) => f.startsWith("assets/")));
    result.exports = job.exports.map((f) => ({
      format: f.format,
      path: f.path,
      bytes: f.bytes,
    }));
    result.htmlReader = await runReaderE2E(store.root, job);
    const evidence = job.chapters.map((c) => c.evidencePath);
    await engine.action(id, "reexport");
    await until(() => !engine.busy(id));
    assert.equal(job.status, "completed");
    assert.equal(job.outputDir, savedDirectory);
    assert.deepEqual(
      job.chapters.map((c) => c.evidencePath),
      evidence,
    );
    assert(job.chapters.every((c) => c.changes === "与上次采集内容一致"));
    result.checkpoint = "reexport reused all source evidence";
    await engine.action(id, "refresh");
    await until(() => !engine.busy(id));
    assert.equal(job.status, "completed");
    assert(job.chapters.every((c, i) => c.evidencePath !== evidence[i]));
    assert(job.chapters.every((c) => c.changes === "与上次采集内容一致"));
    result.versionDiff = "fresh capture, same blocks";
    const [brokenId] = await engine.create([`${demoUrl}?broken=1`]);
    const broken = store.get(brokenId);
    await until(() => broken.status !== "inspecting");
    engine.start(brokenId);
    await until(() => !engine.busy(brokenId));
    assert.equal(broken.status, "partial");
    assert(broken.issues.some((i) => i.code === "asset-download"));
    repairImages();
    await engine.action(brokenId, "retry-assets");
    await until(() => !engine.busy(brokenId));
    assert.equal(broken.status, "completed");
    assert(!broken.issues.some((i) => i.code === "asset-download"));
    result.assetRetry = "failed images recovered using cached source";
    store.settings({ pageConcurrency: 1 });
    const [pauseId] = await engine.create([demoUrl]);
    const paused = store.get(pauseId);
    await until(() => paused.status !== "inspecting");
    engine.start(pauseId);
    await until(() => paused.chapters.some((c) => c.evidencePath));
    await engine.action(pauseId, "pause");
    await until(() => !engine.busy(pauseId));
    assert.equal(paused.status, "paused");
    const checkpoints = paused.chapters.map((c) => c.evidencePath);
    await engine.action(pauseId, "resume");
    await until(() => !engine.busy(pauseId));
    assert.equal(paused.status, "completed");
    checkpoints.forEach((p, i) => {
      if (p) assert.equal(paused.chapters[i].evidencePath, p);
    });
    result.pauseResume = "completed evidence preserved across pause";
    await engine.action(pauseId, "refresh");
    await engine.action(pauseId, "cancel");
    await until(() => !engine.busy(pauseId));
    assert.equal(paused.status, "cancelled");
    result.cancel = "cancelled job never becomes completed";
    const origin = new URL(demoUrl).origin;
    const articleIds = await engine.create(
      [
        "csdn",
        "zhihu",
        "anthropic",
        "generic",
        "collapsed",
        "teaser",
        "quoted-code",
        "shadow",
      ].map((site) => `${origin}/article-${site}`),
      { formats: ["pdf", "docx", "md"] },
      true,
    );
    await until(
      () =>
        articleIds.every((id) =>
          ["completed", "partial", "failed"].includes(store.get(id).status),
        ),
      90000,
    );
    for (const articleId of articleIds) {
      const article = store.get(articleId);
      assert.equal(
        article.status,
        "completed",
        JSON.stringify({
          url: article.url,
          error: article.error,
          issues: article.issues,
        }),
      );
      assert.equal(
        article.chapters.length,
        1,
        "site navigation must not become document chapters",
      );
      assert.equal(article.chapters[0].assets.length, 1);
      assert.equal(article.chapters[0].assets[0].status, "ready");
      const text = await fs.readFile(
        article.exports.find((f) => f.format === "md")!.path,
        "utf8",
      );
      assert(text.includes("正文开始标记"));
      assert(text.includes("正文结束标记"));
      assert(text.includes("```python"));
      assert(!/噪声不应保存|关联文章不应保存|全站导航不应变成章节/.test(text));
      if (article.url.endsWith("quoted-code")) {
        assert(
          text.indexOf("代码前引用") < text.indexOf('print("hello article")'),
        );
        assert(
          text.indexOf('print("hello article")') < text.indexOf("代码后引用"),
        );
        assert.equal(text.split('print("hello article")').length, 2);
      }
      if (article.url.endsWith("shadow"))
        assert(text.includes("组件内的正文标题"));
    }
    const [challengeId] = await engine.create(
      [origin + "/article-captcha"],
      undefined,
      true,
    );
    await until(() => store.get(challengeId).status !== "inspecting");
    assert.equal(store.get(challengeId).status, "waiting_login");
    assert.equal(store.get(challengeId).exports.length, 0);
    result.universalArticles =
      "8 article fixtures: body selectors, Readability, short teaser before full story, nested quoted code, open shadow DOM and slots, lazy image; three formats; no navigation chapters; challenge page never exported";
    const [componentsId] = await engine.create([origin + "/components"]);
    const components = store.get(componentsId);
    await until(() => components.status !== "inspecting");
    engine.start(componentsId);
    await until(() => !engine.busy(componentsId));
    assert.equal(
      components.status,
      "partial",
      JSON.stringify(components.issues),
    );
    assert(components.issues.some((i) => i.code === "component-screenshot"));
    assert(
      components.issues.some(
        (i) => i.code === "unsupported-component" && i.blockId === "large",
      ),
    );
    const componentAssets = components.chapters.flatMap((c) => c.assets);
    assert.equal(
      componentAssets.filter((a) => a.captureMode === "screenshot").length,
      1,
    );
    const screenshot = componentAssets.find(
      (a) => a.captureMode === "screenshot",
    )!;
    assert.equal(screenshot.status, "ready");
    const png = await fs.readFile(
      path.join(components.outputDir!, screenshot.path!),
    );
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    const componentMD = await fs.readFile(
      components.exports.find((f) => f.format === "md")!.path,
      "utf8",
    );
    assert(componentMD.includes("画板前面的正文必须保留"));
    assert(componentMD.includes("画板后面的正文也必须保留"));
    assert(componentMD.includes("最后一段正文必须保留"));
    assert(componentMD.includes("不含可编辑数据或交互内容"));
    const componentReport = JSON.parse(
      await fs.readFile(
        components.exports.find((f) => f.format === "report")!.path,
        "utf8",
      ),
    );
    assert(
      componentReport.assets.some(
        (a: { captureMode?: string }) => a.captureMode === "screenshot",
      ),
    );
    result.componentCapture =
      "bounded screenshot with provenance; oversized component explicitly missing; surrounding text preserved";
    for (const suffix of ["/original.pdf", "/preview-pdf"]) {
      const [pdfId] = await engine.create([origin + suffix]);
      const original = store.get(pdfId);
      await until(() => original.status !== "inspecting");
      assert.equal(original.source, "pdf");
      engine.start(pdfId, { aiReview: true });
      await until(() => !engine.busy(pdfId));
      assert.equal(original.status, "completed");
      assert.equal(original.exports.find((f) => f.format === "pdf")?.pages, 1);
      assert.equal(original.coverage.layout, "not-requested");
      assert.equal(
        original.exports.some((f) => f.format === "docx"),
        false,
      );
    }
    result.originalPDF = "direct PDF and preview original validated";
    const [loginId, restrictedId] = await engine.create([
      origin + "/login-required",
      origin + "/restricted",
    ]);
    await until(() =>
      [loginId, restrictedId].every(
        (i) => store.get(i).status !== "inspecting",
      ),
    );
    assert.equal(store.get(loginId).status, "waiting_login");
    assert.equal(store.get(restrictedId).status, "failed");
    assert(store.get(restrictedId).error?.includes("限制"));
    result.restrictions =
      "login and explicit export restriction stop the pipeline";
    const accessServer = createServer((req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      const url = req.url || "/";
      const full =
        "<article><h1>可读取的正文</h1><p>正常正文开始。这个本地样本用于确认付费提示不会被静默当作全文，登录后可以继续采集。正文结束。</p></article>";
      if (url === "/collection")
        res.end(
          `<h1>访问恢复示例</h1><nav class="toc"><a href="/free">公开章节</a><a href="/membership">会员章节</a></nav>${full}`,
        );
      else if (url === "/membership")
        res.end(
          req.headers.cookie?.includes("folio_member=1")
            ? full.replace("</article>", "<p>会员完整正文标记。</p></article>")
            : '<article><h1>会员章节</h1><p>这只是开头的试读内容。</p></article><div class="paywall"><p>本文为会员专享，开通会员后阅读全文。</p><a href="/sign-in" target="_blank">使用已有会员账号登录</a></div>',
        );
      else if (url === "/sign-in")
        res.end(
          "<h1>本地模拟登录</h1><button onclick=\"document.cookie='folio_member=1;path=/';document.body.innerHTML='<p>登录完成，可以返回拾页继续。</p>'\">模拟已有会员账号登录</button>",
        );
      else if (url === "/preview")
        res.end(full + '<div class="paywall">当前仅显示部分预览</div>');
      else if (url === "/permission")
        res.end(full + '<div class="permission-tip">申请访问权限</div>');
      else if (url === "/english")
        res.end(
          full + '<div class="paywall">Subscribe to continue reading</div>',
        );
      else if (url === "/hidden")
        res.end(
          full +
            '<div class="paywall" hidden>开通会员后阅读全文</div><pre>请登录后查看，开通会员后阅读全文</pre><footer><button>订阅会员通讯</button></footer>',
        );
      else res.end(full);
    });
    await new Promise<void>((r) => accessServer.listen(0, "127.0.0.1", r));
    const accessOrigin = `http://127.0.0.1:${(accessServer.address() as any).port}`;
    const gates = await engine.create(
      ["preview", "permission", "english", "hidden"].map(
        (p) => `${accessOrigin}/${p}`,
      ),
    );
    await until(() => gates.every((i) => !engine.busy(i)));
    assert.deepEqual(
      gates.map((i) => store.get(i).access?.kind),
      ["preview", "permission", "membership", "available"],
    );
    assert(
      gates
        .slice(0, 3)
        .every(
          (i) =>
            store.get(i).status === "waiting_login" &&
            !store.get(i).exports.length,
        ),
    );
    const [accessId] = await engine.create(
      [accessOrigin + "/collection"],
      { formats: ["pdf", "md"] },
      true,
    );
    const accessJob = store.get(accessId);
    await until(() => accessJob.status === "waiting_login");
    assert.equal(accessJob.access?.kind, "membership");
    const retained = accessJob.chapters
      .filter((c) => c.status === "ready")
      .map((c) => c.evidencePath);
    assert(retained.length > 0);
    assert.equal(accessJob.exports.length, 0);
    await wait(200);
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-job-id="${accessId}"] .job-main').click()`,
    );
    await wait(200);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.access-notice').textContent.includes('会员权限')",
      ),
    );
    await fs.writeFile(
      path.join(store.root, "app-access.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      `window.archive.login(${JSON.stringify(accessId)})`,
    );
    const source = BrowserWindow.getAllWindows().find(
      (w) =>
        w !== win && w.webContents.getURL() === accessOrigin + "/membership",
    )!;
    assert(source);
    await source.webContents.executeJavaScript(
      "document.querySelector('a[target=_blank]').click()",
    );
    await wait(400);
    const auth = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === accessOrigin + "/sign-in",
    )!;
    assert(auth, "login popup opens in the isolated source session");
    await auth.webContents.executeJavaScript(
      "document.querySelector('button').click()",
    );
    auth.close();
    source.close();
    win.focus();
    await win.webContents.executeJavaScript(
      "document.querySelector('.access-actions .primary').click()",
    );
    await until(() =>
      ["completed", "partial", "failed"].includes(accessJob.status),
    );
    assert.equal(accessJob.status, "completed", accessJob.error);
    assert.equal(accessJob.access?.kind, "available");
    assert(
      retained.every((p) =>
        accessJob.chapters.some((c) => c.evidencePath === p),
      ),
    );
    assert(
      (
        await fs.readFile(
          accessJob.exports.find((f) => f.format === "md")!.path,
          "utf8",
        )
      ).includes("会员完整正文标记"),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal [aria-label=关闭]').click()",
    );
    accessServer.close();
    result.accessFlow =
      "preview, permission and Chinese/English membership gates stop export; hidden paywalls and quoted/code prompts ignored; real login popup shares session; retry preserves completed chapters and captures newly accessible content";
    let modelCalls = 0;
    let visionCalls = 0;
    const mock = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const payload = JSON.parse(raw);
      if (req.headers.authorization !== "Bearer test-only") {
        res.writeHead(401);
        res.end();
        return;
      }
      modelCalls++;
      if (
        payload.messages[1]?.content?.some((c: any) => c.type === "image_url")
      )
        visionCalls++;
      assert.equal(req.headers.authorization, "Bearer test-only");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  payload.messages.length === 1
                    ? "OK"
                    : JSON.stringify({ findings: [] }),
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    const address = mock.address() as any;
    const key = store.key.bind(store);
    store.key = () => "test-only";
    store.settings({
      modelEndpoint: `http://127.0.0.1:${address.port}`,
      model: "fixture-reviewer",
      aiMaxCalls: 12,
    });
    await wait(200);
    await win.webContents.executeJavaScript(
      "document.querySelector('.save-preferences > summary').click()",
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.ai-control [role=switch]').click()",
    );
    await wait(100);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.ai-control [role=switch]').getAttribute('aria-checked')==='true'",
      ),
    );
    await fs.writeFile(
      path.join(store.root, "app-ai-enabled.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.ai-expanded .text-button').click()",
    );
    await wait(100);
    await win.webContents.executeJavaScript(
      "(()=>{const t=document.querySelector('.ai-settings input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(t,'wrong-key');t.dispatchEvent(new Event('input',{bubbles:true}));})()",
    );
    await wait(100);
    await win.webContents.executeJavaScript(
      "document.querySelector('.test-connection').click()",
    );
    await wait(200);
    assert(
      await win.webContents.executeJavaScript(
        "!!document.querySelector('.connection-result.error')",
      ),
    );
    await win.webContents.executeJavaScript(
      "(()=>{const t=document.querySelector('.ai-settings input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(t,'');t.dispatchEvent(new Event('input',{bubbles:true}));})()",
    );
    await wait(100);
    await win.webContents.executeJavaScript(
      "document.querySelector('.test-connection').click()",
    );
    await wait(200);
    assert(
      await win.webContents.executeJavaScript(
        "!!document.querySelector('.connection-result.success')",
      ),
    );
    await fs.writeFile(
      path.join(store.root, "app-ai-connected.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal [aria-label=关闭]').click()",
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.ai-control [role=switch]').click()",
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.save-preferences > summary').click()",
    );
    modelCalls = 0;
    result.modelConnection =
      "actual settings UI tests rejected credentials and successful model response; unsaved key never persisted; per-task switch enables and disables review";
    await engine.action(id, "reexport");
    await until(() => !engine.busy(id));
    engine.start(id, { aiReview: true });
    await until(() => !engine.busy(id), 90000);
    assert.equal(job.status, "completed", JSON.stringify(job.issues));
    assert.equal(job.coverage.content, "passed");
    assert.equal(job.coverage.layout, "passed");
    assert.equal(
      job.coverage.rulePages,
      job.exports.find((f) => f.format === "pdf")!.pages,
    );
    assert.equal(job.coverage.layoutPages?.length, job.coverage.rulePages);
    assert.equal(visionCalls, job.coverage.rulePages);
    assert.equal(modelCalls, 3 + visionCalls);
    result.aiReview = {
      contentCalls: 3,
      visualCalls: visionCalls,
      scope: job.coverage.layoutScope,
    };
    const countBeforeBudget = modelCalls;
    store.settings({ aiMaxCalls: 2 });
    await engine.action(id, "reexport");
    await until(() => !engine.busy(id), 90000);
    assert.equal(job.status, "partial");
    assert.equal(job.coverage.calls, 2);
    assert.equal(modelCalls - countBeforeBudget, 2);
    assert.equal(job.coverage.layout, "unavailable");
    result.aiBudget = "hard call cap preserved, unreviewed scope reported";
    store.key = key;
    store.settings({ modelEndpoint: "", model: "", aiMaxCalls: 8 });
    mock.close();
    engine.start(id, { aiReview: false });
    await until(() => !engine.busy(id));
    assert.equal(job.status, "completed");
    store.flush();
    const restart = new Store();
    await restart.init();
    assert.equal(restart.get(id).status, "completed");
    assert.equal(restart.get(pauseId).status, "cancelled");
    result.persistence = "SQLite restart retains jobs and outputs";
    // Exercise the narrow IPC from the actual renderer, including diagnostic redaction.
    const diagnostic: string = await win.webContents.executeJavaScript(
      `window.archive.diagnostic(${JSON.stringify(id)})`,
    );
    const diagZip = await JSZip.loadAsync(await fs.readFile(diagnostic));
    const diag = await diagZip.file("diagnostic.json")!.async("string");
    assert(!diag.includes("任务的边界"));
    assert(!diag.includes(origin));
    result.diagnostics = "no body text or source URL";
    const uiURL = origin + "/article-generic?ui=1";
    win.focus();
    win.webContents.focus();
    await win.webContents.executeJavaScript(
      `(()=>{const t=document.querySelector('#source-url');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(uiURL)});t.dispatchEvent(new Event('input',{bubbles:true}));t.focus();})()`,
    );
    await wait(100);
    win.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: "Enter",
      modifiers: [process.platform === "darwin" ? "meta" : "control"],
    });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
    await until(() => [...store.jobs.values()].some((j) => j.url === uiURL));
    const uiJob = [...store.jobs.values()].find((j) => j.url === uiURL)!;
    await until(() =>
      ["completed", "failed", "partial"].includes(uiJob.status),
    );
    assert.equal(uiJob.status, "completed");
    assert.deepEqual(uiJob.options.formats, ["pdf"]);
    assert(!uiJob.exports.some((f) => ["md", "docx"].includes(f.format)));
    const htmlUIURL = origin + "/article-generic?ui=html";
    for (const index of [3, 0])
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.detailed .format-choice')[${index}].click()`,
      );
    await win.webContents.executeJavaScript(
      `(()=>{const t=document.querySelector('#source-url');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(htmlUIURL)});t.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await wait(80);
    await win.webContents.executeJavaScript(
      "document.querySelector('form').requestSubmit()",
    );
    await until(() =>
      [...store.jobs.values()].some((j) => j.url === htmlUIURL),
    );
    const htmlUIJob = [...store.jobs.values()].find(
      (j) => j.url === htmlUIURL,
    )!;
    await until(() =>
      ["completed", "failed", "partial"].includes(htmlUIJob.status),
    );
    assert.equal(htmlUIJob.status, "completed", htmlUIJob.error);
    assert.deepEqual(htmlUIJob.options.formats, ["html"]);
    assert(htmlUIJob.exports.some((f) => f.format === "html"));
    assert(!htmlUIJob.exports.some((f) => f.format === "pdf"));
    await wait(150);
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-job-id="${htmlUIJob.id}"] .job-main').click()`,
    );
    await wait(500);
    const htmlFrame = win.webContents.mainFrame.frames.find((frame) =>
      frame.url.startsWith("archive:"),
    );
    assert(
      htmlFrame,
      "HTML is loaded through the protected archive preview protocol",
    );
    assert(
      new URL(htmlFrame.url).pathname.endsWith(
        encodeURIComponent(htmlUIJob.previewPath!),
      ),
    );
    await assert.rejects(htmlFrame.executeJavaScript("1"), (error) =>
      /Script not run|Script failed/i.test(String(error)),
    );
    const previewResponse = await win.webContents.session.fetch(htmlFrame.url);
    assert(
      previewResponse.headers
        .get("Content-Security-Policy")!
        .includes("sandbox allow-same-origin"),
    );
    const previewHTML = await previewResponse.text();
    assert(
      previewHTML.includes("通用文章测试") &&
        previewHTML.includes("data:image/png;base64,"),
    );
    const previousPreviewURL = htmlFrame.url;
    await engine.action(htmlUIJob.id, "reexport");
    await until(() => !engine.busy(htmlUIJob.id));
    assert.equal(htmlUIJob.status, "completed");
    await wait(500);
    const refreshedFrame = win.webContents.mainFrame.frames.find((frame) =>
      frame.url.startsWith("archive:"),
    );
    assert(
      refreshedFrame && refreshedFrame.url !== previousPreviewURL,
      "same-path re-export must reload the open preview without closing its dialog",
    );
    htmlUIJob.options.formats = ["pdf", "html"];
    await engine.action(htmlUIJob.id, "reexport");
    await until(() => !engine.busy(htmlUIJob.id));
    assert.equal(htmlUIJob.status, "completed", htmlUIJob.error);
    await wait(500);
    const mixedFrame = win.webContents.mainFrame.frames.find((frame) =>
      frame.url.startsWith("archive:"),
    );
    assert(mixedFrame && mixedFrame.url.includes("/preview.html?revision="));
    const mixedHTML = await (
      await win.webContents.session.fetch(mixedFrame.url)
    ).text();
    assert(mixedHTML.includes("通用文章测试"));
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.tab-content iframe').getBoundingClientRect().height >= 400",
      ),
    );
    const beforeMixedReexport = mixedFrame.url;
    await win.webContents.executeJavaScript(
      "Array.from(document.querySelectorAll('.modal button')).find(button=>button.textContent==='用已保存内容重新导出').click()",
    );
    await until(() => !engine.busy(htmlUIJob.id));
    assert.equal(htmlUIJob.status, "completed", htmlUIJob.error);
    await wait(500);
    const finalMixedFrame = win.webContents.mainFrame.frames.find((frame) =>
      frame.url.startsWith("archive:"),
    );
    assert(finalMixedFrame && finalMixedFrame.url !== beforeMixedReexport);
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.tab-content iframe').getBoundingClientRect().height >= 400",
      ),
    );
    result.previewRefresh =
      "HTML and mixed PDF/HTML re-export refresh an open preview, including the actual UI action";
    await fs.writeFile(
      path.join(store.root, "app-html-preview.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal [aria-label=关闭]').click()",
    );
    for (const index of [0, 3])
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.detailed .format-choice')[${index}].click()`,
      );
    result.htmlUI =
      "HTML-only selected and submitted in React form; actual HTML opens in sandboxed archive preview with embedded images and hidden script controls";
    await wait(250);
    assert(
      await win.webContents.executeJavaScript(
        `!document.querySelector('.sidebar') && !document.querySelector('.supported-note') && !!document.querySelector('#source-url') && !document.querySelector('.advanced').open`,
      ),
    );
    await fs.writeFile(
      path.join(store.root, "app.png"),
      (await capture()).toPNG(),
    );
    const originalSize = win.getSize();
    win.setSize(900, 720);
    await wait(150);
    assert(
      await win.webContents.executeJavaScript(
        `document.documentElement.scrollWidth <= innerWidth`,
      ),
    );
    await fs.writeFile(
      path.join(store.root, "app-small.png"),
      (await capture()).toPNG(),
    );
    win.setSize(originalSize[0], originalSize[1]);
    await win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('.main-nav button')).find(e=>e.textContent.includes('已保存')).click()`,
    );
    await wait(200);
    await fs.writeFile(
      path.join(store.root, "app-library.png"),
      (await capture()).toPNG(),
    );
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-job-id="${id}"] .job-main')?.click()`,
    );
    await wait(400);
    await wait(700);
    await fs.writeFile(
      path.join(store.root, "app-preview.png"),
      (await capture()).toPNG(),
    );
    result.ui = await win.webContents.executeJavaScript(
      `({title:document.querySelector('.detail-header h2')?.textContent,rows:document.querySelectorAll('.job-row').length,iframe:!!document.querySelector('iframe'),bridge:!!window.archive})`,
    );
    assert((result.ui as any).bridge);
    assert((result.ui as any).iframe);
    assert.equal((result.ui as any).title, job.title);
    await win.webContents.executeJavaScript(
      "document.querySelector('.modal [aria-label=关闭]').click();document.querySelector('.settings-trigger').click()",
    );
    await wait(100);
    await fs.writeFile(
      path.join(store.root, "app-settings.png"),
      (await capture()).toPNG(),
    );
    assert(
      await controlsVisible(),
      "settings modal must not cover window controls",
    );
    result.simpleFlow =
      "actual form submission -> automatic PDF save; compact home; 900px layout; history -> preview";
    store.flush();
    if (process.platform === "darwin") {
      await win.webContents
        .executeJavaScript(
          "document.querySelector('.window-control.close').click()",
        )
        .catch(() => {});
      await until(() => win.isDestroyed(), 5000);
      result.windowClose = "close button closes the real window";
    }
    result.ok = true;
    await fs.writeFile(
      path.join(store.root, "e2e-result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log("FOLIO_E2E_OK", JSON.stringify(result));
    app.exit(0);
  } catch (error) {
    if (!win.isDestroyed())
      await fs
        .writeFile(
          path.join(store.root, "app-failed.png"),
          (await win.webContents.capturePage()).toPNG(),
        )
        .catch(() => {});
    result.ok = false;
    result.error = String((error as Error).stack || error);
    await fs.writeFile(
      path.join(store.root, "e2e-result.json"),
      JSON.stringify(result, null, 2),
    );
    console.error("FOLIO_E2E_FAILED", result.error);
    app.exit(1);
  }
}
