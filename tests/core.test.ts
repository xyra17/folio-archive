import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanInline,
  webURL,
  within,
  safeName,
  Semaphore,
  pool,
  createJob,
  defaults,
  wait,
} from "../electron/core";
import { parseSnapshot, diffBlocks } from "../electron/extract";
import type { Snapshot } from "../electron/extract";
const snapshot = (html: string[]): Snapshot => ({
  title: "测试",
  url: "https://example.com/doc",
  author: "",
  pieces: html.map((h, i) => ({
    id: String(i),
    html: h,
    text: h.replace(/<[^>]+>/g, ""),
  })),
  links: [],
  limited: false,
  restricted: false,
  canvasCount: 0,
  scrollTruncated: false,
});
test("source and output containment reject executable or escaping inputs", () => {
  assert.throws(() => webURL("file:///etc/passwd"));
  assert.throws(() => webURL("javascript:alert(1)"));
  assert.throws(() => webURL("https://user:password@example.com"));
  assert.equal(webURL("https://example.com/a"), "https://example.com/a");
  assert.equal(within("/tmp/output", "/tmp/output/../secret"), false);
  assert.equal(within("/tmp/output", "/tmp/output2/a"), false);
  assert.equal(within("/tmp/output", "/tmp/output/assets/a.png"), true);
  assert.equal(safeName("a/b:<c>."), "a_b__c_");
});
test("inline content strips scripts and unsafe links while preserving formatting", () => {
  const html = cleanInline(
    '<strong>文字</strong><script>alert(1)</script><img onerror="alert(1)" src="x"><a href="javascript:alert(1)">a</a><a href="/good">b</a>',
    "https://example.com",
  );
  assert(html.includes("<strong>文字</strong>"));
  assert(!html.includes("javascript:"));
  assert(!html.includes("alert"));
  assert(html.includes("https://example.com/good"));
});
test("heading range excludes whole subsections and their unused assets", () => {
  const snap = snapshot([
    "<h1>文档</h1>",
    "<h2>更新记录</h2>",
    "<p>历史</p>",
    "<h2>正文</h2>",
    "<p>保留 <strong>重点</strong></p>",
    "<h3>私有附录</h3>",
    '<img src="/private.png">',
    "<h2>后续</h2>",
    '<img src="/public.png">',
  ]);
  const p = parseSnapshot(snap, "chapter", {
    ...defaults,
    fromHeading: "正文",
    excludeHeadings: "更新记录,私有附录",
  });
  assert.deepEqual(
    p.blocks.filter((b) => b.type === "heading").map((b) => b.text),
    ["正文", "后续"],
  );
  assert.equal(p.assets.length, 1);
  assert.equal(p.assets[0].url, "https://example.com/public.png");
  assert(p.blocks.some((b) => b.html?.includes("<strong>重点</strong>")));
});
test("missing starting heading never silently exports unrelated text", () => {
  const p = parseSnapshot(snapshot(["<h2>别的标题</h2>", "<p>正文</p>"]), "c", {
    ...defaults,
    fromHeading: "目标",
  });
  assert.equal(p.blocks.length, 0);
  assert(
    p.issues.some(
      (i) => i.code === "heading-not-found" && i.severity === "error",
    ),
  );
});
test("complex tables and truncated snapshots are flagged", () => {
  const s = snapshot([
    '<table><tr><th colspan="2">合并</th></tr><tr><td>A</td><td>B</td></tr></table>',
  ]);
  s.scrollTruncated = true;
  s.canvasCount = 1;
  const p = parseSnapshot(s, "c", defaults);
  assert.equal(p.blocks[0].type, "table");
  assert.deepEqual(p.blocks[0].rows, [["合并"], ["A", "B"]]);
  assert(p.issues.some((i) => i.code === "complex-table"));
  assert(p.issues.some((i) => i.code === "scroll-limit"));
  assert(p.issues.some((i) => i.code === "canvas-content"));
});
test("code nested in a quote keeps whitespace, language and surrounding text in order", () => {
  const code = 'if ready:\n    print("保存")\n';
  const p = parseSnapshot(
    snapshot([
      `<blockquote><p>运行前</p><div><pre><code class="highlight language-python extra">${code}</code></pre></div><p>运行后 <strong>核对</strong></p></blockquote>`,
    ]),
    "c",
    defaults,
  );
  assert.deepEqual(
    p.blocks.map((b) => b.type),
    ["quote", "code", "quote"],
  );
  assert.equal(p.blocks[1].text, code);
  assert.equal(p.blocks[1].language, "python");
  assert.equal(p.blocks[0].text, "运行前");
  assert(p.blocks[2].html?.includes("<strong>核对</strong>"));
  assert.equal(new Set(p.blocks.map((b) => b.id)).size, 3);
});

test("empty list markers are removed after sanitization without dropping image assets or real items", () => {
  const parsed = parseSnapshot(
    snapshot([
      "<ul><li></li><li>&nbsp;<br>\u200b</li><li><button>工具</button></li></ul>",
      '<ol><li> </li><li><strong>第一项</strong></li><li><a href="/next">第二项</a></li></ol>',
      '<ul><li><img src="/diagram.png" alt="示意图"></li></ul>',
    ]),
    "c",
    defaults,
  );
  // sanitize-html removes button markup but retains its text: it is meaningful,
  // unlike the empty icon/image containers produced by the old DOM collector.
  assert.deepEqual(
    parsed.blocks.filter((b) => b.type === "list").map((b) => b.items),
    [
      ["工具"],
      [
        "<strong>第一项</strong>",
        '<a href="https://example.com/next">第二项</a>',
      ],
    ],
  );
  assert.equal(parsed.assets.length, 1);
  assert(parsed.blocks.some((b) => b.type === "image"));
});

test("empty virtual bullet and ordered blocks do not become blank markers", () => {
  const snap = snapshot([
    "<div><br></div>",
    "<div>\u200b&nbsp;</div>",
    "<div>正常条目</div>",
  ]);
  snap.pieces.forEach((p, i) => (p.kind = i === 1 ? "ordered" : "bullet"));
  assert.deepEqual(
    parseSnapshot(snap, "c", defaults).blocks.map((b) => b.items),
    [["正常条目"]],
  );
});
test("bounded workers never exceed the configured concurrency and release rejected slots", async () => {
  const sem = new Semaphore(2);
  let current = 0,
    max = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 9 }, (_, i) =>
      sem.run(async () => {
        current++;
        max = Math.max(max, current);
        await wait(5);
        current--;
        if (i === 2) throw new Error("expected");
        return i;
      }),
    ),
  );
  assert.equal(max, 2);
  assert.equal(current, 0);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 8);
  let count = 0;
  await pool([1, 2, 3], 2, async () => {
    count++;
  });
  assert.equal(count, 3);
});
test("version comparison identifies changes and job defaults stay isolated", () => {
  const a = parseSnapshot(snapshot(["<p>原文</p>"]), "c", defaults).blocks;
  const b = parseSnapshot(snapshot(["<p>修改</p>"]), "c", defaults).blocks;
  assert.equal(diffBlocks(a, a), "与上次采集内容一致");
  assert(diffBlocks(a, b).includes("新增或修改 1"));
  const job = createJob("https://example.com", "/tmp");
  assert.equal(job.coverage.content, "not-requested");
  assert.equal(job.chapters.length, 0);
});

test("math source survives extraction and the bundled KaTeX renders MathML", async () => {
  const { default: katex } = await import("katex");
  const parsed = parseSnapshot(
    {
      ...snapshot(['<div data-latex="E = mc^2">E = mc²</div>']),
      pieces: [
        {
          id: "formula",
          kind: "math",
          html: '<div data-latex="E = mc^2">E = mc²</div>',
          text: "E = mc²",
        },
      ],
    },
    "c",
    defaults,
  );
  assert.equal(parsed.blocks[0].type, "math");
  assert.equal(parsed.blocks[0].text, "E = mc^2");
  const result = katex.renderToString(parsed.blocks[0].text, {
    throwOnError: false,
    output: "mathml",
  });
  assert(result.includes("<math"));
  assert(result.includes("<msup>"));
});

test("version comparison detects reordering, duplicate counts and formatting changes", () => {
  const blocks = parseSnapshot(
    snapshot(["<p>甲</p>", "<p>乙</p>"]),
    "c",
    defaults,
  ).blocks;
  assert.equal(
    diffBlocks(blocks, [blocks[1], blocks[0]]),
    "内容块顺序发生变化",
  );
  assert(
    diffBlocks([blocks[0], blocks[0]], [blocks[0]]).includes("删除或替换 1"),
  );
  assert(
    diffBlocks(
      [blocks[0]],
      [{ ...blocks[0], html: "<strong>甲</strong>" }],
    ).includes("新增或修改 1"),
  );
});
