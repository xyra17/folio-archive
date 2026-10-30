import * as cheerio from "cheerio";
import { hash, cleanInline, cleanListItems, issue } from "./core";
import type {
  Asset,
  Block,
  Issue,
  JobOptions,
  SourceAccess,
  Job,
  Chapter,
} from "../shared/types";
export interface Piece {
  id: string;
  html: string;
  text: string;
  kind?: string;
}
export interface Snapshot {
  extractionVersion?: number;
  access?: SourceAccess;
  capturedAt?: string;
  capture?: Chapter["capture"];
  discovery?: Job["discovery"];
  collectionTitle?: string;
  title: string;
  url: string;
  author: string;
  pieces: Piece[];
  links: {
    title: string;
    sourceNumber?: string;
    url: string;
    navigationLabel?: string;
    navigationKey?: string;
  }[];
  limited: boolean;
  restricted: boolean;
  canvasCount: number;
  scrollTruncated: boolean;
  pdfUrl?: string;
}

// Change when collection rules change; old checkpoints must be collected again.
export const EXTRACTION_VERSION = 3;

function splitQuotedCode(piece: Piece): Piece[] {
  const $ = cheerio.load(piece.html);
  const element = $("body").children().first();
  if (
    (!element.is("blockquote") && piece.kind !== "quote") ||
    !element.find("pre").length
  )
    return [piece];
  const pieces: Piece[] = [];
  let pending = "";
  const flush = () => {
    if (!pending) return;
    pieces.push({
      id: `${piece.id}-part-${pieces.length}`,
      html: `<blockquote>${pending}</blockquote>`,
      text: cheerio.load(pending).text(),
      kind: "quote",
    });
    pending = "";
  };
  const visit = (nodes: ReturnType<typeof element.contents>) => {
    nodes.each((_i, node) => {
      const child = $(node);
      if (child.is("pre")) {
        flush();
        pieces.push({
          id: `${piece.id}-part-${pieces.length}`,
          html: $.html(node),
          text: child.text(),
          kind: "code",
        });
      } else if (child.find("pre").length) visit(child.contents());
      else pending += $.html(node);
    });
  };
  visit(element.contents());
  flush();
  return pieces;
}
export function parseSnapshot(
  snapshot: Snapshot,
  chapterId: string,
  options: JobOptions,
): { blocks: Block[]; assets: Asset[]; issues: Issue[] } {
  let blocks: Block[] = [];
  const assets: Asset[] = [];
  const issues: Issue[] = [];
  for (const piece of snapshot.pieces.flatMap(splitQuotedCode)) {
    const $ = cheerio.load(piece.html);
    const element = $("body").children().first();
    const tag = element.prop("tagName")?.toLowerCase() ?? "p";
    const html = cleanInline(element.html() ?? "", snapshot.url);
    const text = element
      .text()
      .replace(/\u00a0/g, " ")
      .trim();
    const base = { id: piece.id, text, html };
    if (piece.kind?.startsWith("screenshot:")) {
      const kind = piece.kind.slice("screenshot:".length);
      blocks.push({
        ...base,
        type: "paragraph",
        text: `[组件截图：${kind}，仅保留当时可见画面，不含可编辑数据或交互内容]`,
        html: undefined,
      });
      issues.push(
        issue(
          "component-screenshot",
          `${kind} 已保存可见画面截图，不能代表全部数据或交互状态，请在原文核对`,
          { chapterId, blockId: piece.id },
        ),
      );
    } else if (
      /^h[1-6]$/.test(tag) ||
      /heading|header/.test(piece.kind ?? "")
    ) {
      const detected =
        Number(tag[1]) || Number((piece.kind ?? "").match(/[1-6]/)?.[0]) || 2;
      blocks.push({ ...base, type: "heading", level: detected });
    } else if (tag === "pre" || piece.kind === "code")
      blocks.push({
        ...base,
        type: "code",
        text: element.find("code").text() || text,
        language:
          `${element.find("code").attr("class") || ""} ${element.attr("class") || ""}`.match(
            /(?:language-|lang-|brush:\s*)([\w+-]+)/,
          )?.[1],
      });
    else if (tag === "table" || element.find("table").length) {
      const rows: string[][] = [];
      element.find("tr").each((_i, tr) => {
        rows.push(
          $(tr)
            .children("td,th")
            .map((_j, td) => $(td).text().trim())
            .get(),
        );
      });
      if (rows.length) blocks.push({ ...base, type: "table", rows });
      if (element.find("[colspan],[rowspan]").length)
        issues.push(
          issue("complex-table", "合并单元格已按可读内容展开，请核对表格结构", {
            chapterId,
            blockId: piece.id,
          }),
        );
    } else if (
      /^(board|bitable|sheet|file|iframe|embed|synced|diagram)/.test(
        piece.kind || "",
      )
    ) {
      blocks.push({
        ...base,
        type: "paragraph",
        text: `[未完整归档的组件：${piece.kind}] ${text}`,
        html: undefined,
      });
      issues.push(
        issue(
          "unsupported-component",
          `发现 ${piece.kind} 组件，当前未取得可编辑的完整内容，请在原文核对`,
          { chapterId, blockId: piece.id },
        ),
      );
    } else if (piece.kind === "bullet" || piece.kind === "ordered") {
      const items = cleanListItems([html], snapshot.url);
      if (items.length)
        blocks.push({
          ...base,
          type: "list",
          ordered: piece.kind === "ordered",
          items,
        });
    } else if (["ul", "ol"].includes(tag)) {
      const items = cleanListItems(
        element
          .children("li")
          .map((_i, li) => $(li).html() ?? "")
          .get(),
        snapshot.url,
      );
      if (items.length)
        blocks.push({
          ...base,
          type: "list",
          ordered: tag === "ol",
          items,
        });
    } else if (tag === "blockquote" || piece.kind === "quote")
      blocks.push({ ...base, type: "quote" });
    else if (tag === "hr") blocks.push({ ...base, type: "divider" });
    else if (piece.kind === "math")
      blocks.push({
        ...base,
        type: "math",
        text:
          element.attr("data-latex") ||
          element.find("annotation").text() ||
          text,
      });
    else if (text && tag !== "img") blocks.push({ ...base, type: "paragraph" });
    const imgs = tag === "img" ? element : element.find("img");
    imgs.each((i, img) => {
      const src = $(img).attr("src") || $(img).attr("data-src") || "";
      if (!src) return;
      let url: string;
      try {
        url = new URL(src, snapshot.url).href;
      } catch {
        return;
      }
      if (!/^(https?:|data:image\/|blob:)/i.test(url)) return;
      const assetId = hash(`${chapterId}:${url}`).slice(0, 24);
      if (!assets.some((a) => a.id === assetId))
        assets.push({
          id: assetId,
          url,
          chapterId,
          status: "pending",
          captureMode: piece.kind?.startsWith("screenshot:")
            ? "screenshot"
            : "original",
        });
      blocks.push({
        id: `${piece.id}-image-${i}`,
        type: "image",
        text: $(img).attr("alt") || "",
        assetId,
      });
    });
  }
  const skip = options.excludeHeadings
    .split(/[\n,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  let started = !options.fromHeading.trim();
  let excludedLevel = 0;
  let foundStart = started;
  blocks = blocks.filter((b) => {
    if (b.type === "heading") {
      if (!started && b.text.includes(options.fromHeading.trim())) {
        started = true;
        foundStart = true;
      }
      if (excludedLevel && (b.level ?? 2) <= excludedLevel) excludedLevel = 0;
      if (skip.some((s) => b.text.includes(s))) excludedLevel = b.level ?? 2;
    }
    return started && !excludedLevel;
  });
  if (!foundStart)
    issues.push(
      issue(
        "heading-not-found",
        `未找到起始标题“${options.fromHeading}”，请调整范围`,
        { chapterId, severity: "error" },
      ),
    );
  if (!blocks.length)
    issues.push(
      issue("empty-content", "未取得所选范围的正文，请检查登录状态与起始标题", {
        chapterId,
        severity: "error",
      }),
    );
  if (snapshot.scrollTruncated)
    issues.push(
      issue(
        "scroll-limit",
        "已达到滚动加载上限，当前快照可能不完整；可在设置提高上限后重新采集",
        { chapterId },
      ),
    );
  if (snapshot.canvasCount)
    issues.push(
      issue(
        "canvas-content",
        `发现 ${snapshot.canvasCount} 个画布组件，文字提取无法保证覆盖；请在原文核对画板`,
        { chapterId },
      ),
    );
  const used = new Set(blocks.map((b) => b.assetId).filter(Boolean));
  return { blocks, assets: assets.filter((a) => used.has(a.id)), issues };
}
export function blockHash(blocks: Block[]) {
  return hash(JSON.stringify(blocks.map(({ id, ...b }) => b)));
}
export function diffBlocks(previous: Block[], next: Block[]): string {
  const keys = (blocks: Block[]) =>
    blocks.map(({ id, ...b }) => hash(JSON.stringify(b)));
  const a = keys(previous),
    b = keys(next);
  if (a.length === b.length && a.every((key, i) => key === b[i]))
    return "与上次采集内容一致";
  const counts = (keys: string[]) => {
    const map = new Map<string, number>();
    for (const key of keys) map.set(key, (map.get(key) || 0) + 1);
    return map;
  };
  const left = counts(a),
    right = counts(b);
  const added = [...right].reduce(
    (sum, [key, n]) => sum + Math.max(0, n - (left.get(key) || 0)),
    0,
  );
  const removed = [...left].reduce(
    (sum, [key, n]) => sum + Math.max(0, n - (right.get(key) || 0)),
    0,
  );
  return added || removed
    ? `新增或修改 ${added} 个内容块，删除或替换 ${removed} 个内容块`
    : "内容块顺序发生变化";
}
