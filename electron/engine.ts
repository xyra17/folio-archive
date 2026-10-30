import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, nativeImage } from "electron";
import { PDFDocument } from "pdf-lib";
import { Store } from "./store";
import { SourceBrowser, SourceAccessError } from "./browser";
import {
  parseSnapshot,
  blockHash,
  diffBlocks,
  EXTRACTION_VERSION,
  type Snapshot,
} from "./extract";
import { exportJob, renderPreview } from "./export";
import { ReviewAgents } from "./review";
import { directoryKey } from "./directory";
import { ensureArchiveDirectory } from "./archive-directory";
import { duplicateChapters, reconcile } from "./completeness";
import {
  assertOptions,
  atomicWrite,
  createJob,
  hash,
  issue,
  now,
  pool,
  Semaphore,
  uid,
  webURL,
  wait,
} from "./core";
import type { Asset, Chapter, Job, JobOptions } from "../shared/types";

export class Engine {
  private active = new Map<string, AbortController>();
  private queue: string[] = [];
  private pumping = false;
  private inspectors = new Map<string, AbortController>();
  private reviews: ReviewAgents;
  private inspectionSlots = new Semaphore(2);
  constructor(
    readonly store: Store,
    readonly browser: SourceBrowser,
  ) {
    this.reviews = new ReviewAgents(store);
  }
  async create(
    urls: string[],
    options?: Partial<JobOptions>,
    startWhenReady = false,
  ) {
    if (!urls.length || urls.length > 30)
      throw new Error("每次请输入 1–30 个链接");
    const jobs = [...new Set(urls.map(webURL))].map((u) =>
      createJob(u, this.store.config.outputRoot),
    );
    for (const j of jobs) {
      j.options = assertOptions({ ...j.options, ...options });
      j.startWhenReady = startWhenReady;
      this.store.save(j);
      void this.inspect(j);
    }
    return jobs.map((j) => j.id);
  }
  async inspect(job: Job) {
    const controller = new AbortController();
    this.inspectors.set(job.id, controller);
    job.status = "inspecting";
    job.error = undefined;
    this.store.event(job, "discover", "正在识别来源与目录");
    try {
      const s = await this.inspectionSlots.run(() =>
        this.browser.inspect(job.url, controller.signal, {
          steps: Math.min(this.store.config.maxScrollSteps, 500),
          chapters: this.store.config.maxChapters,
        }),
      );
      if (controller.signal.aborted) return;
      job.title =
        (s.collectionTitle || s.title)
          .replace(/\s*[-|]\s*(飞书|Feishu).*$/i, "")
          .trim() || "未命名文档";
      job.access = s.access ? { ...s.access, url: job.url } : undefined;
      if (s.restricted) throw new Error("EXPORT_RESTRICTED");
      if (s.limited) {
        job.status = "waiting_login";
        job.error =
          job.access?.message ||
          "请在来源网页完成登录、验证或展开正文，再继续保存";
        this.store.save(job);
        return;
      }
      const isOriginal =
        s.pdfUrl &&
        (job.source === "pdf" ||
          /preview_pdf/i.test(new URL(job.url).pathname) ||
          s.pieces.map((p) => p.text).join("").length < 400);
      if (isOriginal) {
        job.source = "pdf";
        job.originalUrl = s.pdfUrl;
        job.options.formats = ["pdf"];
        job.chapters = [this.chapter(job.title, job.url)];
        this.store.event(job, "discover", "已发现原始 PDF，将直接保存原件");
      } else {
        job.discovery = s.discovery;
        const candidates = s.links.length
          ? s.links
          : [{ title: s.title, url: job.url }];
        const old = new Map(job.chapters.map((c) => [directoryKey(c), c]));
        const allSelected = job.chapters.every((c) => c.selected);
        const seen = new Set<string>();
        job.chapters = candidates
          .filter((l) => {
            const key = directoryKey(l);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, this.store.config.maxChapters)
          .map((l) => ({
            ...(old.get(directoryKey(l)) || {
              ...this.chapter(l.title, l.url),
              selected: allSelected,
            }),
            title: l.title,
            sourceNumber: l.sourceNumber,
            url: l.url,
            navigationLabel: l.navigationLabel,
            navigationKey: l.navigationKey,
          }));
        job.issues = job.issues.filter(
          (i) =>
            !["directory-incomplete", "chapter-limit", "scope-known"].includes(
              i.code,
            ),
        );
        if (
          job.discovery &&
          ["truncated", "unavailable"].includes(job.discovery.status)
        )
          job.issues.push(issue("directory-incomplete", job.discovery.message));
        if (!job.chapters.length)
          job.chapters = [this.chapter(s.title, job.url)];
        if (candidates.length > this.store.config.maxChapters)
          job.issues.push(
            issue(
              "chapter-limit",
              `目录有 ${candidates.length} 项，本次只发现前 ${this.store.config.maxChapters} 项；可提高章节上限后重新识别`,
            ),
          );
        job.issues.push(
          issue(
            "scope-known",
            "完整性按当前已发现目录和页面块核对；未发现或受限内容不作完整保证",
          ),
        );
        this.store.event(
          job,
          "discover",
          `已发现 ${job.chapters.length} 个章节，可选择范围后开始`,
        );
      }
      job.status = "ready";
      this.store.save(job);
    } catch (err) {
      if (controller.signal.aborted) return;
      job.status = "failed";
      job.error = this.message(err);
      this.store.event(job, "discover", job.error);
    } finally {
      this.inspectors.delete(job.id);
      if (job.status === "ready" && job.startWhenReady) this.start(job.id);
    }
  }
  private chapter(title: string, url: string): Chapter {
    return {
      id: uid(),
      title,
      url,
      selected: true,
      status: "discovered",
      blocks: [],
      assets: [],
    };
  }
  start(id: string, options?: Partial<JobOptions>) {
    const job = this.store.get(id);
    if (this.active.has(id) || this.queue.includes(id)) return;
    if (this.inspectors.has(id)) throw new Error("请等待来源识别完成");
    if (!job.chapters.length) throw new Error("请先完成来源识别");
    if (!job.chapters.some((c) => c.selected))
      throw new Error("请至少选择一章");
    job.options = assertOptions({ ...job.options, ...options });
    job.startWhenReady = false;
    if (job.originalUrl) job.options.formats = ["pdf"];
    job.status = "queued";
    job.error = undefined;
    job.access = undefined;
    this.store.save(job);
    this.queue.push(id);
    void this.pump();
  }
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        if (!this.store.jobs.has(id)) continue;
        const job = this.store.get(id);
        if (job.status !== "queued") continue;
        const control = new AbortController();
        this.active.set(id, control);
        try {
          await this.run(job, control.signal);
        } finally {
          this.active.delete(id);
        }
      }
    } finally {
      this.pumping = false;
    }
  }
  private async run(job: Job, signal: AbortSignal) {
    job.status = "running";
    job.phase = "capture";
    job.coverage = {
      content: job.options.aiReview ? "pending" : "not-requested",
      layout: job.options.aiReview ? "pending" : "not-requested",
      calls: 0,
    };
    job.issues = job.issues.filter(
      (i) =>
        ![
          "ai-content",
          "ai-layout",
          "ai-content-unavailable",
          "ai-layout-unavailable",
          "ai-content-scope",
          "ai-layout-scope",
          "layout-page-overflow",
          "layout-rule-unavailable",
          "layout-overflow",
          "layout-text-overflow",
          "layout-blank-page",
          "layout-orphan-heading",
          "layout-image-limit",
        ].includes(i.code),
    );
    this.store.event(job, "capture", "开始归档，已完成的检查点将复用");
    try {
      await ensureArchiveDirectory(job);
      this.store.save(job);
      this.store.flush();
      await this.backupExports(job);
      if (job.originalUrl) {
        const { data } = await this.browser.bytes(
          job.originalUrl,
          150 * 1024 * 1024,
          signal,
        );
        if (!data.subarray(0, 1024).includes(Buffer.from("%PDF-")))
          throw new Error("预览地址没有返回 PDF 原件");
        await PDFDocument.load(data);
        job.coverage = {
          content: "not-requested",
          layout: "not-requested",
          calls: 0,
        };
        job.originalPath = "原始文档.pdf";
        await atomicWrite(path.join(job.outputDir, job.originalPath), data);
        job.chapters[0].status = "ready";
      } else {
        const assets = new Semaphore(this.store.config.assetConcurrency);
        const processing = new Set<Promise<void>>();
        const allProcessing: Promise<void>[] = [];
        let loginNeeded = false;
        let restricted = false;
        const staleCheckpoints = new Set<string>();
        const selected = job.chapters.filter((c) => c.selected);
        const captureOne = async (chapter: Chapter) => {
          if (signal.aborted || loginNeeded || restricted) return;
          try {
            let snapshot: Snapshot | undefined;
            if (chapter.evidencePath) {
              snapshot = JSON.parse(
                await fs.readFile(chapter.evidencePath, "utf8"),
              );
              if (snapshot?.extractionVersion === EXTRACTION_VERSION)
                this.store.event(job, "capture", `复用快照：${chapter.title}`);
              else {
                snapshot = undefined;
                staleCheckpoints.add(chapter.id);
                this.store.event(
                  job,
                  "capture",
                  `旧快照需要按新规则重新采集：${chapter.title}`,
                );
              }
            }
            if (!snapshot) {
              chapter.status = "capturing";
              this.store.save(job);
              snapshot = await this.captureChapter(job, chapter, signal);
              chapter.evidencePath = path.join(
                this.store.root,
                "checkpoints",
                job.id,
                `${chapter.id}-${Date.now()}.json`,
              );
              await atomicWrite(chapter.evidencePath, JSON.stringify(snapshot));
            }
            if (signal.aborted) return;
            const previous = chapter.blocks;
            const filters = {
              ...job.options,
              fromHeading:
                chapter.id === selected[0].id ? job.options.fromHeading : "",
            };
            const parsed = parseSnapshot(snapshot, chapter.id, filters);
            const oldAssets = new Map(chapter.assets.map((a) => [a.id, a]));
            const nextHash = blockHash(parsed.blocks);
            if (chapter.hash)
              chapter.changes = diffBlocks(previous, parsed.blocks);
            chapter.previousHash = chapter.hash;
            chapter.hash = nextHash;
            chapter.blocks = parsed.blocks;
            staleCheckpoints.delete(chapter.id);
            chapter.assets = parsed.assets.map((a) =>
              oldAssets.get(a.id)?.status === "ready"
                ? oldAssets.get(a.id)!
                : a,
            );
            chapter.sourceBlockCount = snapshot.pieces.length;
            chapter.capturedAt =
              snapshot.capturedAt || chapter.capturedAt || now();
            chapter.author = snapshot.author;
            chapter.capture = snapshot.capture;
            chapter.error = undefined;
            chapter.status = "checking";
            job.issues = job.issues.filter((i) => i.chapterId !== chapter.id);
            job.issues.push(...parsed.issues);
            this.store.save(job);
            const process = this.processChapter(
              job,
              chapter,
              snapshot,
              assets,
              signal,
            ).catch((err) => {
              if (!signal.aborted) {
                chapter.status = "failed";
                chapter.error = this.message(err);
                job.issues.push(
                  issue("chapter-processing", chapter.error, {
                    chapterId: chapter.id,
                    severity: "error",
                  }),
                );
                this.store.save(job);
              }
            });
            processing.add(process);
            allProcessing.push(process);
            void process.finally(() => processing.delete(process));
            if (processing.size >= 4) await Promise.race(processing);
          } catch (err) {
            if (signal.aborted) return;
            if (
              err instanceof SourceAccessError &&
              job.access?.kind !== "export-restricted"
            )
              job.access = { ...err.access, url: chapter.url };
            if ((err as Error).message === "LOGIN_REQUIRED") loginNeeded = true;
            if ((err as Error).message === "EXPORT_RESTRICTED")
              restricted = true;
            chapter.status = "failed";
            chapter.error = this.message(err);
            job.issues.push(
              issue("chapter-capture", chapter.error, {
                chapterId: chapter.id,
                severity: "error",
              }),
            );
            this.store.save(job);
          }
        };
        await pool(selected, this.store.config.pageConcurrency, captureOne);
        await Promise.all(allProcessing);
        const duplicates = duplicateChapters(job);
        // Retry suspect chapters once, without discarding completed unrelated chapters.
        for (const id of duplicates.flatMap((group) => group.slice(1))) {
          if (signal.aborted || loginNeeded || restricted) break;
          const chapter = selected.find((c) => c.id === id)!;
          this.store.event(
            job,
            "capture",
            `检测到重复正文，重新采集：${chapter.title}`,
          );
          chapter.evidencePath = undefined;
          await captureOne(chapter);
        }
        await Promise.all(allProcessing);
        reconcile(job);
        if (signal.aborted) return;
        if (restricted) throw new Error("EXPORT_RESTRICTED");
        if (loginNeeded) {
          job.status = "waiting_login";
          job.error = "部分章节需要登录，已取得内容已保留";
          this.store.save(job);
          return;
        }
        if (staleCheckpoints.size)
          throw new Error(
            "旧快照需要重新采集，但来源读取失败；未生成新文件，请恢复来源访问后重试",
          );
        if (!selected.some((c) => c.blocks.length && c.status !== "failed"))
          throw new Error("未取得可导出的正文，请检查来源、登录和范围");
      }
      if (signal.aborted) return;
      job.access = { kind: "available", message: "已保存本次读取的可见正文" };
      job.phase = "export";
      this.store.event(job, "export", "正在生成离线文件与报告");
      job.exports = await exportJob(
        job,
        signal,
        (message) => this.store.event(job, "export", message),
        (file) => this.reviews.layout(job, file, signal),
      );
      if (signal.aborted) return;
      job.status = job.issues.some(
        (i) => !i.resolved && i.code !== "scope-known",
      )
        ? "partial"
        : "completed";
      this.store.event(
        job,
        "export",
        job.status === "partial"
          ? "文件已生成，部分内容或检查需要核对"
          : "归档已完成，可打开文件或离线资料包",
      );
    } catch (err) {
      if (signal.aborted) return;
      job.status = "failed";
      job.error = this.message(err);
      this.store.event(job, job.phase, job.error);
    }
  }
  private async captureChapter(
    job: Job,
    chapter: Chapter,
    signal: AbortSignal,
  ) {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const snapshot = await this.browser.capture(
          chapter.url,
          this.store.config.maxScrollSteps,
          signal,
          chapter.navigationLabel,
          (blocks, steps) =>
            this.store.event(
              job,
              "capture",
              `${chapter.title}：已收集 ${blocks} 个内容块，滚动 ${steps} 次`,
            ),
          chapter.navigationKey,
        );
        if (snapshot.capture) snapshot.capture.retries = attempt;
        if (!snapshot.scrollTruncated || attempt === 1) return snapshot;
        this.store.event(
          job,
          "capture",
          `章节未到末尾，按相同安全上限重试一次：${chapter.title}`,
        );
      } catch (error) {
        if (
          signal.aborted ||
          error instanceof SourceAccessError ||
          attempt === 1
        )
          throw error;
        last = error;
        this.store.event(
          job,
          "capture",
          `章节读取失败，重试一次：${chapter.title}`,
        );
      }
      await wait(400, signal);
    }
    throw last || new Error("章节采集失败");
  }
  private async processChapter(
    job: Job,
    chapter: Chapter,
    snapshot: Snapshot,
    slots: Semaphore,
    signal: AbortSignal,
  ) {
    await Promise.all([
      Promise.all(
        chapter.assets.map((asset) =>
          slots.run(() => this.downloadAsset(job, asset, signal)),
        ),
      ),
      this.reviews.content(job, chapter, snapshot, signal),
    ]);
    if (signal.aborted) return;
    chapter.status = job.issues.some(
      (i) => i.chapterId === chapter.id && i.severity === "error",
    )
      ? "failed"
      : "ready";
    this.store.event(
      job,
      "content",
      `完成章节：${chapter.title}（${chapter.blocks.length} 个内容块）`,
    );
    if (!job.previewPath && chapter.status === "ready") {
      await renderPreview({ ...job, chapters: [chapter] });
      job.previewPath = "preview.html";
      this.store.save(job);
    }
  }
  private async downloadAsset(job: Job, asset: Asset, signal: AbortSignal) {
    if (asset.status === "ready" && asset.path) {
      try {
        await fs.access(path.join(job.outputDir, asset.path));
        return;
      } catch {
        asset.status = "pending";
      }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (signal.aborted) return;
        const { data, mime } = await this.browser.bytes(
          asset.url,
          35 * 1024 * 1024,
          signal,
        );
        let normalized = data;
        let image = nativeImage.createFromBuffer(data);
        if (image.isEmpty() && /^image\//.test(mime))
          image = await this.decodeImage(data, mime, signal);
        if (image.isEmpty())
          throw new Error("资源不是可解码图片，可能已过期或需要登录");
        const size = image.getSize();
        asset.width = size.width;
        asset.height = size.height;
        const jpeg = data[0] === 0xff && data[1] === 0xd8;
        normalized = jpeg ? data : image.toPNG();
        asset.mime = jpeg ? "image/jpeg" : "image/png";
        asset.hash = hash(normalized);
        asset.path = `assets/${asset.hash}.${jpeg ? "jpg" : "png"}`;
        await atomicWrite(path.join(job.outputDir, asset.path), normalized);
        asset.status = "ready";
        asset.error = undefined;
        job.issues = job.issues.filter((i) => i.assetId !== asset.id);
        this.store.save(job);
        return;
      } catch (err) {
        if (signal.aborted) return;
        if (attempt === 0) {
          await wait(600, signal);
          continue;
        }
        asset.status = "failed";
        asset.error = this.message(err);
        job.issues = job.issues.filter((i) => i.assetId !== asset.id);
        job.issues.push(
          issue("asset-download", `图片保存失败：${asset.error}`, {
            chapterId: asset.chapterId,
            assetId: asset.id,
          }),
        );
        this.store.save(job);
      }
    }
  }
  private async decodeImage(data: Buffer, mime: string, signal: AbortSignal) {
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    const abort = () => {
      if (!win.isDestroyed()) win.destroy();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await win.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:"><img src="data:${mime.replace(/[^a-zA-Z0-9/+.-]/g, "")};base64,${data.toString("base64")}">`,
          ),
      );
      const png = await win.webContents.executeJavaScript(
        `(async()=>{const img=document.images[0];await img.decode();const w=img.naturalWidth,h=img.naturalHeight;if(!w||!h||w>16000||h>16000||w*h>60000000)throw new Error('图片尺寸超过安全处理上限');const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/png');})()`,
      );
      if (signal.aborted) throw new Error("任务已暂停");
      return nativeImage.createFromDataURL(png);
    } finally {
      signal.removeEventListener("abort", abort);
      if (!win.isDestroyed()) win.destroy();
    }
  }
  async action(id: string, action: string) {
    const job = this.store.get(id);
    if (action === "pause" || action === "cancel") {
      this.active.get(id)?.abort();
      this.inspectors.get(id)?.abort();
      this.queue = this.queue.filter((x) => x !== id);
      job.status = action === "pause" ? "paused" : "cancelled";
      this.store.event(
        job,
        job.phase,
        action === "pause" ? "已暂停，检查点已保存" : "已取消，已保存内容保留",
      );
      return;
    }
    if (this.active.has(id) || this.inspectors.has(id))
      throw new Error("任务正在处理，请先暂停并等待当前步骤结束");
    if (action === "rediscover") {
      job.startWhenReady = false;
      await this.inspect(job);
      return;
    }
    if (action === "refresh") {
      await this.backupExports(job);
      for (const c of job.chapters) {
        c.evidencePath = undefined;
        c.status = "discovered";
      }
      job.issues = job.issues.filter((i) => i.code === "scope-known");
      job.startWhenReady = true;
      await this.inspect(job);
      return;
    }
    if (action === "retry-assets") {
      for (const a of job.chapters.flatMap((c) => c.assets))
        if (a.status === "failed") a.status = "pending";
      this.start(id);
      return;
    }
    if (action === "retry-missing") {
      for (const c of job.chapters)
        if (c.selected && (c.status === "failed" || !c.capture?.reachedEnd)) {
          c.evidencePath = undefined;
          c.status = "discovered";
        }
      this.start(id);
      return;
    }
    if (action === "reexport") {
      this.start(id);
      return;
    }
    if (job.chapters.length && job.phase !== "discover") this.start(id);
    else {
      if (action === "retry" || action === "resume") job.startWhenReady = true;
      await this.inspect(job);
    }
  }
  private async backupExports(job: Job) {
    if (!job.exports.length) return;
    const dir = path.join(
      job.outputDir,
      "history",
      now().replace(/[:.]/g, "-"),
    );
    await fs.mkdir(dir, { recursive: true });
    for (const f of job.exports)
      await fs.copyFile(f.path, path.join(dir, f.name)).catch(() => {});
  }
  busy(id: string) {
    return this.active.has(id) || this.inspectors.has(id);
  }
  stop() {
    for (const c of this.active.values()) c.abort();
    for (const c of this.inspectors.values()) c.abort();
    this.browser.close();
    this.store.flush();
  }
  private message(err: unknown) {
    const text = err instanceof Error ? err.message : "操作失败";
    if (text === "LOGIN_REQUIRED")
      return "来源需要登录、验证或当前只显示部分预览，请在网页中完成后继续";
    if (text === "EXPORT_RESTRICTED")
      return "来源明确限制保存或导出，任务已停止";
    return text.replace(/https?:\/\/\S+/g, "[来源链接]").slice(0, 500);
  }
}
