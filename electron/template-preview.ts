import { createJob } from "./core";
import { documentHTML } from "./export";
import { templateFor } from "../shared/templates";
import type { Job, TemplateId } from "../shared/types";

export function templateSample(template: TemplateId, outputRoot = ""): Job {
  const theme = templateFor(template);
  const job = createJob("https://example.com/reading", outputRoot);
  job.title = "从阅读到知识整理";
  job.updatedAt = "2026-10-29T00:00:00.000Z";
  job.options = { ...job.options, template: theme.id };
  job.chapters = [
    {
      id: "sample",
      title: job.title,
      url: job.url,
      author: "拾页 · 排版示例",
      selected: true,
      status: "ready",
      assets: [],
      blocks: [
        {
          id: "p1",
          type: "paragraph",
          text: "一篇文章的价值，常常在读完之后才慢慢显现。保存原文，也保留当时的上下文，让读过的内容成为日后可以查阅、批注和连接的知识。",
        },
        { id: "h1", type: "heading", level: 2, text: "为阅读留一点空间" },
        {
          id: "p2",
          type: "paragraph",
          text: "标题帮助定位，段落承载思考，留白让阅读有了停顿。把一篇长文整理成适合自己的版式，减少视觉干扰，也让重点更容易被找到。",
          html: "标题帮助定位，段落承载思考，<strong>留白让阅读有了停顿</strong>。把一篇长文整理成适合自己的版式，减少视觉干扰，也让重点更容易被找到。",
        },
        {
          id: "q1",
          type: "quote",
          text: "收藏的意义，是在需要的时候，重新找到那些值得思考的内容。",
        },
        { id: "h2", type: "heading", level: 2, text: "选择合适的保存方式" },
        {
          id: "table",
          type: "table",
          text: "格式与用途",
          rows: [
            ["文件格式", "适合的时刻"],
            ["PDF", "安静阅读、打印与分享"],
            ["Word", "继续编辑、批注与整理"],
            ["Markdown", "收入笔记、连接新的想法"],
          ],
        },
        {
          id: "p3",
          type: "paragraph",
          text: "代码保留缩进与换行，内容结构也可以继续使用：",
        },
        {
          id: "code",
          type: "code",
          language: "javascript",
          text: 'const collection = {\n  title: "随时可读",\n  formats: ["pdf", "docx", "md", "html"]\n};',
        },
      ],
    },
  ];
  return job;
}

export const templatePreviewHTML = (template: TemplateId) =>
  documentHTML(templateSample(template));
