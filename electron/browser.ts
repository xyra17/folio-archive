import { BrowserWindow, session, type Session } from "electron";
import fs from "node:fs";
import { hash, wait, webURL } from "./core";
import type { Snapshot, Piece } from "./extract";
import { detectSourceAccess } from "../shared/access";
import type { SourceAccess, Job } from "../shared/types";
import { directoryDOM, mergeDirectory, type DirectoryLink } from "./directory";

export class SourceAccessError extends Error {
  constructor(readonly access: SourceAccess) {
    super(
      access.kind === "export-restricted"
        ? "EXPORT_RESTRICTED"
        : "LOGIN_REQUIRED",
    );
  }
}

// Runs in an isolated source renderer. It returns only page data, never application instructions.
export function readDOM(): Snapshot {
  const blocked =
    'script,style,nav,aside,footer,button,input,textarea,select,.toolbar,[role="toolbar"],[role="navigation"],[role="menu"],[role="dialog"],[role="alertdialog"],.toast,[aria-hidden="true"],[hidden],#mdbook-help-container,.menu-bar,.menu-title,.recommend-box,.recommend-item-box,.comment-box,.CommentList,.Recommendations-Main,[data-ad],.adsbygoogle';
  // Web components can move code and images out of the light DOM after hydration.
  // Read a detached, flattened copy; keep the source page and its interactions intact.
  const flatten = (node: Node): Node => {
    if (node instanceof Element) {
      if (node.matches(blocked)) return document.createDocumentFragment();
      // Check live visibility before Readability detaches content from its CSS.
      const style = getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.contentVisibility === "hidden"
      )
        return document.createDocumentFragment();
    }
    if (node instanceof HTMLSlotElement) {
      const fragment = document.createDocumentFragment();
      const assigned = node.assignedNodes({ flatten: true });
      for (const child of assigned.length ? assigned : node.childNodes)
        fragment.appendChild(flatten(child));
      return fragment;
    }
    const copy = node.cloneNode(false);
    if (node instanceof HTMLImageElement)
      (copy as Element).setAttribute("src", node.currentSrc || node.src);
    if (node instanceof HTMLAnchorElement)
      (copy as Element).setAttribute("href", node.href);
    const children =
      node instanceof Element && node.shadowRoot
        ? node.shadowRoot.childNodes
        : node.childNodes;
    for (const child of children) copy.appendChild(flatten(child));
    return copy;
  };
  const source = flatten(document) as Document;
  const dedicated = [
    ".bear-web-x-container",
    ".docx-body",
    ".docx-editor",
    '[data-testid="docx-content"]',
    "#content_views",
    ".Post-RichTextContainer .RichText",
    ".Post-RichText",
    ".QuestionAnswer-content .RichContent-inner",
    ".AnswerItem .RichContent-inner",
    '[data-article-body="true"]',
    '[itemprop="articleBody"]',
  ];
  const generic = [
    "article.markdown-body",
    ".article-content",
    ".post-content",
    ".entry-content",
    "article .prose",
    "article .markdown-body",
    "article",
    "main",
    '[role="main"]',
  ];
  const score = (element: Element) => {
    const clone = element.cloneNode(true) as Element;
    clone.querySelectorAll(blocked).forEach((n) => n.remove());
    const length = (clone.textContent || "").replace(/\s+/g, " ").trim().length;
    const links = Array.from(clone.querySelectorAll("a")).reduce(
      (sum, a) => sum + (a.textContent || "").trim().length,
      0,
    );
    return Math.max(0, length - links * 1.5);
  };
  const candidates = (selectors: string[]) =>
    selectors
      .flatMap((s) => Array.from(source.querySelectorAll(s)))
      .filter((e, i, all) => all.indexOf(e) === i && !e.closest(blocked))
      .map((element) => ({ element, score: score(element) }))
      .filter((c) => c.score > 30);
  const explicit = candidates(dedicated).sort((a, b) => b.score - a.score)[0];
  const articles = candidates(generic);
  const bestScore = Math.max(0, ...articles.map((c) => c.score));
  // Prefer a focused body over its wrapper when they contain comparable prose.
  const article = articles.find((c) => c.score >= bestScore * 0.8);
  let root = explicit?.element || article?.element || source.body;
  let reader: { title?: string; byline?: string; content?: string } | null =
    null;
  if (!explicit && !root.querySelector("[data-block-id]")) {
    try {
      const Readability = (globalThis as any).__folioReadability;
      reader = Readability
        ? new Readability(source.cloneNode(true), {
            keepClasses: true,
          }).parse()
        : null;
      if (reader?.content) {
        const extracted = document.createElement("article");
        extracted.innerHTML = reader.content;
        // An <article> may be a recommendation card rather than the main story.
        if (root === source.body || score(extracted) > bestScore * 1.25)
          root = extracted;
      }
    } catch {}
    if (root === source.body)
      root = source.querySelector("main") || source.body;
  }
  const virtual = Array.from(root.querySelectorAll("[data-block-id]")).filter(
    (e) => {
      if (
        ["page", "table_cell"].includes(e.getAttribute("data-block-type") || "")
      )
        return false;
      let parent = e.parentElement?.closest("[data-block-id]");
      while (parent && parent !== root) {
        if (parent.getAttribute("data-block-type") !== "page") return false;
        parent = parent.parentElement?.closest("[data-block-id]") || null;
      }
      return true;
    },
  );
  const selector =
    "h1,h2,h3,h4,h5,h6,p,pre,table,blockquote,ul,ol,img,hr,[data-latex],.katex-display";
  const selected = virtual.length
    ? virtual
    : Array.from(root.querySelectorAll(selector)).filter((e) => {
        let parent = e.parentElement;
        while (parent && parent !== root) {
          if (parent.matches(selector)) return false;
          parent = parent.parentElement;
        }
        return !e.closest(blocked) && !e.closest("[hidden]");
      });
  const pieces: Piece[] = selected.map((e, i) => {
    const clone = e.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(blocked).forEach((n) => n.remove());
    let kind =
      e.getAttribute("data-block-type") ||
      e.className?.toString().match(/heading[1-6]?|code-block/)?.[0] ||
      "";
    if (
      clone.querySelector("annotation") ||
      clone.matches("[data-latex],.katex-display")
    )
      kind = "math";
    const originals = Array.from(e.querySelectorAll("img"));
    clone.querySelectorAll("img").forEach((img, index) => {
      const original = originals[index] as HTMLImageElement;
      const src =
        original?.getAttribute("data-src") ||
        original?.getAttribute("data-original") ||
        original?.getAttribute("data-actualsrc") ||
        original?.currentSrc ||
        original?.getAttribute("src");
      if (src) img.setAttribute("src", src);
    });
    if (e.matches("img")) {
      const original = e as HTMLImageElement;
      clone.setAttribute(
        "src",
        original.getAttribute("data-src") ||
          original.getAttribute("data-original") ||
          original.getAttribute("data-actualsrc") ||
          original.currentSrc ||
          original.src,
      );
    }
    if (
      [
        "text",
        "heading1",
        "heading2",
        "heading3",
        "heading4",
        "heading5",
        "heading6",
        "bullet",
        "ordered",
        "quote",
      ].includes(kind)
    ) {
      const zone = clone.querySelector(".zone-container");
      if (zone) {
        clone.replaceChildren(...Array.from(zone.childNodes));
      }
    }
    const text =
      clone.textContent?.replace(/[\u200b-\u200f\ufeff]/g, "").trim() ?? "";
    return {
      id: e.getAttribute("data-block-id") || `${e.tagName.toLowerCase()}-${i}`,
      html: clone.outerHTML,
      text,
      kind,
    };
  });
  if (!pieces.length && root.textContent?.trim())
    pieces.push({
      id: "body",
      html: `<p>${root.textContent.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`,
      text: root.textContent,
    });
  const links: Snapshot["links"] = [];
  const knowledgeBase = /(^|\.)(feishu\.cn|larksuite\.com|geekbang\.com)$/.test(
    location.hostname,
  );
  const chapterSelector = knowledgeBase
    ? 'nav a[href],aside a[href],[role="navigation"] a[href],.toc a[href],[data-chapter] a[href]'
    : "[data-chapter-list] a[href],[data-chapter] a[href],.toc a[href]";
  for (const a of document.querySelectorAll(chapterSelector)) {
    const el = a as HTMLAnchorElement;
    const title = el.innerText?.trim();
    if (
      title &&
      /^https?:/.test(el.href) &&
      new URL(el.href).origin === location.origin &&
      !el.hash
    )
      links.push({ title, url: el.href });
  }
  if (/geekbang\.com$/.test(location.hostname))
    for (const button of document.querySelectorAll("button")) {
      const title = (button as HTMLElement).innerText?.trim();
      if (
        title &&
        /^(\d+[.、]|第.+[章节]|学前|前言)/.test(title) &&
        !/下一节|上一节/.test(title)
      )
        links.push({ title, url: location.href, navigationLabel: title });
    }
  const viewer = document.querySelector(
    'embed[type="application/pdf"],iframe[src*=".pdf"],iframe[src*="/pdf/"],object[type="application/pdf"]',
  );
  const pdfLink = Array.from(document.querySelectorAll("a[href]")).find((a) =>
    /\.pdf(?:$|\?)/i.test((a as HTMLAnchorElement).href),
  );
  const raw =
    viewer?.getAttribute("src") ||
    viewer?.getAttribute("data") ||
    (pdfLink as HTMLAnchorElement)?.href;
  let pdfUrl: string | undefined;
  if (raw) {
    try {
      let u = new URL(raw, location.href);
      for (let i = 0; i < 3; i++) {
        const nested = u.searchParams.get("file");
        if (!nested) break;
        const next = new URL(nested, u);
        if (!/^https?:$/.test(next.protocol)) break;
        u = next;
      }
      if (/^https?:$/.test(u.protocol)) pdfUrl = u.href;
    } catch {}
  }
  const bodyText = document.body.innerText;
  const accessText = root === source.body ? bodyText : root.textContent || "";
  const visible = (el: Element) =>
    !!el.getClientRects().length &&
    getComputedStyle(el).visibility !== "hidden";
  const gateSelector =
    '[data-paywall],.paywall,.paywall-content,.paywall-overlay,[data-testid*="paywall"],.subscribe-wall,.purchase-tip,.vip-limit,.permission-tip,.permission-dialog,[data-permission-tip],[role="dialog"]';
  const gates = Array.from(document.querySelectorAll(gateSelector)).filter(
    visible,
  );
  const prompts = Array.from(
    document.querySelectorAll('p,button,[role="button"],span,div'),
  ).filter((el) => {
    if (
      !visible(el) ||
      el.closest(
        "pre,code,blockquote,nav,header,footer,aside,.recommend-box,.recommend-item-box,.Recommendations-Main,[data-ad]",
      )
    )
      return false;
    const text = (el as HTMLElement).innerText?.trim() || "";
    return (
      text.length > 0 &&
      text.length < 200 &&
      /^(?:请(?:先)?登录|登录后|扫码登录|登录以查看|没有访问权限|无权访问|暂无访问权限|申请(?:查看|访问)权限|请求访问权限|本节为部分预览|(?:当前|本文|本篇|此文|此内容|该内容|本节|文章)(?:为|是|仅|只)|试读(?:结束|到此)|免费预览|剩余内容|完整内容|全部内容|(?:开通|购买|订阅|升级|加入).{0,16}(?:会员|后|解锁|阅读全文|继续阅读)|sign in to|log in to|subscribe to|subscription required|become a member|preview only|end of.*preview|access denied|request access)/i.test(
        text,
      )
    );
  });
  const collapsed = Array.from(
    document.querySelectorAll(
      ".RichContent.is-collapsed,.read-more-mask,.hide-article-box",
    ),
  ).some(visible);
  const permissionText = Array.from(
    document.querySelectorAll(
      ".permission-tip,.permission-dialog,[data-permission-tip]",
    ),
  )
    .filter(visible)
    .map((el) => el.textContent)
    .join(" ");
  const access: SourceAccess = (globalThis as any).__folioDetectAccess({
    title: document.title,
    bodyText,
    contentText: accessText,
    gateText: [...gates, ...prompts]
      .map((el) => (el as HTMLElement).innerText?.slice(0, 1000) || "")
      .join("\n"),
    loginForm:
      /\/(?:login|accounts)\b/i.test(location.pathname) &&
      !!document.querySelector(
        'input[type="password"],input[type="tel"],input[type="email"],form input',
      ),
    collapsed,
    exportDisabled:
      Array.from(
        document.querySelectorAll('[data-export-disabled="true"]'),
      ).some(visible) || /禁止下载|禁止导出|不允许下载/.test(permissionText),
  });
  const title =
    document.querySelector(
      "h1.title-article,h1.title,h1.Post-Title,.article-title",
    )?.textContent ||
    document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content") ||
    document.querySelector("h1.article-title")?.textContent ||
    reader?.title ||
    root.querySelector("h1")?.textContent ||
    document.querySelector("h1")?.textContent ||
    document.title;
  return {
    extractionVersion: 3,
    title: title?.trim() || "未命名文档",
    url: location.href,
    author:
      document.querySelector('meta[name="author"]')?.getAttribute("content") ||
      document.querySelector('[itemprop="author"]')?.textContent?.trim() ||
      reader?.byline ||
      "",
    pieces,
    links,
    access,
    limited: !["available", "export-restricted"].includes(access.kind),
    restricted: access.kind === "export-restricted",
    canvasCount: root.querySelectorAll("canvas").length,
    scrollTruncated: false,
    pdfUrl,
  };
}

function expandArticle() {
  const controls = document.querySelectorAll(
    'button,[role="button"],a.btn-readmore,a.ContentItem-expandButton',
  );
  for (const control of controls) {
    const label = (control.textContent || "").replace(/\s+/g, "").trim();
    if (
      !/^(展开全文|阅读全文|展开阅读全文|展开全部|Readmore|Continuereading)$/i.test(
        label,
      )
    )
      continue;
    if (
      !control.getBoundingClientRect().height ||
      control.closest("nav,header,footer,aside")
    )
      continue;
    if (
      control instanceof HTMLAnchorElement &&
      control.getAttribute("href") &&
      !/^(#|javascript:)/i.test(control.getAttribute("href")!)
    )
      continue;
    (control as HTMLElement).click();
    return true;
  }
  return false;
}

function scrollSource(reset: boolean | number | null) {
  const root =
    document.querySelector(
      '.bear-web-x-container,.docx-body,.docx-editor,#content_views,.Post-RichText,.RichContent-inner,[data-article-body="true"],article.markdown-body,article,main',
    ) ?? document.body;
  let el: Element | null = root;
  let target: Element = document.scrollingElement ?? document.documentElement;
  while (el && el !== document.body) {
    const css = getComputedStyle(el);
    if (
      el.scrollHeight > el.clientHeight + 100 &&
      /auto|scroll/.test(css.overflowY)
    ) {
      target = el;
      break;
    }
    el = el.parentElement;
  }
  if (reset === true) target.scrollTop = 0;
  else if (typeof reset === "number") target.scrollTop = reset;
  else if (reset === false)
    target.scrollTop += Math.max(400, target.clientHeight * 0.75);
  return {
    top: target.scrollTop,
    height: target.scrollHeight,
    bottom: target.scrollTop + target.clientHeight >= target.scrollHeight - 4,
  };
}

// Coordinates are viewport pixels, matching capturePage's device-independent rect.
function componentRect(id: string) {
  const el = document.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (
    rect.width < 30 ||
    rect.height < 30 ||
    rect.width > innerWidth - 4 ||
    rect.height > innerHeight - 4 ||
    rect.bottom <= 0 ||
    rect.top >= innerHeight ||
    getComputedStyle(el).visibility !== "visible" ||
    /加载中|正在加载|无权访问|没有权限|暂无权限|登录后|loading/i.test(
      el.textContent || "",
    ) ||
    (!el.textContent?.trim() &&
      !el.querySelector("canvas,svg,img,iframe,embed"))
  )
    return null;
  const x = Math.floor(rect.x),
    y = Math.floor(rect.y);
  const width = Math.ceil(rect.right) - x,
    height = Math.ceil(rect.bottom) - y;
  const visible =
    x >= 0 && y >= 0 && x + width <= innerWidth && y + height <= innerHeight;
  const unobscured =
    visible &&
    [
      [x + 2, y + 2],
      [x + width - 3, y + 2],
      [x + width / 2, y + height / 2],
      [x + 2, y + height - 3],
      [x + width - 3, y + height - 3],
    ].every(([px, py]) => {
      const top = document.elementFromPoint(px, py);
      return top === el || (top && el.contains(top));
    });
  return {
    x,
    y,
    width,
    height,
    viewportHeight: innerHeight,
    visible: !!unobscured,
  };
}
export class SourceBrowser {
  private readonly readability = fs.readFileSync(
    require.resolve("@mozilla/readability/Readability.js"),
    "utf8",
  );
  readonly session: Session = session.fromPartition("persist:folio-sources");
  private pdfs = new Map<number, string>();
  private windows = new Set<BrowserWindow>();
  constructor() {
    this.session.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    this.session.webRequest.onCompleted(
      { urls: ["http://*/*", "https://*/*"] },
      (details) => {
        const type = Object.entries(details.responseHeaders ?? {})
          .find(([k]) => k.toLowerCase() === "content-type")?.[1]
          ?.join("");
        if (
          type?.includes("application/pdf") &&
          details.webContentsId !== undefined
        )
          this.pdfs.set(details.webContentsId, details.url);
      },
    );
  }
  make(show = false) {
    const win = new BrowserWindow({
      show,
      width: 1200,
      height: 900,
      title: "拾页 · 来源页面",
      webPreferences: {
        session: this.session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    const contentsId = win.webContents.id;
    this.windows.add(win);
    win.on("closed", () => {
      this.windows.delete(win);
      this.pdfs.delete(contentsId);
    });
    const guard = (sourceWindow: BrowserWindow) => {
      sourceWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (!show || !/^https?:\/\//i.test(url)) return { action: "deny" };
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            show: true,
            width: 1000,
            height: 800,
            webPreferences: {
              session: this.session,
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              webSecurity: true,
            },
          },
        };
      });
      sourceWindow.webContents.on("did-create-window", (child) => {
        this.windows.add(child);
        child.on("closed", () => this.windows.delete(child));
        guard(child);
      });
      sourceWindow.webContents.on("will-navigate", (event, url) => {
        if (!/^https?:/.test(url)) event.preventDefault();
      });
    };
    guard(win);
    return win;
  }
  async load(url: string, signal?: AbortSignal, show = false) {
    webURL(url);
    const win = this.make(show);
    const abort = () => {
      if (!win.isDestroyed()) win.destroy();
    };
    signal?.addEventListener("abort", abort, { once: true });
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        win.loadURL(url),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("页面加载超时，请检查网络或登录状态")),
            35000,
          );
        }),
      ]);
      await wait(450, signal);
      return win;
    } catch (error) {
      if (!win.isDestroyed()) win.destroy();
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  async pdfProbe(url: string, signal?: AbortSignal) {
    try {
      const response = await this.session.fetch(url, {
        method: "HEAD",
        signal: AbortSignal.any([
          signal ?? new AbortController().signal,
          AbortSignal.timeout(10000),
        ]),
      });
      return (
        response.ok &&
        /application\/pdf/i.test(response.headers.get("content-type") ?? "")
      );
    } catch {
      return false;
    }
  }
  private async settled(
    win: BrowserWindow,
    signal?: AbortSignal,
  ): Promise<Snapshot> {
    await win.webContents.executeJavaScript(
      `(()=>{${this.readability}\n globalThis.__folioReadability = Readability; globalThis.__folioDetectAccess = (${detectSourceAccess.toString()});})()`,
    );
    let last: Snapshot | undefined;
    let length = -1;
    let stable = 0;
    let expanded = false;
    for (let i = 0; i < 45; i++) {
      if (signal?.aborted) throw new Error("任务已暂停");
      last = await win.webContents.executeJavaScript(
        `(${readDOM.toString()})()`,
      );
      last!.pdfUrl = this.pdfs.get(win.webContents.id) || last!.pdfUrl;
      if (last!.restricted || last!.pdfUrl) return last!;
      if (last!.limited && !expanded) {
        expanded = await win.webContents.executeJavaScript(
          `(${expandArticle.toString()})()`,
        );
        if (expanded) {
          await wait(350, signal);
          continue;
        }
      }
      if (last!.limited) {
        // Authentication hydration can briefly show a preview even in an authorized session.
        if (i < 16) {
          await wait(350, signal);
          continue;
        }
        return last!;
      }
      const n = last!.pieces.reduce((sum, p) => sum + p.text.length, 0);
      if (n > 40 && last!.pieces.some((p) => p.id !== "body") && n === length)
        stable++;
      else stable = 0;
      if (stable >= 2) return last!;
      length = n;
      await wait(350, signal);
    }
    if (!last || last.pieces.reduce((n, p) => n + p.text.length, 0) < 30)
      throw new Error("页面正文未就绪，请登录或稍后重试");
    return last;
  }
  private async directory(
    win: BrowserWindow,
    signal?: AbortSignal,
    limits = { steps: 200, chapters: 500 },
    target?: { title: string; navigationKey?: string },
  ) {
    const call = (action: Parameters<typeof directoryDOM>[0]) =>
      win.webContents.executeJavaScript(
        `(${directoryDOM.toString()})(${JSON.stringify(action)},${JSON.stringify(target)})`,
      ) as Promise<ReturnType<typeof directoryDOM>>;
    await call("reset");
    await wait(180, signal);
    let links: DirectoryLink[] = [];
    let previous = "";
    let stable = 0;
    let state = await call("read");
    let steps = 0;
    let finished = false;
    const deadline = Date.now() + 60000;
    for (; steps < limits.steps && Date.now() < deadline; steps++) {
      if (signal?.aborted) throw new Error("任务已暂停");
      state = await call(target ? "activate" : "read");
      if (state.ambiguous)
        throw new Error("目录存在同名章节且没有唯一标识，不能安全确定目标章节");
      if (state.activated)
        return { links, activated: true, evidence: undefined };
      links = mergeDirectory(links, state.links);
      if (links.length > limits.chapters) break;
      if (state.collapsed) {
        await call("expand");
        await wait(250, signal);
        continue;
      }
      const fingerprint = JSON.stringify([state.links, state.scrolling]);
      if (state.scrolling.every((s) => s.bottom) && fingerprint === previous)
        stable++;
      else stable = 0;
      previous = fingerprint;
      if (stable >= 2) {
        finished = true;
        break;
      }
      await call("advance");
      await wait(350, signal);
    }
    const enough =
      state.declared === undefined || links.length >= state.declared;
    const evidence: Job["discovery"] = {
      version: 1,
      status: !state.roots
        ? /\/(?:space\/wiki|wiki)\//.test(
            new URL(win.webContents.getURL()).pathname,
          )
          ? "unavailable"
          : "single-page"
        : finished && enough
          ? "observed"
          : "truncated",
      observed: links.length,
      declared: state.declared,
      steps: steps + 1,
      message: !state.roots
        ? "未识别到可遍历的章节目录，按当前文档保存"
        : finished && enough
          ? "已展开目录并滚动至末尾；完整性以本次可见目录为边界"
          : "目录未完成遍历或未达到页面声明数量，请核对范围或提高上限",
    };
    return {
      links,
      activated: false,
      evidence,
      collectionTitle: state.collectionTitle,
    };
  }
  async inspect(
    url: string,
    signal?: AbortSignal,
    limits?: { steps: number; chapters: number },
  ): Promise<Snapshot> {
    if (await this.pdfProbe(url, signal))
      return {
        title: decodeURIComponent(
          new URL(url).pathname.split("/").pop() || "原始 PDF",
        ),
        url,
        author: "",
        pieces: [],
        links: [],
        limited: false,
        restricted: false,
        canvasCount: 0,
        scrollTruncated: false,
        pdfUrl: url,
      };
    const win = await this.load(url, signal);
    try {
      const s: Snapshot = await this.settled(win, signal);
      s.pdfUrl = this.pdfs.get(win.webContents.id) || s.pdfUrl;
      if (!s.limited && !s.restricted && !s.pdfUrl) {
        const directory = await this.directory(win, signal, limits);
        s.links = directory.links;
        s.discovery = directory.evidence;
        s.collectionTitle = directory.collectionTitle;
      }
      return s;
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }
  async capture(
    url: string,
    maxSteps: number,
    signal: AbortSignal,
    navigationLabel?: string,
    onProgress?: (blocks: number, steps: number) => void,
    navigationKey?: string,
  ): Promise<Snapshot> {
    const win = await this.load(url, signal);
    const abort = () => {
      if (!win.isDestroyed()) win.destroy();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (navigationLabel) {
        const result = await this.directory(
          win,
          signal,
          { steps: 200, chapters: 1000 },
          { title: navigationLabel, navigationKey },
        );
        if (!result.activated)
          throw new Error("未找到目标目录章节，来源结构可能已变化");
        await wait(350, signal);
      }
      let ready = await this.settled(win, signal);
      if (ready.limited || ready.restricted)
        throw new SourceAccessError({ ...ready.access!, url });
      if (navigationLabel) {
        const normalized = (value: string) =>
          value.normalize("NFKC").replace(/\s+/g, "");
        for (
          let attempt = 0;
          normalized(ready.title) !== normalized(navigationLabel) &&
          attempt < 20;
          attempt++
        ) {
          await wait(350, signal);
          ready = await this.settled(win, signal);
          if (ready.limited || ready.restricted)
            throw new SourceAccessError({ ...ready.access!, url });
        }
        if (normalized(ready.title) !== normalized(navigationLabel))
          throw new Error(
            "章节切换后正文标题未匹配目录，已停止以避免保存错误章节",
          );
      }
      await win.webContents.executeJavaScript(
        `(${scrollSource.toString()})(true)`,
      );
      await wait(200, signal);
      const pieces = new Map<string, Piece>();
      const screenshotAttempts = new Set<string>();
      let latest: Snapshot | undefined;
      let previousSize = -1;
      let bottomStable = 0;
      let finished = false;
      let captureSteps = 0;
      for (let step = 0; step < maxSteps; step++) {
        if (signal.aborted) throw new Error("任务已暂停");
        captureSteps = step + 1;
        await win.webContents.executeJavaScript(
          `Promise.all(Array.from(document.images).filter(i=>i.src.startsWith('blob:')).slice(0,20).map(async i=>{try{const r=await fetch(i.src);const b=await r.blob();if(b.size>20000000)return;const d=await new Promise(res=>{const f=new FileReader();f.onload=()=>res(f.result);f.readAsDataURL(b);});i.src=d;}catch{}}))`,
        );
        latest = await win.webContents.executeJavaScript(
          `(${readDOM.toString()})()`,
        );
        if (latest!.restricted || latest!.limited)
          throw new SourceAccessError({ ...latest!.access!, url });
        for (const p of latest!.pieces) {
          const old = pieces.get(p.id);
          if (old?.kind?.startsWith("screenshot:")) continue;
          if (
            /^(board|bitable|sheet|iframe|embed|synced|diagram)/.test(
              p.kind || "",
            ) &&
            !screenshotAttempts.has(p.id) &&
            screenshotAttempts.size < 100
          ) {
            const script = `(${componentRect.toString()})(${JSON.stringify(p.id)})`;
            const rect = await win.webContents.executeJavaScript(script);
            if (rect) {
              screenshotAttempts.add(p.id);
              const position = await win.webContents.executeJavaScript(
                `(${scrollSource.toString()})(null)`,
              );
              try {
                await win.webContents.executeJavaScript(
                  `(${scrollSource.toString()})(${position.top + rect.y - (rect.viewportHeight - rect.height) / 2})`,
                );
                await wait(250, signal);
                const ready = await win.webContents.executeJavaScript(script);
                if (ready?.visible) {
                  const image = await win.webContents.capturePage({
                    x: ready.x,
                    y: ready.y,
                    width: ready.width,
                    height: ready.height,
                  });
                  if (!image.isEmpty()) {
                    p.html = `<figure><img alt="组件可见画面截图" src="${image.toDataURL()}"></figure>`;
                    p.kind = `screenshot:${p.kind}`;
                  }
                }
              } catch (error) {
                if (signal.aborted || win.isDestroyed()) throw error;
                // Preserve the original unsupported-component marker when capture fails.
              } finally {
                if (!win.isDestroyed()) {
                  await win.webContents.executeJavaScript(
                    `(${scrollSource.toString()})(${position.top})`,
                  );
                  await wait(100, signal);
                }
              }
            }
          }
          if (
            !old ||
            p.text.length >= old.text.length ||
            (p.html.includes("<img") && !old.html.includes("<img"))
          )
            pieces.set(p.id, p);
        }
        if (step % 20 === 0) onProgress?.(pieces.size, step + 1);
        if (pieces.size > 50000)
          throw new Error("单章超过 50000 个内容块，请拆分范围");
        const scroll = await win.webContents.executeJavaScript(
          `(${scrollSource.toString()})(false)`,
        );
        if (scroll.bottom && previousSize === pieces.size) bottomStable++;
        else bottomStable = 0;
        previousSize = pieces.size;
        if (bottomStable >= 2) {
          finished = true;
          break;
        }
        await wait(scroll.bottom ? 350 : 180, signal);
      }
      if (!latest) throw new Error("页面没有返回可读取内容");
      return {
        ...latest,
        pieces: [...pieces.values()],
        scrollTruncated: !finished,
        capturedAt: new Date().toISOString(),
        capture: {
          title: latest.title,
          firstText:
            [...pieces.values()]
              .find((p) => p.text.trim())
              ?.text.slice(0, 160) || "",
          lastText:
            [...pieces.values()]
              .reverse()
              .find((p) => p.text.trim())
              ?.text.slice(-160) || "",
          reachedEnd: finished,
          steps: captureSteps,
          retries: 0,
        },
      };
    } finally {
      signal.removeEventListener("abort", abort);
      if (!win.isDestroyed()) win.destroy();
    }
  }
  async bytes(
    url: string,
    maxBytes = 40 * 1024 * 1024,
    signal?: AbortSignal,
  ): Promise<{ data: Buffer; mime: string }> {
    if (url.startsWith("data:image/")) {
      const m = url.match(/^data:(image\/[\w+.-]+);base64,([\s\S]+)$/);
      if (!m) throw new Error("不支持此图片编码");
      const data = Buffer.from(m[2], "base64");
      if (data.length > maxBytes) throw new Error("资源超过大小上限");
      return { data, mime: m[1] };
    }
    webURL(url);
    const response = await this.session.fetch(url, {
      signal: AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(45000),
      ]),
    });
    if (!response.ok)
      throw new Error(`资源请求失败（HTTP ${response.status}）`);
    if (Number(response.headers.get("content-length") || 0) > maxBytes) {
      await response.body?.cancel();
      throw new Error("资源超过大小上限");
    }
    const parts: Uint8Array[] = [];
    let length = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("资源没有响应内容");
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) throw new Error("资源超过大小上限");
        parts.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return {
      data: Buffer.concat(parts),
      mime: (response.headers.get("content-type") || "").split(";")[0],
    };
  }
  async login(url: string) {
    const win = await this.load(url, undefined, true);
    win.show();
    win.focus();
  }
  close() {
    for (const win of this.windows) if (!win.isDestroyed()) win.destroy();
  }
}
