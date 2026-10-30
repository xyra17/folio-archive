import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow } from "electron";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import type { Job } from "../shared/types";
import { exportJob } from "./export";
import { readerHTML } from "./reader-html";
import { templateSample } from "./template-preview";
import { wait, uid } from "./core";
import { PDFLayout } from "./pdf-layout";

export async function runReaderE2E(root: string, source: Job) {
  const dir = path.join(root, "html-reader");
  await fs.mkdir(dir, { recursive: true });
  const sample = templateSample("reading", dir);
  sample.outputDir = dir;
  sample.title = sample.chapters[0].title = "让好内容，随时可读";
  sample.options.formats = ["html"];
  const blocks = sample.chapters[0].blocks;
  blocks[0].text =
    "从一篇文章开始，建立属于自己的离线资料库。无论是工作中反复查阅的指南，还是想慢慢读完的长文，都可以保留原文的结构，用更适合阅读的方式重新打开。";
  blocks
    .find((b) => b.type === "table")!
    .rows!.push(["HTML", "直接打开，离线阅读与分享"]);
  blocks.find((b) => b.type === "code")!.text =
    'const archive = {\n  title: "值得反复阅读的文章",\n  formats: ["pdf", "docx", "md", "html"],\n  offline: true\n};\n\n// 内容只保存一次，可以生成多种格式。\nawait save(archive);';
  blocks.push(
    { id: "h3", type: "heading", level: 2, text: "长文也可以轻松定位" },
    {
      id: "p4",
      type: "paragraph",
      text: "章节目录会根据正文标题自动生成。大屏幕上，它停留在左侧；切换到手机，目录收进文章上方，需要时再展开。页面顶部的细线记录当前阅读位置。",
    },
    { id: "sub", type: "heading", level: 3, text: "原文结构，完整保留" },
    {
      id: "list",
      type: "list",
      text: "保留结构",
      items: [
        "标题保留清晰的层级，段落保持原有顺序。",
        "代码保留缩进与换行，点击按钮即可复制。",
        "表格在窄屏内独立滚动，阅读正文不受影响。",
      ],
    },
    { id: "h4", type: "heading", level: 2, text: "把阅读带到离线" },
    {
      id: "p5",
      type: "paragraph",
      text: "成功保存的图片直接嵌入 HTML。把这一个文件移到另一个文件夹，或发送到另一台电脑，正文与图片仍然可以一起打开；页面也不需要额外下载字体、样式或脚本。",
    },
    { id: "h5", type: "heading", level: 2, text: "阅读之外，继续使用" },
    {
      id: "p6",
      type: "paragraph",
      text: "需要做笔记时，选择 Markdown；需要继续编辑，选择 Word；需要固定纸张版式，选择 PDF。HTML 则适合随时打开、快速定位和离线阅读，浅色与深色阅读也可以随手切换。",
    },
    {
      id: "end",
      type: "paragraph",
      text: "每一份整理，都是为了下一次更容易找到。",
    },
  );
  let reviewCount = 0;
  sample.exports = await exportJob(
    sample,
    new AbortController().signal,
    () => {},
    async (file) => {
      assert(file.endsWith("preview.png"));
      assert((await fs.stat(file)).size > 1000);
      reviewCount++;
    },
  );
  assert.equal(reviewCount, 1);
  const sampleFile = sample.exports.find((f) => f.format === "html")!;
  assert.equal(sample.previewPath, sampleFile.name);
  assert(!sample.exports.some((f) => f.format === "pdf"));
  const zip = await JSZip.loadAsync(
    await fs.readFile(sample.exports.find((f) => f.format === "zip")!.path),
  );
  assert(zip.file(sampleFile.name));

  // Copy only the HTML, deliberately leaving all asset folders behind.
  const standalone = path.join(dir, "standalone.html");
  const sourceFile = source.exports.find((f) => f.format === "html")!;
  await fs.copyFile(sourceFile.path, standalone);
  assert.equal(
    source.previewPath,
    "preview.html",
    "mixed PDF + HTML keeps its paper preview",
  );
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: `reader-${uid()}`,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  let remoteRequests = 0;
  const errors: string[] = [];
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") errors.push(details.message);
  });
  win.webContents.session.webRequest.onBeforeRequest((details, done) => {
    const remote = /^https?:/.test(details.url);
    if (remote) remoteRequests++;
    done({ cancel: remote });
  });
  const ready = () =>
    win.webContents.executeJavaScript(
      "document.fonts.ready.then(()=>Promise.all(Array.from(document.images).map(i=>i.decode())))",
    );
  const capture = async (name: string) => {
    await wait(180);
    await win.webContents.executeJavaScript(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    await fs.writeFile(
      path.join(dir, name),
      (await win.webContents.capturePage()).toPNG(),
    );
  };
  try {
    await win.loadFile(standalone);
    await ready();
    assert(
      await win.webContents.executeJavaScript(
        "document.images.length>0 && Array.from(document.images).every(i=>i.src.startsWith('data:image/')&&i.naturalWidth>0)",
      ),
    );
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.contents').open && document.querySelector('.contents').getBoundingClientRect().right < document.querySelector('.article').getBoundingClientRect().left && document.documentElement.scrollWidth<=innerWidth",
      ),
    );
    await win.webContents.executeJavaScript(
      "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text}}});document.querySelector('[data-action=copy]').click()",
    );
    await wait(50);
    const firstCode = source.chapters
      .filter((c) => c.selected)
      .flatMap((c) => c.blocks)
      .find((b) => b.type === "code")!.text;
    assert.equal(
      await win.webContents.executeJavaScript("window.__copied"),
      firstCode,
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        "document.querySelector('[data-action=copy]').textContent",
      ),
      "已复制",
    );

    await win.loadFile(sampleFile.path);
    await ready();
    await capture("reader-desktop.png");
    await win.webContents.executeJavaScript(
      "document.querySelector('[data-action=theme]').click()",
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        "document.documentElement.dataset.theme",
      ),
      "dark",
    );
    await capture("reader-dark.png");
    await win.webContents.executeJavaScript(
      "document.querySelector('[data-action=theme]').click()",
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.code-block').scrollIntoView({block:'center'})",
    );
    await capture("reader-code.png");

    win.setSize(390, 844);
    await wait(120);
    await win.webContents.executeJavaScript("scrollTo(0,0)");
    assert(
      await win.webContents.executeJavaScript(
        "!document.querySelector('.contents').open && document.documentElement.scrollWidth<=innerWidth",
      ),
    );
    await capture("reader-mobile.png");
    await win.webContents.executeJavaScript(
      "document.querySelector('.contents summary').click()",
    );
    assert(
      await win.webContents.executeJavaScript(
        "document.querySelector('.contents').open",
      ),
    );
    await win.webContents.executeJavaScript(
      "Array.from(document.querySelectorAll('.contents a')).at(-1).click()",
    );
    await wait(80);
    assert(
      await win.webContents.executeJavaScript(
        "!document.querySelector('.contents').open && location.hash==='#'+Array.from(document.querySelectorAll('.chapter :is(h2,h3,h4,h5,h6)')).at(-1).id && !!document.querySelector('.contents a[aria-current]')",
      ),
    );

    // Stress the actual browser with a wide table, long code and a long title.
    const stress: Job = structuredClone(sample);
    stress.title =
      "一个比较长的标题：包含中文与 English、代码、宽表格和多章节的离线资料阅读与打印检查";
    stress.chapters[0].blocks.push(
      {
        id: "wide",
        type: "table",
        text: "宽表格",
        rows: [
          ["列1", "列2", "列3", "列4", "列5", "列6"],
          ["内容", "结构", "图片", "正文", "代码", "打印"],
        ],
      },
      {
        id: "long",
        type: "code",
        language: "text",
        text: Array.from(
          { length: 70 },
          (_, i) =>
            `${String(i + 1).padStart(2, "0")}  ${"long-line-".repeat(15)}`,
        ).join("\n"),
      },
      { id: "last", type: "paragraph", text: "HTML-STRESS-END-7693" },
    );
    await fs.writeFile(path.join(dir, "stress.html"), await readerHTML(stress));
    await win.loadFile(path.join(dir, "stress.html"));
    await ready();
    assert(
      await win.webContents.executeJavaScript(
        "document.documentElement.scrollWidth<=innerWidth && document.querySelector('.table-scroll.wide').scrollWidth>document.querySelector('.table-scroll.wide').clientWidth && Array.from(document.querySelectorAll('pre')).some(p=>p.scrollWidth>p.clientWidth) && document.querySelector('main').textContent.includes('HTML-STRESS-END-7693')",
      ),
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('.table-scroll.wide').scrollIntoView({block:'center'})",
    );
    await capture("reader-mobile-table.png");
    const bytes = await win.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    assert((await PDFDocument.load(bytes)).getPageCount() >= 3);
    await fs.writeFile(path.join(dir, "reader-print.pdf"), bytes);
    const print = new PDFLayout();
    try {
      const pages = await print.load(path.join(dir, "reader-print.pdf"));
      const text = await print.text();
      assert(text.includes("HTML-STRESS-END-7693"));
      assert(text.includes("70"));
      await fs.writeFile(
        path.join(dir, "reader-print-first.png"),
        await print.page(1),
      );
      await fs.writeFile(
        path.join(dir, "reader-print-last.png"),
        await print.page(pages),
      );
    } finally {
      print.close();
    }
    assert.equal(remoteRequests, 0);
    assert.deepEqual(errors, []);
  } finally {
    win.webContents.session.webRequest.onBeforeRequest(null);
    win.destroy();
  }

  const reserved = structuredClone(sample);
  reserved.title = "preview";
  reserved.exports = await exportJob(
    reserved,
    new AbortController().signal,
    () => {},
  );
  assert.equal(reserved.previewPath, "preview_网页.html");
  assert(reserved.exports.some((f) => f.name === "preview_网页.html"));
  return {
    standalone,
    sample: sampleFile.path,
    remoteRequests,
    assertions:
      "HTML-only export and preview; mixed PDF preview; ZIP; standalone image decode offline; CSP; real copy handler; dark mode; mobile TOC navigation; wide tables and long code; printed PDF text including final marker; reserved filename",
  };
}
