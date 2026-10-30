import { repairLayout, applyPDFRepair } from "./layout-repair";
import { chapterTitle } from "../shared/chapters";
import { PDFLayout } from "./pdf-layout";
import { archiveNotice } from "./completeness";
import { BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import JSZip from "jszip";
import katex from "katex";
import Turndown from "turndown";
import { PDFDocument } from "pdf-lib";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
  AlignmentType,
  Footer,
  PageNumber,
  TableOfContents,
  BorderStyle,
  Bookmark,
  InternalHyperlink,
  VerticalAlign,
} from "docx";
import type {
  Job,
  Block,
  Asset,
  ExportFile,
  TemplateId,
} from "../shared/types";
import { templateFor } from "../shared/templates";
import { readerHTML } from "./reader-html";
import {
  atomicWrite,
  cleanListItems,
  escapeHTML as e,
  redactURL,
  safeName,
  issue,
  uid,
} from "./core";

const pageCSS = `
  *{box-sizing:border-box}html{background:#edf0f2}
  body{margin:0 auto;max-width:210mm;min-height:297mm;background:white;color:#263039;padding:var(--page-top,18mm) var(--page-inset,20mm) 20mm;overflow-wrap:anywhere;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  h1,h2,h3,h4,h5,h6{color:#171c20;line-height:1.4;font-weight:600;text-wrap:balance;break-after:avoid;page-break-after:avoid}
  .document-title{margin:14px 0 16px;line-height:1.3}
  .document-header{break-inside:avoid}
  .eyebrow{display:flex;align-items:center;gap:9px;font:500 8pt/1.4 "PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:.08em;color:var(--accent);overflow-wrap:anywhere}
  .meta{display:flex;flex-wrap:wrap;gap:5px 16px;font:8pt/1.7 "PingFang SC","Microsoft YaHei",sans-serif;color:#66717a;letter-spacing:.015em}
  .meta time{font-variant-numeric:tabular-nums}
  h2{font-size:17pt;margin:30px 0 12px}h3{font-size:14pt;margin:26px 0 10px}h4,h5,h6{font-size:11.5pt;margin:22px 0 8px}
  p{margin:0 0 12px;text-wrap:pretty}p,li{orphans:3;widows:3}strong{font-weight:600}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  ul,ol{padding-left:1.5em;margin:10px 0 16px}li{padding-left:.2em;margin:5px 0}li::marker{color:var(--accent)}
  img{display:block;max-width:100%;height:auto;max-height:245mm;object-fit:contain;margin:0 auto;break-inside:avoid}
  figure{margin:22px 0;break-inside:avoid}figcaption{font:8pt/1.65 "PingFang SC",sans-serif;color:#68727a;text-align:center;margin-top:9px}
  .code-block{margin:16px 0 18px;background:var(--code-bg);border-radius:5px}.code-block.short{break-inside:avoid}
  .code-label{display:block;padding:7px 15px 6px;border-bottom:1px solid #0000000a;color:#5d6975;font:7pt/1.4 Menlo,Consolas,monospace;letter-spacing:.04em;break-after:avoid}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:13px 15px 15px;color:var(--code-ink);font:8.5pt/1.7 Menlo,Consolas,monospace;tab-size:2}code{font-family:Menlo,Consolas,monospace;font-size:.88em}pre code{font:inherit}p code,li code,td code{background:var(--code-bg);padding:.1em .3em;border-radius:3px}
  blockquote{margin:20px 0;padding:0 18px;color:#52616a;font-style:normal}blockquote p:last-child{margin-bottom:0}
  table{border-collapse:collapse;width:100%;font-size:9pt;line-height:1.65;margin:18px 0 20px;table-layout:fixed;font-variant-numeric:tabular-nums}
  td,th{border:0;border-bottom:1px solid #dfe4e7;padding:9px 12px;vertical-align:middle;overflow-wrap:anywhere}th{background:var(--tint);text-align:left;font-weight:600}thead{display:table-header-group}tr{break-inside:avoid}
  .toc{font:9pt/1.6 "PingFang SC",sans-serif;margin:24px 0 32px;padding:20px 22px;background:#f6f8f9}.toc-label{font-weight:600;font-size:10pt;color:#171c20;margin-bottom:12px}.toc a{display:flex;gap:12px;padding:7px 0;border-bottom:1px solid #0000000b;color:#34414a}.toc a:last-child{border:0}.toc-index{font:8pt/1.8 Menlo,monospace;color:#77818a}
  .chapter{break-before:page}.chapter:first-of-type{break-before:auto}.chapter>h2:first-child{margin-top:0}.chapter-source{font:7.5pt/1.7 "PingFang SC",sans-serif;color:#6d7780;margin:0 0 22px}
  .document-end{margin-top:8px;padding-top:4px;border-top:1px solid #dfe4e7;font:7pt/1.4 "PingFang SC",sans-serif;color:#6d7780;overflow-wrap:anywhere;break-inside:avoid}.document-end a{color:inherit}.document-end p{margin:0 0 3px}
  .missing{font-size:9pt;padding:12px;border:1px dashed #be8555;color:#8b5b31}.report{break-before:page;font-size:9pt}math{font-size:1.1em}hr{border:0;border-top:1px solid #dfe4e7;margin:26px 0}
  @page{size:A4;margin:18mm 20mm 20mm}
  @media print{html{background:white}body{max-width:none;min-height:0;padding:0}.toc{background:white}a{color:inherit}}
`;
function chapterBlocks(c: Job["chapters"][number]) {
  return c.blocks[0]?.type === "heading" &&
    c.blocks[0].text.trim() === c.title.trim()
    ? c.blocks.slice(1)
    : c.blocks;
}
function assetMap(job: Job) {
  return new Map(job.chapters.flatMap((c) => c.assets).map((a) => [a.id, a]));
}
function tableWidths(rows: string[][]): number[] {
  const count = Math.max(0, ...rows.map((r) => r.length));
  const weights = Array.from({ length: count }, (_, column) => {
    const length = Math.max(
      0,
      ...rows.map((row) =>
        Array.from(row[column] || "").reduce(
          (total, char) => total + (char.charCodeAt(0) > 255 ? 2 : 1),
          0,
        ),
      ),
    );
    return Math.min(48, Math.max(10, length + 6));
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (weight / total) * 100);
}
function blockHTML(
  b: Block,
  assets: Map<string, Asset>,
  headingOffset = 0,
  base = "https://example.invalid/",
): string {
  const text = b.html || e(b.text);
  switch (b.type) {
    case "heading":
      return `<h${Math.min(6, Math.max(2, (b.level || 2) + headingOffset))} id="b-${e(b.id)}">${text}</h${Math.min(6, Math.max(2, (b.level || 2) + headingOffset))}>`;
    case "paragraph":
      return `<p>${text}</p>`;
    case "quote":
      return `<blockquote>${text}</blockquote>`;
    case "list": {
      const items = cleanListItems(b.items || [], base);
      return items.length
        ? `<${b.ordered ? "ol" : "ul"}>${items.map((i) => `<li>${i}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`
        : "";
    }
    case "code":
      return `<div class="code-block${b.text.split("\n").length <= 18 ? " short" : ""}">${b.language ? `<span class="code-label">${e(b.language)}</span>` : ""}<pre><code>${e(b.text)}</code></pre></div>`;
    case "table":
      return `<table><colgroup>${tableWidths(b.rows || [])
        .map((width) => `<col style="width:${width.toFixed(2)}%">`)
        .join(
          "",
        )}</colgroup><thead><tr>${(b.rows?.[0] || []).map((c) => `<th scope="col">${e(c)}</th>`).join("")}</tr></thead><tbody>${(b.rows?.slice(1) || []).map((r) => `<tr>${r.map((c) => `<td>${e(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    case "image": {
      const a = assets.get(b.assetId!);
      return a?.status === "ready" && a.path
        ? `<figure><img src="${e(a.path)}" alt="${e(b.text)}">${b.text ? `<figcaption>${e(b.text)}</figcaption>` : ""}</figure>`
        : `<p class="missing">[图片未保存] ${e(b.text)}</p>`;
    }
    case "math":
      return katex.renderToString(b.text, {
        throwOnError: false,
        output: "mathml",
        displayMode: true,
      });
    case "divider":
      return "<hr>";
  }
}
export function documentHTML(job: Job): string {
  const chapters = job.chapters.filter(
    (c) => c.selected && c.status !== "failed" && c.blocks.length,
  );
  const assets = assetMap(job);
  const authors = [...new Set(chapters.map((c) => c.author).filter(Boolean))];
  const theme = templateFor(job.options.template);

  const host = new URL(job.url).hostname.replace(/^www\./, "");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file: archive: data:; style-src 'unsafe-inline'; font-src 'self'; base-uri 'none'"><title>${e(job.title)}</title><style>${pageCSS}${theme.css}${chapters.length > 1 ? ".chapter:first-of-type{break-before:page}" : ""}</style></head><body data-template="${theme.id}"><header class="document-header"><div class="eyebrow"><a href="${e(redactURL(job.url))}">${e(host)}</a></div><h1 class="document-title">${e(job.title)}</h1>${authors.length || chapters.length > 1 ? `<div class="meta">${authors.length ? `<span>${e(authors.join("、"))}</span>` : ""}${chapters.length > 1 ? `<span>${chapters.length} 个章节</span>` : ""}</div>` : ""}</header>${archiveNotice(job) ? `<p class="missing">${e(archiveNotice(job))}</p>` : ""}${chapters.length > 1 ? `<nav class="toc" aria-label="目录"><div class="toc-label">目录</div>${chapters.map((c, i) => `<a href="#chapter-${e(c.id)}"><span class="toc-index">${e(chapters.some((c) => c.sourceNumber) ? c.sourceNumber || "" : String(i + 1).padStart(2, "0"))}</span><span>${e(c.title)}</span></a>`).join("")}</nav>` : ""}${chapters
    .map(
      (c) =>
        `<section class="chapter" id="chapter-${e(c.id)}">${chapters.length > 1 || c.title !== job.title ? `<h2>${e(chapterTitle(c))}</h2><p class="chapter-source">${e(redactURL(c.url))}</p>` : ""}${chapterBlocks(
          c,
        )
          .map((b) => blockHTML(b, assets, chapters.length > 1 ? 1 : 0, c.url))
          .join("\n")}</section>`,
    )
    .join("")}</body></html>`;
}
const turndown = new Turndown({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
function inlineMD(b: Block) {
  return b.html ? turndown.turndown(b.html) : b.text;
}
export function documentMD(job: Job): string {
  const assets = assetMap(job);
  let s = `# ${job.title}\n\n> 来源：${redactURL(job.url)}\n> 获取时间：${job.updatedAt}\n\n`;
  for (const c of job.chapters.filter(
    (c) => c.selected && c.status !== "failed" && c.blocks.length,
  )) {
    s += `## ${chapterTitle(c)}\n\n`;
    for (const b of chapterBlocks(c)) {
      switch (b.type) {
        case "heading":
          s += `${"#".repeat(Math.min(6, Math.max(2, (b.level || 2) + 1)))} ${inlineMD(b)}`;
          break;
        case "paragraph":
          s += inlineMD(b);
          break;
        case "quote":
          s += inlineMD(b)
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n");
          break;
        case "code": {
          const fence = "`".repeat(
            Math.max(
              3,
              ...[...b.text.matchAll(/`+/g)].map((m) => m[0].length + 1),
            ),
          );
          s += `${fence}${b.language || ""}\n${b.text}\n${fence}`;
          break;
        }
        case "list":
          s += b.items
            ?.map(
              (i, n) =>
                `${b.ordered ? `${n + 1}.` : "-"} ${turndown.turndown(i)}`,
            )
            .join("\n");
          break;
        case "table": {
          const rows = b.rows ?? [];
          const columns = Math.max(0, ...rows.map((r) => r.length));
          const row = (r: string[]) =>
            `| ${Array.from({ length: columns }, (_, i) => (r[i] || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>")).join(" | ")} |`;
          if (rows.length)
            s += `${row(rows[0])}\n${row(Array(columns).fill("---"))}\n${rows.slice(1).map(row).join("\n")}`;
          break;
        }
        case "image": {
          const a = assets.get(b.assetId!);
          s +=
            a?.status === "ready"
              ? `![${b.text.replace(/[\[\]]/g, "")}](${a.path})`
              : `> [图片未保存] ${b.text}`;
          break;
        }
        case "math":
          s += `$$\n${b.text}\n$$`;
          break;
        case "divider":
          s += "---";
          break;
      }
      s += "\n\n";
    }
  }
  return s;
}
function inlineRuns(
  html: string,
  base: { color?: string; size?: number } = {},
): (TextRun | ExternalHyperlink)[] {
  const $ = cheerio.load(`<span>${html}</span>`);
  const out: (TextRun | ExternalHyperlink)[] = [];
  const walk = (
    nodes: any[],
    style: { bold?: boolean; italics?: boolean; code?: boolean } = {},
  ) => {
    for (const n of nodes) {
      if (n.type === "text")
        out.push(
          new TextRun({
            text: n.data,
            ...base,
            ...style,
            font: style.code ? "Menlo" : undefined,
            size: style.code ? 19 : base.size,
          }),
        );
      else if (
        n.name === "a" &&
        /^https?:|^mailto:/.test(n.attribs?.href || "")
      ) {
        out.push(
          new ExternalHyperlink({
            link: n.attribs.href,
            children: [
              new TextRun({ text: $(n).text(), ...base, style: "Hyperlink" }),
            ],
          }),
        );
      } else if (n.name === "br") out.push(new TextRun({ break: 1 }));
      else if (n.children)
        walk(n.children, {
          ...style,
          bold: style.bold || ["strong", "b"].includes(n.name),
          italics: style.italics || ["em", "i"].includes(n.name),
          code: style.code || n.name === "code",
        });
    }
  };
  walk($("body>span").contents().toArray());
  return out.length ? out : [new TextRun("")];
}
async function makeDocx(job: Job): Promise<Buffer> {
  const theme = templateFor(job.options.template);
  const font = (name: string) => ({
    ascii: name,
    hAnsi: name,
    eastAsia: name,
    cs: name,
  });
  const bodyFont =
    process.platform === "darwin"
      ? theme.wordFont
      : theme.id === "print" || theme.id === "journal"
        ? "SimSun"
        : "Microsoft YaHei";
  const sansFont =
    process.platform === "darwin" ? "Arial Unicode MS" : "Microsoft YaHei";
  const chapters = job.chapters.filter(
    (c) => c.selected && c.status !== "failed" && c.blocks.length,
  );
  const authors = [...new Set(chapters.map((c) => c.author).filter(Boolean))];
  const date = new Date(job.updatedAt).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const children: (Paragraph | Table | TableOfContents)[] = [
    new Paragraph({
      text: new URL(job.url).hostname.replace(/^www\./, ""),
      style: "SourceLabel",
    }),
    new Paragraph({ text: job.title, style: "Title" }),
    new Paragraph({
      style: "ArchiveMeta",
      text: [
        authors.join("、"),
        `保存于 ${date}`,
        chapters.length > 1 ? `${chapters.length} 个章节` : "",
      ]
        .filter(Boolean)
        .join("   ·   "),
    }),
    ...(chapters.length > 1
      ? [new Paragraph({ text: "目录", heading: HeadingLevel.HEADING_1 })]
      : []),
  ];
  const assets = assetMap(job);
  for (const c of chapters.length > 1 ? chapters : [])
    children.push(
      new Paragraph({
        children: [
          new InternalHyperlink({
            anchor: `chapter-${c.id}`,
            children: [new TextRun({ text: chapterTitle(c), color: "17242C" })],
          }),
        ],
      }),
    );
  let chapterNumber = 0;
  for (const c of chapters) {
    if (chapters.length > 1 || c.title !== job.title)
      children.push(
        new Paragraph({
          children: [
            new Bookmark({
              id: `chapter-${c.id}`,
              children: [new TextRun(chapterTitle(c))],
            }),
          ],
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore:
            chapterNumber++ > 0 ||
            job.chapters.filter((c) => c.selected).length > 1,
        }),
      );
    for (const b of chapterBlocks(c)) {
      if (b.type === "table") {
        const widths = tableWidths(b.rows || []);
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: widths.map((width) =>
              Math.round(((11906 - theme.margin * 2) * width) / 100),
            ),
            borders: Object.fromEntries(
              [
                "top",
                "bottom",
                "left",
                "right",
                "insideHorizontal",
                "insideVertical",
              ].map((side) => [
                side,
                { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
              ]),
            ),
            rows: (b.rows ?? []).map(
              (row, i) =>
                new TableRow({
                  tableHeader: i === 0,
                  cantSplit: true,
                  children: row.map(
                    (cell, column) =>
                      new TableCell({
                        width: {
                          size: widths[column],
                          type: WidthType.PERCENTAGE,
                        },
                        verticalAlign: VerticalAlign.CENTER,
                        margins: {
                          top: 115,
                          bottom: 115,
                          left: 140,
                          right: 140,
                        },
                        children: [
                          new Paragraph({
                            text: cell,
                            spacing: { after: 20, line: 270 },
                            run: {
                              size: 19,
                              bold: i === 0,
                              color: i === 0 ? theme.tableInk : "263039",
                            },
                          }),
                        ],
                        shading:
                          i === 0
                            ? { fill: theme.tableFill }
                            : theme.id === "technical" && i % 2 === 0
                              ? { fill: "F7F9FC" }
                              : undefined,
                      }),
                  ),
                }),
            ),
          }),
        );
        children.push(
          new Paragraph({
            spacing: { line: 80, after: 100 },
            children: [new TextRun({ text: "", size: 2 })],
          }),
        );
      } else if (b.type === "image") {
        const a = assets.get(b.assetId!);
        if (a?.status === "ready" && a.path) {
          const data = await fs.readFile(path.join(job.outputDir, a.path));
          const scale = Math.min(
            1,
            590 / (a.width || 590),
            850 / (a.height || 300),
          );
          const w = (a.width || 590) * scale;
          const h = (a.height || 300) * scale;
          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data,
                  type: a.mime === "image/jpeg" ? "jpg" : "png",
                  transformation: { width: w, height: h },
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { before: 160, after: 120 },
            }),
          );
        } else children.push(new Paragraph({ text: `[图片未保存] ${b.text}` }));
      } else if (b.type === "heading")
        children.push(
          new Paragraph({
            children: inlineRuns(b.html || e(b.text)),
            heading: [
              HeadingLevel.HEADING_2,
              HeadingLevel.HEADING_3,
              HeadingLevel.HEADING_4,
            ][Math.min(2, Math.max(0, (b.level || 2) - 2))],
          }),
        );
      else if (b.type === "list")
        b.items?.forEach((item, i) =>
          children.push(
            new Paragraph({
              children: inlineRuns(b.ordered ? `${i + 1}. ${item}` : item),
              bullet: b.ordered ? undefined : { level: 0 },
            }),
          ),
        );
      else if (b.type === "code") {
        const lines = b.text.split("\n");
        if (b.language)
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: b.language,
                  font: "Menlo",
                  size: 15,
                  color: "596B80",
                }),
              ],
              keepNext: true,
              shading: { fill: theme.codeFill },
              indent: { left: 180, right: 180 },
              border: Object.fromEntries(
                ["top", "left", "right"].map((side) => [
                  side,
                  {
                    color: theme.codeFill,
                    style: BorderStyle.SINGLE,
                    size: 1,
                    space: 7,
                  },
                ]),
              ),
              spacing: { before: 140, after: 0, line: 240 },
            }),
          );
        children.push(
          new Paragraph({
            children: lines.map(
              (line, i) =>
                new TextRun({
                  text: line || " ",
                  break: i ? 1 : 0,
                  font: "Menlo",
                  size: 17,
                  color: theme.codeInk,
                }),
            ),
            shading: { fill: theme.codeFill },
            keepLines: lines.length <= 18,
            indent: { left: 180, right: 180 },
            border: Object.fromEntries(
              [...(b.language ? [] : ["top"]), "bottom", "left", "right"].map(
                (side) => [
                  side,
                  {
                    color: theme.codeFill,
                    style: BorderStyle.SINGLE,
                    size: 1,
                    space: 7,
                  },
                ],
              ),
            ),
            spacing: { before: b.language ? 0 : 140, after: 200, line: 260 },
          }),
        );
      } else if (b.type === "math")
        children.push(new Paragraph({ text: `公式源：${b.text}` }));
      else if (b.type !== "divider")
        children.push(
          new Paragraph({
            children: inlineRuns(
              b.html || e(b.text),
              b.type === "quote"
                ? {
                    color: "4D5961",
                    size: theme.id === "journal" ? 26 : theme.size,
                  }
                : {},
            ),
            spacing: { after: theme.after },
            ...(b.type === "quote"
              ? {
                  indent: { left: 340, right: 240 },
                  run: {
                    color: "4D5961",
                    size: theme.id === "journal" ? 26 : theme.size,
                  },
                  spacing: { before: 140, after: 220, line: theme.line },
                }
              : {}),
          }),
        );
    }
  }
  children.push(
    new Paragraph({
      style: "SourceNote",
      children: [
        new TextRun("原文来源："),
        new ExternalHyperlink({
          link: redactURL(job.url),
          children: [
            new TextRun({
              text: redactURL(job.url),
              color: "6D7780",
              size: 16,
            }),
          ],
        }),
        new TextRun({
          text: `保存于 ${date} · 保存范围与检查结果见配套归档报告`,
          break: 1,
        }),
      ],
    }),
  );
  const doc = new Document({
    creator: "拾页",
    title: job.title,
    description: "在线文档离线归档",
    styles: {
      default: {
        document: {
          run: {
            font: font(bodyFont),
            size: theme.size,
            color: "263039",
          },
          paragraph: { spacing: { line: theme.line, after: theme.after } },
        },
      },
      paragraphStyles: [
        {
          id: "SourceLabel",
          name: "Source Label",
          basedOn: "Normal",
          run: {
            font: "Arial",
            size: 16,
            color: theme.accent,
            characterSpacing: 14,
          },
          paragraph: {
            spacing: { before: 40, after: 180, line: 240 },
            keepNext: true,
            alignment:
              theme.id === "print" ? AlignmentType.CENTER : AlignmentType.LEFT,
          },
        },
        {
          id: "ArchiveMeta",
          name: "Archive Metadata",
          basedOn: "Normal",
          run: {
            font: font(sansFont),
            size: 16,
            color: "66717A",
            italics: false,
          },
          paragraph: {
            spacing: { line: 240, after: 330 },
            alignment:
              theme.id === "print" ? AlignmentType.CENTER : AlignmentType.LEFT,
          },
        },
        {
          id: "SourceNote",
          name: "Source Note",
          basedOn: "Normal",
          run: {
            font: font(sansFont),
            size: 16,
            color: "6D7780",
          },
          paragraph: {
            spacing: { before: 280, after: 0, line: 240 },
            keepLines: true,
          },
        },
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          run: {
            font: font(
              process.platform === "darwin"
                ? theme.titleFont
                : theme.id === "print" || theme.id === "journal"
                  ? "SimSun"
                  : "Microsoft YaHei",
            ),
            size: theme.titleSize,
            bold: true,
            color: "000000",
          },
          paragraph: {
            spacing: { after: 180, line: 300 },
            keepNext: true,
            keepLines: true,
            alignment:
              theme.id === "print" ? AlignmentType.CENTER : AlignmentType.LEFT,
          },
        },
        ...[1, 2, 3, 4].map((n) => ({
          id: `Heading${n}`,
          name: `Heading ${n}`,
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            bold: true,
            color: "000000",
            size: theme.headings[n - 1],
            font: font(theme.id === "print" ? bodyFont : sansFont),
          },
          paragraph: {
            spacing: { before: n <= 2 ? 300 : 240, after: 140, line: 300 },
            outlineLevel: n - 1,
            keepNext: true,
          },
        })),
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: theme.margin,
              bottom: theme.margin,
              left: theme.margin,
              right: theme.margin,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 0, line: 200 },
                children: [
                  new TextRun({
                    size: 16,
                    color: "77818A",
                    font: "Arial",
                    children: [
                      PageNumber.CURRENT,
                      " / ",
                      PageNumber.TOTAL_PAGES,
                    ],
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
export async function renderPreview(job: Job) {
  await atomicWrite(
    path.join(job.outputDir, "preview.html"),
    documentHTML(job),
  );
  job.previewPath = "preview.html";
}
export async function exportJob(
  job: Job,
  signal: AbortSignal,
  onPhase: (message: string) => void,
  reviewLayout?: (file: string) => Promise<void>,
): Promise<ExportFile[]> {
  const staging = path.join(job.outputDir, `.staging-${uid()}`);
  await fs.mkdir(staging, { recursive: true });
  try {
    for (const relative of [
      ...new Set(
        job.chapters
          .flatMap((c) => c.assets)
          .filter((a) => a.status === "ready" && a.path)
          .map((a) => a.path!),
      ),
      ...(job.originalPath ? [job.originalPath] : []),
    ]) {
      const destination = path.join(staging, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs
        .link(path.join(job.outputDir, relative), destination)
        .catch(() =>
          fs.copyFile(path.join(job.outputDir, relative), destination),
        );
    }
    const staged = { ...job, outputDir: staging };
    const results = await writeExports(staged, signal, onPhase, reviewLayout);
    if (signal.aborted) throw new Error("任务已暂停");
    for (const name of [
      ...results.map((f) => f.name),
      "阅读说明.md",
      ...(!job.originalPath ? ["preview.html", "preview.png"] : []),
    ])
      await fs.rename(path.join(staging, name), path.join(job.outputDir, name));
    if (staged.previewPath) job.previewPath = staged.previewPath;
    return results.map((f) => ({
      ...f,
      path: path.join(job.outputDir, f.name),
    }));
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
async function writeExports(
  job: Job,
  signal: AbortSignal,
  onPhase: (message: string) => void,
  reviewLayout?: (file: string) => Promise<void>,
): Promise<ExportFile[]> {
  const name = safeName(job.title);
  const htmlFile = `${/^preview$/i.test(name) ? `${name}_网页` : name}.html`;
  const htmlPreview =
    job.options.formats.includes("html") &&
    !job.options.formats.includes("pdf");
  const preparePreview = async () => {
    await renderPreview(job);
    if (htmlPreview) {
      await atomicWrite(
        path.join(job.outputDir, htmlFile),
        await readerHTML(job),
      );
      job.previewPath = htmlFile;
    }
  };
  const results: ExportFile[] = [];
  const add = async (file: string, format: string, pages?: number) => {
    results.push({
      name: file,
      path: path.join(job.outputDir, file),
      format,
      bytes: (await fs.stat(path.join(job.outputDir, file))).size,
      pages,
    });
  };
  if (job.originalPath) {
    const bytes = await fs.readFile(path.join(job.outputDir, job.originalPath));
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
    await add(job.originalPath, "pdf", pdf.getPageCount());
  } else {
    if (
      job.chapters.some(
        (c) => c.selected && c.blocks.some((b) => b.type === "math"),
      ) &&
      job.options.formats.includes("docx") &&
      !job.issues.some((i) => i.code === "math-docx")
    )
      job.issues.push(
        issue(
          "math-docx",
          "Word 中公式保留为公式源文本；PDF / HTML 使用数学排版，Markdown 保留公式源",
        ),
      );
    await preparePreview();
    const win = new BrowserWindow({
      show: false,
      width: htmlPreview ? 1200 : 1000,
      height: 1200,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    try {
      await win.loadFile(path.join(job.outputDir, job.previewPath!));
      await win.webContents.executeJavaScript(
        "document.fonts.ready.then(()=>Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{}))))",
      );
      if (!htmlPreview) {
        const repairs: string[] = await win.webContents.executeJavaScript(
          `(${repairLayout.toString()})()`,
        );
        job.coverage.layoutRepairs = [
          ...new Set([...(job.coverage.layoutRepairs || []), ...repairs]),
        ];
        const warnings: string[] = await win.webContents.executeJavaScript(
          'Array.from(document.querySelectorAll("[data-folio-layout-warning]")).map(e=>e.getAttribute("data-folio-layout-warning"))',
        );
        for (const message of new Set(warnings))
          job.issues.push(issue("layout-image-limit", message));
      }
      const overflows: number = await win.webContents.executeJavaScript(
        htmlPreview
          ? "Number(document.documentElement.scrollWidth > innerWidth + 2)"
          : 'Array.from(document.querySelectorAll("table,pre,p,img")).filter(e=>e.getBoundingClientRect().right>document.body.getBoundingClientRect().right+2).length',
      );
      if (overflows && !job.issues.some((i) => i.code === "layout-overflow"))
        job.issues.push(
          issue(
            "layout-overflow",
            `预览发现 ${overflows} 处潜在横向溢出，请核对版式`,
          ),
        );
      await fs.writeFile(
        path.join(job.outputDir, "preview.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      if (reviewLayout && !job.options.formats.includes("pdf")) {
        await reviewLayout(path.join(job.outputDir, "preview.png"));
        await preparePreview();
        await win.loadFile(path.join(job.outputDir, job.previewPath!));
        await win.webContents.executeJavaScript(
          "document.fonts.ready.then(()=>Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{}))))",
        );
      }
      for (const format of [...job.options.formats].sort((a, b) =>
        a === "pdf" ? -1 : b === "pdf" ? 1 : 0,
      )) {
        if (signal.aborted) throw new Error("任务已暂停");
        onPhase(
          `正在生成 ${format === "docx" ? "Word" : format.toUpperCase()}`,
        );
        if (format === "pdf") {
          const file = `${name}.pdf`;
          const print = () =>
            win.webContents.printToPDF({
              pageSize: "A4",
              printBackground: true,
              preferCSSPageSize: true,
              generateDocumentOutline: true,
              displayHeaderFooter: true,
              headerTemplate: "<span></span>",
              footerTemplate:
                '<div style="font-size:9px;text-align:center;width:100%;color:#7b858d"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
            });

          const filePath = path.join(job.outputDir, file);
          let finalPages = 0;
          for (let attempt = 0; attempt < 2; attempt++) {
            if (signal.aborted) throw new Error("任务已暂停");
            const bytes = await print();
            finalPages = (await PDFDocument.load(bytes)).getPageCount();
            await atomicWrite(filePath, bytes);
            const inspector = new PDFLayout();
            let findings: { page: number; code: string; message: string }[];
            try {
              await inspector.load(filePath);
              findings = await inspector.audit([
                job.title,
                ...job.chapters
                  .filter((c) => c.selected && c.status !== "failed")
                  .flatMap((c) => [
                    chapterTitle(c),
                    ...c.blocks
                      .filter((b) => b.type === "heading")
                      .map((b) => b.text),
                  ]),
              ]);
            } finally {
              inspector.close();
            }
            job.coverage.rulePages = finalPages;
            job.coverage.layoutChecks = findings;
            if (!findings.length || attempt === 1) break;
            onPhase("发现分页或文字边界问题，调整版式后重新检查一次");
            await win.webContents.executeJavaScript(
              `(${applyPDFRepair.toString()})()`,
            );
            job.coverage.layoutRepairs = [
              ...new Set([
                ...(job.coverage.layoutRepairs || []),
                "按最终 PDF 检查结果调整跨页约束并重新生成一次",
              ]),
            ];
          }
          for (const finding of job.coverage.layoutChecks || [])
            job.issues.push(
              issue(
                `layout-${finding.code}`,
                `最终 PDF 第 ${finding.page} 页：${finding.message}；自动调整后仍需核对`,
              ),
            );
          await add(file, "pdf", finalPages);
          if (reviewLayout) await reviewLayout(path.join(job.outputDir, file));
        }
        if (format === "docx") {
          const file = `${name}.docx`;
          await atomicWrite(
            path.join(job.outputDir, file),
            await makeDocx(job),
          );
          await add(file, "docx");
        }
        if (format === "md") {
          const file = `${name}.md`;
          await atomicWrite(path.join(job.outputDir, file), documentMD(job));
          await add(file, "md");
        }
        if (format === "html") {
          await atomicWrite(
            path.join(job.outputDir, htmlFile),
            await readerHTML(job),
          );
          await add(htmlFile, "html");
        }
      }
      if (!htmlPreview) {
        const corrected: string = await win.webContents.executeJavaScript(
          "document.documentElement.outerHTML",
        );
        await atomicWrite(
          path.join(job.outputDir, "preview.html"),
          "<!doctype html>" + corrected,
        );
      }
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }
  if (!job.originalPath && !job.options.formats.includes("pdf"))
    await preparePreview();
  const report = publicReport(job);
  await atomicWrite(
    path.join(job.outputDir, "归档报告.json"),
    JSON.stringify(report, null, 2),
  );
  await add("归档报告.json", "report");
  await atomicWrite(
    path.join(job.outputDir, "阅读说明.md"),
    `# ${job.title}\n\n来源：${redactURL(job.url)}\n\n获取时间：${job.updatedAt}\n\n${job.options.formats.includes("html") ? "HTML 已内嵌成功保存的图片，可单独移动、离线打开，支持目录、代码复制、浅色 / 深色阅读和打印。" : ""}${job.options.formats.includes("md") ? "Markdown 请与 assets 文件夹放在同一目录。" : ""}预览与视觉检查的覆盖范围见归档报告。\n\n${job.originalPath ? "本次保存来源原始 PDF；原始 PDF 转为其他格式不在本版本内。\n\n" : ""}## 已知问题\n\n${
      job.issues
        .filter((i) => !i.resolved)
        .map((i) => `- ${i.message}`)
        .join("\n") ||
      "已执行结构与资源检查；来源总量未知时无法证明全部内容完整。"
    }\n`,
  );
  const zip = new JSZip();
  for (const file of [...results.map((r) => r.name), "阅读说明.md"])
    zip.file(file, await fs.readFile(path.join(job.outputDir, file)));
  for (const a of job.chapters
    .flatMap((c) => c.assets)
    .filter((a) => a.status === "ready" && a.path))
    zip.file(a.path!, await fs.readFile(path.join(job.outputDir, a.path!)));
  const zipName = `${name}_离线资料包.zip`;
  await atomicWrite(
    path.join(job.outputDir, zipName),
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
  await add(zipName, "zip");
  return results;
}
export function publicReport(job: Job) {
  return {
    schemaVersion: 2,
    discovery: job.discovery,
    reconciliation: job.reconciliation,
    title: job.title,
    source: redactURL(job.url),
    savedAt: job.updatedAt,
    scope: "按已发现目录与内容块核对；未知来源总量不作完整率承诺",
    chapters: job.chapters.map((c) => ({
      id: c.id,
      title: c.title,
      sourceNumber: c.sourceNumber,
      selected: c.selected,
      status: c.status,
      author: c.author,
      capturedAt: c.capturedAt,
      blocks: c.blocks.length,
      changes: c.changes,
      capture: c.capture,
      source: redactURL(c.url),
    })),
    assets: job.chapters
      .flatMap((c) => c.assets)
      .map(({ id, status, path, hash, width, height, error, captureMode }) => ({
        id,
        status,
        path,
        hash,
        width,
        height,
        error,
        captureMode: captureMode || "original",
      })),
    issues: job.issues,
    aiReview: job.coverage,
    access: job.access,
    template: job.options.template,
  };
}
