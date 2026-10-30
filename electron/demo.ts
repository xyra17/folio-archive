import { createServer, type Server } from "node:http";
import { nativeImage } from "electron";
import { PDFDocument, StandardFonts } from "pdf-lib";

export async function startDemo(): Promise<{
  url: string;
  server: Server;
  repairImages: () => void;
}> {
  let repaired = false;
  const bitmap = Buffer.alloc(720 * 180 * 4);
  for (let y = 0; y < 180; y++)
    for (let x = 0; x < 720; x++) {
      const pos = (y * 720 + x) * 4;
      const box =
        y > 45 &&
        y < 135 &&
        [40, 270, 500].some((start) => x > start && x < start + 180);
      bitmap[pos] = box ? 120 : 245;
      bitmap[pos + 1] = box ? 155 : 248;
      bitmap[pos + 2] = box ? 100 : 244;
      bitmap[pos + 3] = 255;
    }
  const image = nativeImage
    .createFromBitmap(bitmap, { width: 720, height: 180 })
    .toPNG();
  const original = await PDFDocument.create();
  const page = original.addPage();
  page.drawText("Folio original PDF fixture", {
    x: 50,
    y: 700,
    size: 20,
    font: await original.embedFont(StandardFonts.Helvetica),
  });
  const originalBytes = await original.save();
  const names = ["从一个可靠的任务开始", "把内容变成结构", "让结果可以被检查"];
  const body = [
    "<h2>任务的边界</h2><p>一个可恢复的任务需要明确输入、输出和完成条件。先把需求写成可验证的步骤，再决定哪些步骤需要模型参与。</p><h2>先保存证据</h2><p>每次采集保留来源、获取时间和章节顺序。正文与资源分开保存，发生错误时可以重新处理受影响的部分。</p><blockquote>完成一个文件的生成，还需要核对内容是否完整。</blockquote>",
    '<h2>文档的中间结构</h2><p>标题、段落、列表、代码和表格构成了可复用的内容树。同一份内容可以分别生成阅读稿、可编辑稿和笔记稿。</p><pre><code class="language-typescript">interface ArchiveTask {\n  source: string;\n  formats: ("pdf" | "docx" | "md" | "html")[];\n  checkpoint: number;\n}</code></pre><h2>阶段与检查点</h2><table><thead><tr><th>阶段</th><th>交付</th><th>恢复方式</th></tr></thead><tbody><tr><td>采集</td><td>正文和来源证据</td><td>按章节继续</td></tr><tr><td>素材</td><td>本地图片</td><td>重试失败资源</td></tr><tr><td>导出</td><td>PDF / Word / Markdown / HTML</td><td>复用内容重新排版</td></tr></tbody></table>',
    "<h2>核对内容</h2><ul><li>章节清单与选择范围一致。</li><li>图片已经保存为本地资源。</li><li>代码与表格没有被截断。</li><li>无法取得的组件有清楚的说明。</li></ul><h2>边处理边检查</h2><p>采集下一章时，可以核对前一章。不同任务通过不可变快照交接，避免同时修改同一份文件。</p><p>这份内置资料用于实际体验归档流程，所有导出文件都由处理引擎现场生成。</p>",
  ];
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/article-")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (req.url === "/article-captcha") {
        res.end(
          "<title>安全验证</title><h1>请完成验证</h1><p>Verify you are human</p>",
        );
        return;
      }
      const prose =
        "这是一篇用于验证通用网页提取的文章。文章需要保留正文、标题、图片与代码，不能把站点菜单、广告和推荐内容混进文件。普通用户只需要粘贴链接并选择格式，程序负责加载正文并生成本地文件。";
      const content = `<p>正文开始标记。${prose}</p><h2>保留文章结构</h2>${Array.from({ length: 6 }, (_, i) => `<p>第 ${i + 1} 段。${prose}</p>`).join("")}<pre><code class="language-python">print("hello article")</code></pre><img src="data:image/png;base64,AA==" data-original="/image.png" alt="延迟加载的正文配图"><p>正文结束标记。</p>`;
      let wrapper =
        req.url === "/article-csdn"
          ? `<main><div id="content_views">${content}</div><div class="recommend-box"><p>推荐噪声不应保存</p></div></main>`
          : req.url === "/article-zhihu"
            ? `<main><div class="Post-RichTextContainer"><div class="RichText">${content}</div></div><div class="CommentList"><p>评论噪声不应保存</p></div></main>`
            : req.url === "/article-anthropic"
              ? `<article><aside><p>关联文章不应保存</p></aside><div data-article-body="true">${content}</div></article>`
              : `<div id="story">${content}</div>`;
      if (req.url === "/article-generic")
        wrapper += `<script>const c=document.createElement('canvas');c.width=240;c.height=120;const x=c.getContext('2d');x.fillStyle='#869cbc';x.fillRect(0,0,240,120);document.querySelector('img').setAttribute('data-original',c.toDataURL('image/webp'));</script>`;
      if (req.url === "/article-collapsed")
        wrapper = `<div class="RichContent is-collapsed">${wrapper}<button onclick="this.parentElement.classList.remove('is-collapsed');this.remove()">展开全文</button></div>`;
      if (req.url === "/article-teaser")
        wrapper = `<div class="entry-content"><p>这段摘要很短，仅用于说明本文的话题，真正正文位于后面的普通容器中。</p></div><main><div class="story">${content}</div></main><aside><article><p>关联文章不应保存</p></article></aside>`;
      if (req.url === "/article-quoted-code")
        wrapper = `<article>${content.replace(
          '<pre><code class="language-python">print("hello article")</code></pre>',
          '<blockquote><p>代码前引用</p><div><pre class="highlight"><code class="highlight language-python extra">print("hello article")</code></pre></div><p>代码后引用</p></blockquote>',
        )}</article>`;
      if (req.url === "/article-shadow")
        wrapper = `<main><article><web-story><p slot="heading">组件内的正文标题</p><p>未分配到插槽的噪声不应保存</p></web-story></article></main><script>document.querySelector('web-story').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(`<slot name="heading"></slot>${content}`)};</script>`;
      res.end(
        `<!doctype html><meta charset="utf-8"><title>通用文章测试</title><meta property="og:title" content="通用文章测试"><style>body{font:17px/1.8 system-ui;max-width:850px;margin:40px auto}img{max-width:100%}nav{padding:15px}</style><header><nav><a href="/unrelated">全站导航不应变成章节</a></nav><p>导航噪声不应保存</p></header><h1>通用文章测试</h1>${wrapper}<footer><p>页脚噪声不应保存</p></footer>`,
      );
      return;
    }
    if (req.url === "/components") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>组件归档验证</title><style>body{margin:40px;font:18px/1.7 system-ui}article{max-width:900px;margin:auto}.board{height:200px;background:#e9f0e4;display:flex;align-items:center;justify-content:center;border:2px solid #708960}.huge{height:1200px;background:#eee}</style><article><h1 data-block-id="title" data-block-type="heading1">组件归档验证</h1><p data-block-id="before" data-block-type="text">画板前面的正文必须保留。这个测试检查组件截图、原文顺序和本地素材。</p><div class="board" data-block-id="board" data-block-type="board"><svg width="500" height="100"><rect x="5" y="5" width="480" height="90" fill="#cadbbd"/><text x="40" y="58" font-size="24">采集 → 结构化 → 导出</text></svg></div><p data-block-id="after" data-block-type="text">画板后面的正文也必须保留。</p><div class="huge" data-block-id="large" data-block-type="bitable">超出视口的动态表格，不能以局部截图冒充完整内容</div><p data-block-id="end" data-block-type="text">最后一段正文必须保留。</p></article>`,
      );
      return;
    }
    if (req.url === "/original.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(originalBytes);
      return;
    }
    if (req.url === "/preview-pdf") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<h1>PDF 预览</h1><a href="/original.pdf">下载原始 PDF</a>');
      return;
    }
    if (req.url === "/login-required") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<h1>测试</h1><p>请登录后查看</p>");
      return;
    }
    if (req.url === "/restricted") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<h1>测试</h1><div data-export-disabled="true">禁止导出</div>');
      return;
    }
    if (req.url === "/image.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(image);
      return;
    }
    if (req.url === "/broken.png") {
      res.writeHead(repaired ? 200 : 404, { "content-type": "image/png" });
      res.end(repaired ? image : undefined);
      return;
    }
    const i = Math.max(
      0,
      Math.min(2, Number(req.url?.match(/chapter\/(\d)/)?.[1] ?? 1) - 1),
    );
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="author" content="拾页"><meta property="og:title" content="Agent 应用开发手册"><title>Agent 应用开发手册</title><style>body{font:17px/1.9 system-ui;max-width:900px;margin:50px auto}nav{display:flex;gap:20px}article{margin-top:45px}td,th{padding:10px;border:1px solid #ddd}pre{background:#f5f5f5;padding:20px}</style></head><body><nav data-chapter-list>${names.map((n, j) => `<a href="/chapter/${j + 1}${req.url?.includes("broken=1") ? "?broken=1" : ""}">${j + 1}. ${n}</a>`).join("")}</nav><article><h1>${i + 1}. ${names[i]}</h1>${body[i]}<img alt="采集、结构化、导出三个处理阶段" src="${req.url?.includes("broken=1") ? "/broken.png" : "/image.png"}" width="720" height="180"></article></body></html>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("示例服务启动失败");
  return {
    url: `http://127.0.0.1:${addr.port}/chapter/1`,
    server,
    repairImages: () => {
      repaired = true;
    },
  };
}
