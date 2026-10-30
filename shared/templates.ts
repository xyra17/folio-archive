import type { TemplateId } from "./types";

export const templates = [
  {
    id: "reading",
    name: "清爽阅读",
    description: "舒展行距与轻盈标题，适合日常长文。",
    detail: "无衬线 · 11 pt · 舒展留白",
    accent: "21695F",
    font: "PingFang SC",
    wordFont: "Arial Unicode MS",
    titleFont: "Arial Unicode MS",
    titleSize: 48,
    size: 22,
    line: 360,
    after: 160,
    margin: 1134,
    headings: [36, 29, 25, 22],
    tableFill: "EFF5F3",
    tableInk: "233D38",
    codeFill: "F3F6F5",
    codeInk: "253B35",
    css: `body{--accent:#21695f;--tint:#eff5f3;--code-bg:#f3f6f5;--code-ink:#253b35;--page-inset:20mm;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:11pt;line-height:1.85}
      .document-header{margin-bottom:26px}.document-title{font-size:29pt;font-weight:600;letter-spacing:-.035em;max-width:20em}.eyebrow:before{content:"";width:18px;height:3px;background:var(--accent)}
      .chapter h2,.chapter h3{font-weight:600}.chapter blockquote{padding:2px 0 2px 20px;border-left:2px solid #b7d0c9;color:#3b5b54}.chapter th{background:var(--tint);color:#233d38}
      @page{margin:18mm 20mm 20mm}`,
  },
  {
    id: "print",
    name: "书刊印刷",
    description: "居中宋体与黑白层级，适合打印装订。",
    detail: "宋体 · 11 pt · 经典书页",
    accent: "252525",
    font: "Songti SC",
    wordFont: "Songti SC",
    titleFont: "Songti SC",
    titleSize: 48,
    size: 22,
    line: 360,
    after: 140,
    margin: 1248,
    headings: [34, 29, 25, 22],
    tableFill: "FFFFFF",
    tableInk: "252525",
    codeFill: "F5F5F5",
    codeInk: "252525",
    css: `body{--accent:#252525;--tint:#f5f5f5;--code-bg:#f5f5f5;--code-ink:#252525;--page-top:20mm;--page-inset:22mm;font-family:"Songti SC","SimSun",serif;font-size:11pt;line-height:1.8;color:#262626}
      .document-header{text-align:center;padding:10px 0 8px;margin-bottom:28px}.eyebrow{justify-content:center;letter-spacing:.12em}.document-title{font-size:28pt;font-weight:600;line-height:1.45;letter-spacing:.025em;margin:20px 0 16px}.meta{justify-content:center}
      .chapter h2,.chapter h3{font-family:"Songti SC","SimSun",serif;font-weight:600}.chapter blockquote{margin:20px 24px;padding:0;color:#555}.chapter th{background:white;border-top:1.5px solid #333;border-bottom:1px solid #666}.chapter td{border-bottom-color:#ddd}.toc{background:white;border-top:1px solid #bbb;border-bottom:1px solid #bbb}.code-block{border-radius:0}.document-end{text-align:center}a{color:inherit}
      @page{margin:20mm 22mm 20mm}`,
  },
  {
    id: "technical",
    name: "技术手册",
    description: "紧凑章节与清晰代码，适合技术资料。",
    detail: "无衬线 · 10 pt · 结构清晰",
    accent: "2455A4",
    font: "PingFang SC",
    wordFont: "Arial Unicode MS",
    titleFont: "Arial Unicode MS",
    titleSize: 44,
    size: 20,
    line: 310,
    after: 130,
    margin: 960,
    headings: [32, 27, 23, 21],
    tableFill: "EAF0F9",
    tableInk: "18365F",
    codeFill: "EFF3F9",
    codeInk: "203B61",
    css: `body{--accent:#2455a4;--tint:#eaf0f9;--code-bg:#eff3f9;--code-ink:#203b61;--page-top:17mm;--page-inset:17mm;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:10pt;line-height:1.75}
      .document-header{margin-bottom:22px}.eyebrow{font-family:Menlo,Consolas,monospace}.document-title{font-size:26pt;font-weight:650;letter-spacing:-.025em;max-width:22em}.chapter h2,.chapter h3{margin-top:24px;font-weight:600}.chapter h3{padding-left:12px;border-left:3px solid var(--accent)}
      .chapter blockquote{padding-left:18px;border-left:2px solid #a7bbda;color:#435d7d}.chapter th{background:#eaf0f9;color:#18365f}.chapter tbody tr:nth-child(even){background:#f7f9fc}.code-block{border:1px solid #d9e2ef}.code-label{background:#e6edf7;color:#435d7d}.code-block pre{font-size:8.5pt;line-height:1.65}.toc{background:#f4f7fb}
      @page{margin:17mm 17mm 20mm}`,
  },
  {
    id: "journal",
    name: "杂志精选",
    description: "大宋体标题与宽幅引文，适合收藏分享。",
    detail: "宋体 · 11.5 pt · 杂志构图",
    accent: "963747",
    font: "Songti SC",
    wordFont: "Songti SC",
    titleFont: "Songti SC",
    titleSize: 64,
    size: 23,
    line: 370,
    after: 175,
    margin: 1200,
    headings: [38, 31, 26, 23],
    tableFill: "F3F3F3",
    tableInk: "303039",
    codeFill: "F5F5F6",
    codeInk: "303039",
    css: `body{--accent:#963747;--tint:#f3f3f3;--code-bg:#f5f5f6;--code-ink:#303039;--page-top:19mm;--page-inset:21mm;font-family:"Songti SC","SimSun",serif;font-size:11.5pt;line-height:1.85;color:#242429}
      .document-header{padding-top:4px;margin-bottom:26px}.eyebrow{color:var(--accent);font-weight:600}.eyebrow:before{content:"";height:13px;width:3px;background:var(--accent)}.document-title{font-family:"Songti SC","SimSun",serif;font-size:35pt;font-weight:600;line-height:1.3;letter-spacing:-.025em;margin:15px 0 18px;max-width:18em}
      .chapter h2,.chapter h3{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-weight:600}.chapter h3{font-size:15pt;margin-top:28px}.chapter blockquote{margin:22px 0;padding:5px 18px 5px 28px;font-size:14pt;line-height:1.8;position:relative;color:#37343b}.chapter blockquote:before{content:"“";font-family:Georgia,serif;position:absolute;left:0;top:-10px;color:var(--accent);font-size:32pt;line-height:1.3}.chapter th{background:#f3f3f3;font-family:"PingFang SC",sans-serif;color:#303039}.document-end{border-top-color:#c9c9cd}
      @page{margin:19mm 21mm 20mm}`,
  },
] as const;

export const templateFor = (id: TemplateId) =>
  templates.find((t) => t.id === id) || templates[0];
