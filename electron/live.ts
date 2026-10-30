import { app, type BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import * as cheerio from "cheerio";
import type { Store } from "./store";
import type { Engine } from "./engine";
import { wait } from "./core";
import { PDFLayout } from "./pdf-layout";
export async function runLive(
  store: Store,
  engine: Engine,
  window: BrowserWindow,
) {
  const urls: string[] = JSON.parse(process.env.FOLIO_SMOKE_URLS || "[]");
  const wholeBook = process.env.FOLIO_SMOKE_ALL_CHAPTERS === "1";
  const cases: {
    name: string;
    url: string;
    minChars?: number;
    required?: string[];
    minImages?: number;
    minCodeBlocks?: number;
    forbidden?: string[];
  }[] = JSON.parse(process.env.FOLIO_SMOKE_CASES || "[]");
  const ids = await engine.create(urls);
  const results: unknown[] = [];
  for (const id of ids) {
    const j = store.get(id);
    let deadline = Date.now() + 90000;
    while (j.status === "inspecting" && Date.now() < deadline) await wait(150);
    if (j.status === "ready") {
      j.chapters.forEach((c, i) => (c.selected = wholeBook || i === 0));
      engine.start(id, {
        formats: ["pdf", "docx", "md", "html"],
        aiReview: false,
      });
      deadline = Date.now() + (wholeBook ? 600000 : 180000);
      while (engine.busy(id) && Date.now() < deadline) await wait(150);
    }
    const testCase = cases.find((c) => c.url === j.url);
    const text = j.chapters
      .flatMap((c) => c.blocks)
      .map((b) => b.text)
      .join("\n");
    const assets = j.chapters.flatMap((c) => c.assets);
    const failures: string[] = [];
    const exportChecks: { format: string; textChars: number }[] = [];
    if (testCase) {
      if (!["completed", "partial"].includes(j.status))
        failures.push(`任务状态：${j.status}`);
      if (!wholeBook && j.chapters.length !== 1)
        failures.push(`单篇文章错误识别为 ${j.chapters.length} 章`);
      if (
        wholeBook &&
        (!j.reconciliation ||
          j.reconciliation.verified !== j.chapters.length ||
          j.discovery?.status !== "observed")
      )
        failures.push("整套目录或章节末尾尚未全部核对通过");
      if (text.length < (testCase.minChars || 0))
        failures.push(`正文仅 ${text.length} 字符`);
      const normalize = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
      for (const marker of testCase.required || [])
        if (!normalize(text).includes(normalize(marker)))
          failures.push(`缺少正文标记：${marker}`);
      for (const marker of testCase.forbidden || [])
        if (normalize(text).includes(normalize(marker)))
          failures.push(`混入页面辅助内容：${marker}`);
      if (
        assets.filter((a) => a.status === "ready").length <
        (testCase.minImages || 0)
      )
        failures.push("正文图片数量不足");
      if (assets.some((a) => a.status === "failed"))
        failures.push("有图片未保存");
      if (
        j.chapters.flatMap((c) => c.blocks).filter((b) => b.type === "code")
          .length < (testCase.minCodeBlocks || 0)
      )
        failures.push("正文代码块数量不足");
      if (
        j.issues.some(
          (i) =>
            !i.resolved &&
            [
              "scroll-limit",
              "layout-page-overflow",
              "layout-text-overflow",
              "layout-blank-page",
              "layout-orphan-heading",
              "layout-rule-unavailable",
            ].includes(i.code),
        )
      )
        failures.push("存在滚动截断或文字越界");
      for (const format of ["pdf", "docx", "md", "html"]) {
        const file = j.exports.find((f) => f.format === format);
        if (
          !file ||
          (await fs.stat(file.path).catch(() => ({ size: 0 }))).size < 100
        ) {
          failures.push(`${format} 文件缺失或为空`);
          continue;
        }
        try {
          let exported: string;
          if (format === "pdf") {
            const pdf = new PDFLayout();
            try {
              await pdf.load(file.path);
              exported = await pdf.text();
            } finally {
              pdf.close();
            }
          } else if (format === "docx") {
            const zip = await JSZip.loadAsync(await fs.readFile(file.path));
            const xml = await zip.file("word/document.xml")!.async("string");
            const $ = cheerio.load(xml, { xmlMode: true });
            exported = $("w\\:t")
              .map((_i, t) => $(t).text())
              .get()
              .join(" ");
          } else if (format === "html") {
            const $ = cheerio.load(await fs.readFile(file.path, "utf8"));
            $("script,style").remove();
            exported = $("body").text();
            if (
              $(".chapter li")
                .toArray()
                .some(
                  (li) =>
                    !$(li)
                      .text()
                      .replace(/[\s\u200b-\u200f\ufeff]/g, ""),
                )
            )
              failures.push("HTML 含空列表项");
          } else exported = await fs.readFile(file.path, "utf8");
          exportChecks.push({ format, textChars: exported.length });
          const compact = (s: string) =>
            s
              .normalize("NFKC")
              .replace(/[\s*_`\\#]/g, "")
              .toLowerCase();
          for (const marker of testCase.required || [])
            if (!compact(exported).includes(compact(marker)))
              failures.push(`${format} 文件缺少正文标记：${marker}`);
          for (const marker of testCase.forbidden || [])
            if (compact(exported).includes(compact(marker)))
              failures.push(`${format} 文件混入页面辅助内容：${marker}`);
          if (
            (format === "pdf" || format === "html") &&
            exported.includes("保存于")
          )
            failures.push(`${format} 阅读区域混入保存日期`);
        } catch (error) {
          failures.push(`${format} 文件读取失败：${String(error)}`);
        }
      }
    }
    const result = {
      name: testCase?.name,
      jobId: id,
      title: j.title,
      host: new URL(j.url).hostname,
      status: j.status,
      source: j.source,
      discovered: j.chapters.length,
      captured: j.chapters.filter((c) => c.blocks.length).length,
      blocks: j.chapters.reduce((s, c) => s + c.blocks.length, 0),
      assets: j.chapters.reduce(
        (s, c) => s + c.assets.filter((a) => a.status === "ready").length,
        0,
      ),
      issueCodes: j.issues.map((i) => i.code),
      formats: j.exports.map((f) => f.format),
      pages: j.exports.find((f) => f.format === "pdf")?.pages,
      error: j.error,
      textChars: text.length,
      codeBlocks: j.chapters
        .flatMap((c) => c.blocks)
        .filter((b) => b.type === "code").length,
      tables: j.chapters
        .flatMap((c) => c.blocks)
        .filter((b) => b.type === "table").length,
      discovery: j.discovery,
      reconciliation: j.reconciliation,
      coverage: j.coverage,
      checks: testCase
        ? { passed: failures.length === 0, failures, exports: exportChecks }
        : undefined,
    };
    results.push(result);
    await fs.writeFile(
      path.join(store.root, "live-result.json"),
      JSON.stringify(results, null, 2),
    );
    console.log("SITE_RESULT", JSON.stringify(result));
  }
  await fs.writeFile(
    path.join(store.root, "live-result.json"),
    JSON.stringify(results, null, 2),
  );
  await fs.writeFile(
    path.join(store.root, "live-app.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  console.log("LIVE_SMOKE", JSON.stringify(results));
  store.flush();
  app.exit(0);
}
