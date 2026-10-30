import { chapterTitle } from "../shared/chapters";
import { archiveNotice } from "./completeness";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import katex from "katex";
import type { Block, Job } from "../shared/types";
import {
  cleanListItems,
  cleanInline,
  escapeHTML as e,
  redactURL,
  within,
} from "./core";

// Kept constant: the exported CSP authorizes this script, never source scripts.
const readerScript = `(() => {
  const root = document.documentElement;
  const theme = document.querySelector('[data-action="theme"]');
  function setTheme(value) {
    root.dataset.theme = value;
    theme.textContent = value === 'dark' ? '浅色阅读' : '深色阅读';
    theme.setAttribute('aria-pressed', String(value === 'dark'));
  }
  try { setTheme(localStorage.getItem('folio-reader-theme') === 'dark' ? 'dark' : 'light'); }
  catch { setTheme('light'); }
  document.querySelectorAll('[data-enhanced]').forEach(el => { el.hidden = false; });
  theme.addEventListener('click', () => {
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
    try { localStorage.setItem('folio-reader-theme', root.dataset.theme); } catch {}
  });
  document.querySelector('[data-action="print"]').addEventListener('click', () => window.print());
  document.querySelectorAll('[data-action="copy"]').forEach(button => {
    button.addEventListener('click', async () => {
      const text = button.closest('.code-block').querySelector('code').textContent;
      let copied = false;
      try { await navigator.clipboard.writeText(text); copied = true; } catch {}
      if (!copied) {
        const active = document.activeElement;
        const selection = window.getSelection();
        const ranges = Array.from({length: selection.rangeCount}, (_, i) => selection.getRangeAt(i));
        const input = document.createElement('textarea');
        input.value = text; input.className = 'clipboard-buffer';
        document.body.append(input); input.select();
        try { copied = document.execCommand('copy'); } catch {}
        input.remove();
        selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range));
        if (active instanceof HTMLElement) active.focus({preventScroll:true});
      }
      button.textContent = copied ? '已复制' : '请选中代码复制';
      document.querySelector('[role="status"]').textContent = copied ? '代码已复制' : '复制未成功，请选中代码复制';
      setTimeout(() => { button.textContent = '复制代码'; }, 1800);
    });
  });
  const contents = document.querySelector('.contents');
  const mobile = matchMedia('(max-width: 1000px)');
  const adapt = () => { if (contents) contents.open = !mobile.matches; };
  adapt(); mobile.addEventListener('change', adapt);
  const links = Array.from(document.querySelectorAll('.contents a'));
  const headings = links.map(link => document.getElementById(link.hash.slice(1)));
  links.forEach(link => link.addEventListener('click', () => {
    if (mobile.matches) contents.open = false;
  }));
  let scheduled = false;
  function update() {
    scheduled = false;
    const extent = document.documentElement.scrollHeight - innerHeight;
    const progress = extent > 0 ? Math.min(1, Math.max(0, scrollY / extent)) : 1;
    root.style.setProperty('--progress', String(progress));
    let current = 0;
    headings.forEach((heading, i) => { if (heading.getBoundingClientRect().top <= 140) current = i; });
    if (headings.length && scrollY + innerHeight >= document.documentElement.scrollHeight - 2) current = headings.length - 1;
    links.forEach((link, i) => {
      if (i === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  addEventListener('scroll', () => { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } }, {passive:true});
  addEventListener('resize', update); update();
})();`;

const readerCSS = `
:root{color-scheme:light;--canvas:#fff;--ink:#25313a;--heading:#19262e;--muted:#66747d;--line:#e3e9eb;--soft:#f5f8f8;--accent:#246e68;--accent-soft:#eef7f5;--code:#18242f;--code-ink:#e3edf3;--progress:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
:root[data-theme=dark]{color-scheme:dark;--canvas:#151c21;--ink:#d1dce2;--heading:#edf3f5;--muted:#a0afb7;--line:#334149;--soft:#1d282f;--accent:#8acdc2;--accent-soft:#223e3a;--code:#10171c;--code-ink:#e3edf3}
*{box-sizing:border-box}[hidden]{display:none!important}html{scroll-padding-top:100px;background:var(--canvas);-webkit-text-size-adjust:100%}body{margin:0;color:var(--ink);font-size:17px;line-height:1.95;overflow-wrap:anywhere}::selection{background:#8bd4c16b}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:4px}a:hover{text-decoration-thickness:2px}button,summary{-webkit-tap-highlight-color:transparent}button{font:inherit}a:focus-visible,button:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:3px}
.skip-link{position:fixed;left:20px;top:-80px;z-index:20;background:var(--canvas);padding:8px 16px;border:1px solid var(--accent)}.skip-link:focus{top:12px}
.reader-bar{position:sticky;top:0;z-index:5;background:var(--canvas);border-bottom:1px solid var(--line)}.bar-inner{max-width:1240px;margin:auto;min-height:68px;padding:12px 32px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:10px;color:var(--heading);text-decoration:none;font-size:16px;font-weight:650;flex:none}.brand-mark{display:flex;gap:3px;width:22px;align-items:center}.brand-mark i{width:8px;height:19px;border:1.5px solid var(--accent);border-radius:2px}.brand-mark i:last-child{transform:translateY(-3px)}.bar-caption{margin-left:8px;padding-left:18px;border-left:1px solid var(--line);color:var(--muted);font-size:12px;font-weight:400}.reader-actions{display:flex;gap:6px}.tool{border:1px solid transparent;background:transparent;color:var(--muted);border-radius:7px;padding:7px 12px;font-size:12px;line-height:1.6;cursor:pointer;min-height:36px}.tool:hover{background:var(--soft);color:var(--heading)}.print-tool{border-color:var(--line);color:var(--ink)}.reading-progress{height:2px;background:var(--accent);position:absolute;bottom:-1px;left:0;width:100%;transform:scaleX(var(--progress));transform-origin:left}
.reading-layout{max-width:1160px;margin:0 auto;display:grid;grid-template-columns:minmax(180px,220px) minmax(0,760px);gap:72px;padding:64px 32px 80px;align-items:start}.reading-layout.no-contents{display:block;max-width:824px}.article{min-width:0;grid-column:2;grid-row:1}.document-header{padding-bottom:32px;margin-bottom:34px;border-bottom:1px solid var(--line)}.source-label{display:flex;align-items:center;gap:10px;font-size:12px;line-height:1.6;letter-spacing:.03em;color:var(--accent);margin-bottom:22px}.source-label::before{content:"";width:24px;height:2px;background:var(--accent);flex:none}.document-title{color:var(--heading);font-size:clamp(30px,3.5vw,44px);line-height:1.3;font-weight:650;letter-spacing:-.035em;text-wrap:balance;margin:0 0 23px}.document-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;color:var(--muted);font-size:12px;line-height:1.8;font-variant-numeric:tabular-nums}
h2,h3,h4,h5,h6{color:var(--heading);line-height:1.5;letter-spacing:-.015em;font-weight:650;scroll-margin-top:100px;text-wrap:balance;break-after:avoid}h2{font-size:27px;margin:52px 0 18px}h3{font-size:21px;margin:34px 0 14px}h4,h5,h6{font-size:18px;margin:30px 0 12px}.heading-link{margin-left:.45em;color:var(--muted);font-size:.65em;text-decoration:none;opacity:0}.heading-link:focus-visible,h2:hover .heading-link,h3:hover .heading-link,h4:hover .heading-link,h5:hover .heading-link,h6:hover .heading-link{opacity:1}p{margin:0 0 20px;text-wrap:pretty;orphans:3;widows:3}strong,b{font-weight:650}ul,ol{padding-left:1.5em;margin:18px 0 24px}li{padding-left:.25em;margin:7px 0}li::marker{color:var(--accent)}.chapter+.chapter{border-top:1px solid var(--line);margin-top:52px;padding-top:8px}.chapter-source{font-size:12px;color:var(--muted);line-height:1.7;margin-top:-8px;margin-bottom:26px}.chapter-source a{color:inherit}
blockquote{margin:28px 0;padding:18px 24px;border-left:3px solid var(--accent);background:var(--accent-soft);color:var(--ink);border-radius:0 8px 8px 0}blockquote p:last-child{margin-bottom:0}hr{border:0;border-top:1px solid var(--line);margin:38px 0}.missing{border:1px dashed var(--line);padding:16px;font-size:14px;color:var(--muted)}
code{font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;font-size:.85em}p code,li code,td code,blockquote code{background:var(--soft);color:var(--accent);padding:.15em .35em;border-radius:4px;box-decoration-break:clone}.code-block{margin:26px 0 30px;background:var(--code);color:var(--code-ink);border-radius:10px;overflow:hidden;min-width:0}.code-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid #ffffff18;padding:9px 18px;min-height:43px;font:11px/1.6 "SFMono-Regular",Consolas,monospace;color:#a9bdcb}.code-copy{background:transparent;border:1px solid #ffffff28;color:#d8e5ed;border-radius:5px;padding:4px 9px;font-size:11px;cursor:pointer;min-height:26px}.code-copy:hover{background:#ffffff10}.code-copy:focus-visible{outline-color:#8acdc2}pre{margin:0;padding:19px 22px 23px;white-space:pre;overflow:auto;line-height:1.8;font-size:13px;tab-size:2;overscroll-behavior-x:contain}pre code{font:inherit;color:inherit}.clipboard-buffer{position:fixed;top:0;left:-10000px}
.table-scroll{overflow-x:auto;overscroll-behavior-x:contain;margin:26px 0 30px;border:1px solid var(--line);border-radius:9px}table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.8;text-align:left;font-variant-numeric:tabular-nums}th,td{padding:12px 16px;border-bottom:1px solid var(--line);vertical-align:top;min-width:100px;max-width:420px;overflow-wrap:anywhere}th{background:var(--soft);color:var(--heading);font-weight:600}tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:var(--soft)}thead{display:table-header-group}.table-scroll.wide table{min-width:720px}tr{break-inside:avoid}
figure{margin:32px 0}img{display:block;max-width:100%;height:auto;margin:auto;border-radius:6px}figcaption{font-size:12px;line-height:1.7;color:var(--muted);text-align:center;margin-top:12px}math{display:block;overflow-x:auto;padding:12px 0;font-size:1.1em}
.contents{position:sticky;top:112px;grid-column:1;grid-row:1;max-height:calc(100vh - 144px);overflow:auto;font-size:12px;line-height:1.7;scrollbar-width:thin;scrollbar-color:var(--line) transparent}.contents summary{font-size:12px;color:var(--heading);font-weight:600;cursor:pointer;padding:0 0 15px;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:14px}.contents summary::-webkit-details-marker{display:none}.contents summary::after{content:"−";font-size:16px;color:var(--muted);font-weight:400}.contents:not([open]) summary::after{content:"+"}.contents-count{margin-left:auto;color:var(--muted);font:10px/1.6 "SFMono-Regular",Consolas,monospace}.contents ol{list-style:none;padding:0;margin:0;border-left:1px solid var(--line)}.contents li{margin:0;padding:0}.contents a{display:flex;gap:9px;padding:8px 10px 8px 16px;color:var(--muted);text-decoration:none;border-left:2px solid transparent;margin-left:-1px;transition:background .15s,color .15s}.contents a:hover{color:var(--heading);background:var(--soft)}.contents a[aria-current]{color:var(--accent);border-left-color:var(--accent);background:var(--accent-soft)}.contents a[data-depth="1"]{padding-left:32px;font-size:11px}.contents a[data-depth="2"]{padding-left:44px;font-size:11px}.toc-number{font:10px/2 "SFMono-Regular",Consolas,monospace;color:var(--muted);flex:none;min-width:17px}.contents a[data-depth="1"] .toc-number,.contents a[data-depth="2"] .toc-number{display:none}
.document-end{border-top:1px solid var(--line);padding-top:24px;margin-top:56px;font-size:12px;line-height:1.9;color:var(--muted)}.document-end p{margin-bottom:7px}.end-label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:7px}.end-bottom{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:24px;padding-top:18px;border-top:1px solid var(--line)}.end-bottom a{color:var(--muted);text-decoration:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
@media(max-width:1000px){.reading-layout{display:flex;flex-direction:column;max-width:824px;gap:0;padding-top:36px}.contents{position:static;order:-1;width:100%;max-height:none;margin-bottom:32px;border-bottom:1px solid var(--line)}.contents summary{padding:0 0 16px}.contents nav{max-height:45vh;overflow:auto;padding-bottom:18px}.contents ol{margin-bottom:0}.article{width:100%}.document-title{font-size:36px}}
@media(max-width:600px){body{font-size:16px;line-height:1.9}.bar-inner{padding:10px 20px;min-height:60px}.bar-caption{display:none}.reader-actions{gap:0}.tool{font-size:11px;padding:7px 9px}.reading-layout,.reading-layout.no-contents{padding:28px 22px 48px}.document-title{font-size:30px;line-height:1.4}.document-header{padding-bottom:26px;margin-bottom:28px}.document-meta{gap:5px 12px}.source-label{margin-bottom:18px}h2{font-size:24px;margin-top:40px}h3{font-size:20px}blockquote{padding:16px 18px}pre{padding:16px;font-size:12px}.code-toolbar{padding:8px 14px}th,td{padding:10px 12px}.heading-link{opacity:1}.end-bottom{align-items:flex-start}.contents{margin-bottom:26px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
@page{size:A4;margin:18mm 18mm 20mm}
@media print{:root,:root[data-theme=dark]{color-scheme:light;--canvas:#fff;--ink:#25313a;--heading:#19262e;--muted:#596870;--line:#d8e0e3;--soft:#f4f6f7;--accent:#246e68;--accent-soft:#f2f7f6;--code:#f3f5f7;--code-ink:#25313a}body{font-size:10.5pt;line-height:1.8;-webkit-print-color-adjust:exact;print-color-adjust:exact}.reader-bar,.contents,.heading-link,.skip-link,.code-copy,.end-bottom a{display:none!important}.reading-layout,.reading-layout.no-contents{display:block;max-width:none;padding:0;margin:0}.document-title{font-size:27pt}.document-header{break-inside:avoid}.document-meta{font-size:8pt}.source-label{font-size:8pt}.chapter+.chapter{break-before:page;border-top:0;padding-top:0}.chapter>h2:first-child{margin-top:0}h2{font-size:18pt;margin-top:26px}h3{font-size:14pt}h4,h5,h6{font-size:12pt}p{margin-bottom:10px}.code-block{overflow:visible;border:1px solid var(--line);border-radius:5px}.code-toolbar{color:var(--muted);border-color:var(--line);min-height:0;padding:5px 12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;overflow:visible;font-size:8pt;padding:12px;line-height:1.7}.table-scroll{overflow:visible;border:0;border-radius:0}.table-scroll.wide table{min-width:0}table{font-size:8pt;table-layout:fixed}th,td{min-width:0;padding:7px;overflow-wrap:anywhere}figure{break-inside:avoid}img{max-height:235mm;object-fit:contain}blockquote{break-inside:auto}.document-end{break-inside:avoid;font-size:8pt}}
`;

export async function readerHTML(job: Job): Promise<string> {
  const chapters = job.chapters.filter(
    (c) => c.selected && c.status !== "failed" && c.blocks.length,
  );
  const assets = new Map(
    job.chapters.flatMap((c) => c.assets).map((a) => [a.id, a]),
  );
  const embedded = new Map<string, string>();
  const headings: {
    id: string;
    text: string;
    level: number;
    sourceNumber?: string;
  }[] = [];
  const heading = (
    text: string,
    level: number,
    html?: string,
    base = job.url,
    sourceNumber?: string,
  ) => {
    const id = `reader-section-${headings.length + 1}`;
    const n = Math.min(6, Math.max(2, level));
    headings.push({ id, text, level: n, sourceNumber });
    return `<h${n} id="${id}">${html ? cleanInline(html, base) : e(chapterTitle({ title: text, sourceNumber }))}<a class="heading-link" href="#${id}" aria-label="定位到此节">#</a></h${n}>`;
  };
  const inline = (block: Block, base: string) =>
    block.html ? cleanInline(block.html, base) : e(block.text);
  const blockHTML = async (
    block: Block,
    offset: number,
    base: string,
  ): Promise<string> => {
    switch (block.type) {
      case "heading":
        return heading(
          block.text,
          (block.level || 2) + offset,
          block.html,
          base,
        );
      case "paragraph":
        return `<p>${inline(block, base)}</p>`;
      case "quote":
        return `<blockquote>${inline(block, base)}</blockquote>`;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const items = cleanListItems(block.items || [], base);
        return items.length
          ? `<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`
          : "";
      }
      case "code":
        return `<div class="code-block"><div class="code-toolbar"><span>${e(block.language || "CODE")}</span><button type="button" class="code-copy" data-action="copy" data-enhanced hidden>复制代码</button></div><pre tabindex="0" aria-label="代码，可横向滚动"><code>${e(block.text)}</code></pre></div>`;
      case "table": {
        const rows = block.rows || [];
        const wide = Math.max(0, ...rows.map((r) => r.length)) > 4;
        return `<div class="table-scroll${wide ? " wide" : ""}" role="region" aria-label="表格，可横向滚动" tabindex="0"><table><thead><tr>${(rows[0] || []).map((cell) => `<th scope="col">${e(cell)}</th>`).join("")}</tr></thead><tbody>${rows
          .slice(1)
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${e(cell)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`;
      }
      case "image": {
        const asset = assets.get(block.assetId!);
        if (!asset?.path || asset.status !== "ready")
          return `<p class="missing">[图片未保存] ${e(block.text)}</p>`;
        let data = embedded.get(asset.path);
        if (!data) {
          const root = await fs.realpath(job.outputDir);
          const file = path.resolve(job.outputDir, asset.path);
          if (
            !within(job.outputDir, file) ||
            !within(root, await fs.realpath(file))
          )
            throw new Error("HTML 图片路径超出归档目录");
          const bytes = await fs.readFile(file);
          const mime = bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "image/png"
            : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
              ? "image/jpeg"
              : "";
          if (!mime) throw new Error("HTML 图片需要已归档的 PNG 或 JPEG 文件");
          data = `data:${mime};base64,${bytes.toString("base64")}`;
          embedded.set(asset.path, data);
        }
        return `<figure><img src="${data}" alt="${e(block.text)}" decoding="async">${block.text ? `<figcaption>${e(block.text)}</figcaption>` : ""}</figure>`;
      }
      case "math":
        return katex.renderToString(block.text, {
          throwOnError: false,
          output: "mathml",
          displayMode: true,
          trust: false,
        });
      case "divider":
        return "<hr>";
    }
  };
  let content = "";
  for (const chapter of chapters) {
    const showTitle = chapters.length > 1 || chapter.title !== job.title;
    const blocks =
      chapter.blocks[0]?.type === "heading" &&
      chapter.blocks[0].text.trim() === chapter.title.trim()
        ? chapter.blocks.slice(1)
        : chapter.blocks;
    content += `<section class="chapter">${showTitle ? `${heading(chapter.title, 2, undefined, chapter.url, chapter.sourceNumber)}<p class="chapter-source">来源：<a href="${e(redactURL(chapter.url))}" rel="noreferrer">${e(redactURL(chapter.url))}</a></p>` : ""}`;
    for (const block of blocks)
      content += await blockHTML(block, showTitle ? 1 : 0, chapter.url);
    content += "</section>";
  }
  const minLevel = headings.length
    ? Math.min(...headings.map((h) => h.level))
    : 2;
  let sectionNumber = 0;
  let sectionLabel = "";
  const sourceNumbered = chapters.some((c) => c.sourceNumber);
  const toc = headings
    .map((h) => {
      const depth = Math.min(2, h.level - minLevel);
      if (!depth) {
        sectionNumber++;
        sectionLabel = sourceNumbered
          ? h.sourceNumber || ""
          : String(sectionNumber).padStart(2, "0");
      }
      return `<li><a href="#${h.id}" data-depth="${depth}"><span class="toc-number" aria-hidden="true">${e(sectionLabel)}</span><span>${e(h.text)}</span></a></li>`;
    })
    .join("");
  const authors = [...new Set(chapters.map((c) => c.author).filter(Boolean))];
  const text = chapters
    .flatMap((c) => c.blocks)
    .map((b) => b.text)
    .join(" ");
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (text.match(/[a-zA-Z0-9]+/g) || []).length;
  const minutes = Math.max(1, Math.ceil(cjk / 400 + words / 220));

  const source = redactURL(job.url);
  const host = new URL(job.url).hostname.replace(/^www\./, "");
  const scriptHash = createHash("sha256").update(readerScript).digest("base64");
  return `<!doctype html>
<html lang="zh-CN" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; base-uri 'none'; form-action 'none'; object-src 'none'"><meta name="generator" content="拾页"><title>${e(job.title)}</title><style>${readerCSS}</style></head>
<body id="top"><a class="skip-link" href="#article">跳到正文</a><header class="reader-bar"><div class="bar-inner"><a class="brand" href="#top" aria-label="拾页，回到顶部"><span class="brand-mark" aria-hidden="true"><i></i><i></i></span>拾页<span class="bar-caption">离线阅读</span></a><div class="reader-actions"><button type="button" class="tool" data-action="theme" data-enhanced hidden aria-pressed="false">深色阅读</button><button type="button" class="tool print-tool" data-action="print" data-enhanced hidden>打印 / 存为 PDF</button></div></div><div class="reading-progress" data-enhanced hidden aria-hidden="true"></div></header>
<div class="reading-layout${headings.length ? "" : " no-contents"}">${headings.length ? `<details class="contents"><summary>本页目录<span class="contents-count">${String(headings.length).padStart(2, "0")}</span></summary><nav aria-label="本页目录"><ol>${toc}</ol></nav></details>` : ""}<main class="article" id="article" tabindex="-1"><header class="document-header"><div class="source-label">${e(host)}</div><h1 class="document-title">${e(job.title)}</h1><div class="document-meta">${authors.length ? `<span>${e(authors.join("、"))}</span>` : ""}<span>约 ${minutes} 分钟阅读</span>${chapters.length > 1 ? `<span>${chapters.length} 个章节</span>` : ""}</div></header>${archiveNotice(job) ? `<p class="missing">${e(archiveNotice(job))}</p>` : ""}${content || '<p class="missing">当前没有可导出的正文。</p>'}<footer class="document-end"><div class="end-label">原文与归档</div><p><a href="${e(source)}" rel="noreferrer">${e(source)}</a></p><p>保存范围与检查结果见配套归档报告。</p><div class="end-bottom"><span>由拾页整理 · 可离线阅读</span><a href="#top">回到顶部 ↑</a></div></footer></main></div><div class="sr-only" role="status" aria-live="polite"></div><script>${readerScript}</script></body></html>`;
}
