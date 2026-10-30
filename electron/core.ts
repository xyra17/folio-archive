import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import sanitize from "sanitize-html";
import * as cheerio from "cheerio";
import type { Job, JobOptions, Issue } from "../shared/types";
import { templates } from "../shared/templates";
export const uid = () => randomUUID();
export const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export const now = () => new Date().toISOString();
export const defaults: JobOptions = {
  formats: ["pdf", "docx", "md"],
  template: "reading",
  fromHeading: "",
  excludeHeadings: "",
  aiReview: false,
};
export function webURL(value: string): string {
  const u = new URL(value.trim());
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw new Error("请输入不含账号密码的 HTTP 或 HTTPS 链接");
  return u.href;
}
export const redactURL = (value: string) => {
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "[来源]";
  }
};
export const safeName = (s: string) =>
  s
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 90) || "未命名文档";
export const escapeHTML = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function cleanInline(html: string, base: string): string {
  return sanitize(html, {
    allowedTags: [
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "code",
      "a",
      "br",
      "sub",
      "sup",
      "span",
    ],
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tag, a) => {
        let href = "";
        try {
          href = new URL(a.href ?? "", base).href;
        } catch {}
        return { tagName: "a", attribs: { href } };
      },
    },
  });
}
export function cleanListItems(items: string[], base: string): string[] {
  return items
    .map((item) => cleanInline(item, base))
    .filter(
      (item) =>
        cheerio
          .load(item)
          .text()
          .replace(/[\s\u200b-\u200f\ufeff]/g, "").length > 0,
    );
}
export function issue(
  code: string,
  message: string,
  extra: Partial<Issue> = {},
): Issue {
  return {
    id: uid(),
    code,
    message,
    severity: "warning",
    origin: "rule",
    ...extra,
  };
}
export function assertOptions(options: JobOptions): JobOptions {
  if (
    !Array.isArray(options.formats) ||
    !options.formats.length ||
    options.formats.some((f) => !["pdf", "md", "docx", "html"].includes(f))
  )
    throw new Error("请至少选择一种有效导出格式");
  if (!templates.some((t) => t.id === options.template))
    throw new Error("排版模板无效");
  return {
    ...options,
    fromHeading: String(options.fromHeading).slice(0, 200),
    excludeHeadings: String(options.excludeHeadings).slice(0, 1000),
    aiReview: !!options.aiReview,
  };
}
export function createJob(url: string, outputRoot: string): Job {
  const id = uid();
  const host = new URL(url).hostname;
  return {
    id,
    url,
    title: "正在识别文档…",
    source: /feishu\.cn$|larksuite\.com$/.test(host)
      ? "feishu"
      : /geekbang\.com$/.test(host)
        ? "geekbang"
        : /\.pdf(?:$|\?)/i.test(url)
          ? "pdf"
          : "web",
    status: "inspecting",
    phase: "discover",
    createdAt: now(),
    updatedAt: now(),
    chapters: [],
    issues: [],
    options: { ...defaults },
    exports: [],
    outputDir: path.join(outputRoot, id),
    collection: "",
    tags: [],
    coverage: { content: "not-requested", layout: "not-requested", calls: 0 },
    events: [],
  };
}
export async function atomicWrite(file: string, data: string | Uint8Array) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${uid()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}
export function within(root: string, file: string): boolean {
  const p = path.relative(path.resolve(root), path.resolve(file));
  return !p.startsWith("..") && !path.isAbsolute(p);
}
export async function pool<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (queue.length) {
        const item = queue.shift()!;
        await task(item);
      }
    }),
  );
}
export class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit)
      await new Promise<void>((r) => this.queue.push(r));
    else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
export function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("任务已暂停"));
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("任务已暂停"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
