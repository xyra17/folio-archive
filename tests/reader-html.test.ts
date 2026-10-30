import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { assertOptions, createJob, defaults } from "../electron/core";
import { readerHTML } from "../electron/reader-html";
import type { Block } from "../shared/types";

function sample(blocks: Block[]) {
  const job = createJob("https://example.com/article?token=private", "/tmp");
  job.title = "阅读与整理";
  job.chapters = [
    {
      id: "c",
      title: job.title,
      url: job.url,
      selected: true,
      status: "ready",
      blocks,
      assets: [],
    },
  ];
  return job;
}

test("HTML format is accepted without changing existing export defaults", () => {
  assert.deepEqual(assertOptions({ ...defaults, formats: ["html"] }).formats, [
    "html",
  ]);
  assert.throws(() =>
    assertOptions({ ...defaults, formats: ["invalid" as "html"] }),
  );
  assert.deepEqual(defaults.formats, ["pdf", "docx", "md"]);
});

test("reader headings have unique anchors and preserve selected chapter order", async () => {
  const job = sample([
    { id: "same", type: "heading", level: 2, text: "重复标题" },
    { id: "same", type: "heading", level: 3, text: "子节" },
    { id: "same", type: "heading", level: 2, text: "重复标题" },
  ]);
  job.chapters.push({
    ...job.chapters[0],
    id: "skip",
    selected: false,
    blocks: [{ id: "x", type: "paragraph", text: "排除正文" }],
  });
  const $ = cheerio.load(await readerHTML(job));
  const ids = $(".chapter :header")
    .map((_, el) => $(el).attr("id"))
    .get();
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(
    $(".contents nav a")
      .map((_, el) => $(el).attr("href"))
      .get(),
    ids.map((id) => `#${id}`),
  );
  assert.equal($(".contents a[data-depth='1']").text(), "01子节");
  assert(!$("main").text().includes("排除正文"));
});

test("reader sanitizes source markup, preserves code, and pins only its fixed script", async () => {
  const code = '  <script>alert("example")</script>\nconst value = `a & b`;\n';
  const job = sample([
    {
      id: "p",
      type: "paragraph",
      text: "正文",
      html: '<strong>正文</strong><script>alert(1)</script><img src="https://evil.test/a"><a href="javascript:alert(1)" onclick="alert(2)">链接</a>',
    },
    {
      id: "c",
      type: "code",
      text: code,
      language: 'html"><img onerror="alert(1)">',
    },
    {
      id: "t",
      type: "table",
      text: "表格",
      rows: [["标题"], ["<script>bad()</script>"]],
    },
    { id: "m", type: "math", text: "E = mc^2" },
  ]);
  job.title = '<img src=x onerror="alert(1)">';
  const html = await readerHTML(job);
  const $ = cheerio.load(html);
  assert.equal($("script").length, 1);
  assert.equal($("[onclick],[onerror],img,iframe,link").length, 0);
  assert.equal($("pre code").text(), code);
  assert.equal($("td").text(), "<script>bad()</script>");
  assert.equal($("h1").text(), job.title);
  assert.equal($("math").length, 1);
  assert(!$("main").html()!.includes("javascript:"));
  const hash = createHash("sha256").update($("script").text()).digest("base64");
  assert(
    $("meta[http-equiv='Content-Security-Policy']")
      .attr("content")!
      .includes(`script-src 'sha256-${hash}'`),
  );
  assert.equal($("[data-enhanced]:not([hidden])").length, 0);
  assert(!$("footer").text().includes("token=private"));
});

test("HTML embeds saved images and refuses paths outside the archive including symlinks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "folio-html-"));
  try {
    const dir = path.join(root, "archive");
    await fs.mkdir(dir);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/pkAAAAASUVORK5CYII=",
      "base64",
    );
    await fs.writeFile(path.join(dir, "image.png"), png);
    const job = sample([
      { id: "i", type: "image", text: "图注", assetId: "a" },
    ]);
    job.outputDir = dir;
    job.chapters[0].assets = [
      {
        id: "a",
        chapterId: "c",
        url: "https://example.com/a.png",
        path: "image.png",
        status: "ready",
      },
    ];
    const html = await readerHTML(job);
    const $ = cheerio.load(html);
    assert.equal(
      $("img").attr("src"),
      `data:image/png;base64,${png.toString("base64")}`,
    );
    assert(!html.includes(root));
    assert.equal($("figcaption").text(), "图注");
    job.chapters[0].assets[0].path = "../outside.png";
    await fs.writeFile(path.join(root, "outside.png"), png);
    await assert.rejects(readerHTML(job), /超出归档目录/);
    await fs.symlink(
      path.join(root, "outside.png"),
      path.join(dir, "escape.png"),
    );
    job.chapters[0].assets[0].path = "escape.png";
    await assert.rejects(readerHTML(job), /超出归档目录/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("plain articles avoid an empty table of contents and failed images stay explicit", async () => {
  const job = sample([
    { id: "p", type: "paragraph", text: "一篇没有小标题的短文。" },
    { id: "missing", type: "image", assetId: "none", text: "图片说明" },
  ]);
  const $ = cheerio.load(await readerHTML(job));
  assert.equal($(".contents").length, 0);
  assert.equal($(".reading-layout.no-contents").length, 1);
  assert($(".missing").text().includes("图片未保存"));
  assert($("main").text().includes("一篇没有小标题的短文。"));
});

test("reader places contents before the article and keeps save timestamps in the archive report only", async () => {
  const job = sample([
    { id: "h", type: "heading", level: 2, text: "正文小节" },
    {
      id: "empty",
      type: "list",
      text: "",
      items: ["", "&nbsp;<br>", "\u200b"],
    },
    {
      id: "mixed",
      type: "list",
      text: "有效条目",
      items: ["", "<strong>有效条目</strong>"],
    },
  ]);
  const $ = cheerio.load(await readerHTML(job));
  assert.equal(
    $(".reading-layout").children().first().attr("class"),
    "contents",
  );
  assert.equal($(".chapter li").length, 1);
  assert.equal($(".chapter li").text(), "有效条目");
  assert.equal($(".chapter ul").length, 1);
  assert(!$("body").text().includes("保存于"));
  assert(!$(".document-meta time").length);
});
