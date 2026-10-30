import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  Menu,
  clipboard,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { autoUpdater } from "electron-updater";
import { Store } from "./store";
import { planRemoval, trashRemovalPlan } from "./removal";
import { ensureArchiveDirectory } from "./archive-directory";
import { SourceBrowser } from "./browser";
import { Engine } from "./engine";
import { assertOptions, within, webURL } from "./core";
import { startDemo } from "./demo";
import { runE2E } from "./e2e";
import { runLive } from "./live";
import { runPipelineE2E } from "./pipeline-e2e";
import { templatePreviewHTML } from "./template-preview";
import { templates } from "../shared/templates";
import { testModelConnection } from "./model-connection";
import type { Settings, JobOptions } from "../shared/types";

if (process.env.FOLIO_DATA_DIR)
  app.setPath("userData", process.env.FOLIO_DATA_DIR);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "archive",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
const gotLock =
  process.env.FOLIO_PIPELINE_E2E === "1" ||
  process.env.FOLIO_E2E === "1" ||
  process.env.FOLIO_LIVE === "1" ||
  app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let mainWindow: BrowserWindow | undefined;
let store: Store;
let engine: Engine;
let browser: SourceBrowser;
let demo: Awaited<ReturnType<typeof startDemo>>;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".md": "text/plain; charset=utf-8",
};
function artifactURL(id: string, file: string) {
  return `archive://job/${id}/${file.split(path.sep).map(encodeURIComponent).join("/")}`;
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 650,
    title: "拾页",
    frame: false,
    backgroundColor: "#f5f6f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (process.platform === "darwin")
    mainWindow.setWindowButtonVisibility(false);
  const notifyWindow = () => mainWindow?.webContents.send("archive:changed");
  mainWindow.on("maximize", notifyWindow);
  mainWindow.on("unmaximize", notifyWindow);
  mainWindow.on("enter-full-screen", notifyWindow);
  mainWindow.on("leave-full-screen", notifyWindow);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (url !== current) event.preventDefault();
  });
  if (process.env.FOLIO_DEV_URL)
    void mainWindow.loadURL(process.env.FOLIO_DEV_URL);
  else void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}
const removing = new Set<string>();
function handle(name: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(`archive:${name}`, (event, ...args) => {
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error("请求来源无效");
    if (removing.size && ["create", "demo", "settings"].includes(name))
      throw new Error("正在移除文件，请稍候再新建任务或更改设置");
    if (
      removing.has(args[0]) &&
      [
        "start",
        "action",
        "updateJob",
        "diagnostic",
        "reveal",
        "remove",
      ].includes(name)
    )
      throw new Error("正在移除该任务，请稍候");
    return fn(...args);
  });
}
function idle(id: string) {
  if (engine.busy(id))
    throw new Error("请先暂停任务，等待当前步骤结束后再修改");
}
async function boot() {
  await app.whenReady();
  app.setName("拾页");
  store = new Store();
  await store.init();
  browser = new SourceBrowser();
  engine = new Engine(store, browser);
  demo = await startDemo();
  protocol.handle("archive", async (request) => {
    try {
      const u = new URL(request.url);
      if (u.hostname !== "job" || request.method !== "GET")
        return new Response("Forbidden", { status: 403 });
      const parts = decodeURIComponent(u.pathname).split("/").filter(Boolean);
      const job = store.get(parts.shift()!);
      const file = path.resolve(job.outputDir, ...parts);
      if (!within(job.outputDir, file))
        return new Response("Forbidden", { status: 403 });
      const ext = path.extname(file);
      if (!MIME[ext]) return new Response("Unsupported", { status: 403 });
      const data = await fs.readFile(file);
      return new Response(new Uint8Array(data), {
        headers: {
          "Content-Type": MIME[ext],
          "Content-Security-Policy":
            "default-src 'none'; img-src 'self' archive: data:; style-src 'unsafe-inline'; sandbox allow-same-origin",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  handle("state", () => ({
    jobs: [...store.jobs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    settings: store.config,
    version: app.getVersion(),
    dataPath: store.root,
    platform: process.platform,
    window: {
      maximized: mainWindow?.isMaximized() || false,
      fullscreen: mainWindow?.isFullScreen() || false,
    },
  }));
  handle("clipboardText", async () =>
    (await clipboard.readText()).slice(0, 100000),
  );
  handle("windowControl", (action) => {
    const win = mainWindow!;
    if (action === "close") win.close();
    else if (action === "minimize") {
      if (win.isFullScreen()) {
        win.once("leave-full-screen", () => win.minimize());
        win.setFullScreen(false);
      } else win.minimize();
    } else if (action === "zoom") {
      if (win.isFullScreen()) win.setFullScreen(false);
      else if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === "fullscreen") win.setFullScreen(!win.isFullScreen());
    else throw new Error("无效的窗口操作");
  });
  handle(
    "create",
    (urls: unknown, options?: Partial<JobOptions>, startWhenReady = false) => {
      if (!Array.isArray(urls) || urls.some((u) => typeof u !== "string"))
        throw new Error("链接列表无效");
      return engine.create(urls, options, startWhenReady === true);
    },
  );
  handle("start", (id, options) => {
    engine.start(id, options);
  });
  handle("action", (id, action) => {
    if (
      ![
        "pause",
        "resume",
        "cancel",
        "retry",
        "rediscover",
        "refresh",
        "retry-assets",
        "retry-missing",
        "reexport",
      ].includes(action)
    )
      throw new Error("操作无效");
    return engine.action(id, action);
  });
  handle("updateJob", (id, patch) => {
    idle(id);
    const j = store.get(id);
    if (patch.selected) {
      if (!Array.isArray(patch.selected)) throw new Error("章节范围无效");
      j.chapters.forEach((c) => (c.selected = patch.selected.includes(c.id)));
    }
    if (patch.options)
      j.options = assertOptions({ ...j.options, ...patch.options });
    if (patch.collection !== undefined)
      j.collection = String(patch.collection).slice(0, 80);
    if (patch.tags)
      j.tags = patch.tags
        .map(String)
        .map((s: string) => s.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 20);
    store.save(j);
  });
  handle("settings", (patch: Partial<Settings> & { apiKey?: string }) => {
    const allowed = [
      "outputRoot",
      "pageConcurrency",
      "assetConcurrency",
      "maxChapters",
      "maxScrollSteps",
      "modelEndpoint",
      "model",
      "aiMaxCalls",
      "updateUrl",
      "apiKey",
    ];
    const safe = Object.fromEntries(
      Object.entries(patch).filter(([k]) => allowed.includes(k)),
    );
    for (const key of ["modelEndpoint", "updateUrl"])
      if (safe[key]) webURL(String(safe[key]));
    if (safe.outputRoot && !path.isAbsolute(String(safe.outputRoot)))
      throw new Error("输出目录必须是绝对路径");
    store.settings(safe);
  });
  handle("chooseOutput", async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: "选择归档目录",
      properties: ["openDirectory", "createDirectory"],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle("testModel", (config) =>
    testModelConnection(config, config.useSavedKey ? store.key() : ""),
  );
  handle("templatePreview", (template) => {
    if (!templates.some((t) => t.id === template))
      throw new Error("排版模板无效");
    return templatePreviewHTML(template);
  });
  handle("login", (id) => {
    const job = store.get(id);
    return browser.login(job.access?.url || job.url);
  });
  handle("source", (id, chapterId, blockId) => {
    const j = store.get(id);
    const chapter = j.chapters.find((c) => c.id === chapterId);
    const source = chapterId ? chapter?.url : j.url;
    if (!source) throw new Error("来源不存在");
    const url = new URL(webURL(source));
    if (blockId && chapter?.blocks.some((b) => b.id === blockId))
      url.hash = String(blockId).replace(/-image-\d+$/, "");
    return shell.openExternal(url.href);
  });
  handle("open", async (id, name) => {
    const j = store.get(id);
    const file =
      j.exports.find((f) => f.name === name) ||
      j.exports.find((f) => f.format === "pdf") ||
      j.exports[0];
    if (!file) throw new Error("文件尚未生成");
    if (!within(j.outputDir, file.path)) throw new Error("文件路径无效");
    const error = await shell.openPath(file.path);
    if (error) throw new Error(error);
  });
  handle("reveal", async (id) => {
    const job = id ? store.get(id) : undefined;
    if (job && job.status !== "inspecting") {
      await ensureArchiveDirectory(job);
      store.save(job);
      store.flush();
    }
    const dir =
      job && job.status !== "inspecting"
        ? job.outputDir
        : store.config.outputRoot;
    await fs.mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
  });
  handle("demo", () => engine.create([demo.url]));
  handle("preview", (id) => {
    const j = store.get(id);
    return j.previewPath
      ? artifactURL(id, j.previewPath)
      : j.originalPath
        ? artifactURL(id, j.originalPath)
        : null;
  });
  handle("diagnostic", async (id) => {
    const j = store.get(id);
    const zip = new JSZip();
    zip.file(
      "diagnostic.json",
      JSON.stringify(
        {
          appVersion: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          id: j.id,
          status: j.status,
          phase: j.phase,
          chapterCount: j.chapters.length,
          chapters: j.chapters.map((c) => ({
            status: c.status,
            blockCount: c.blocks.length,
            assets: c.assets.length,
          })),
          issues: j.issues.map((i) => ({
            code: i.code,
            severity: i.severity,
            origin: i.origin,
          })),
          events: j.events.map(({ at, phase }) => ({ at, phase })),
        },
        null,
        2,
      ),
    );
    await ensureArchiveDirectory(j);
    store.save(j);
    store.flush();
    const file = path.join(j.outputDir, "脱敏诊断.zip");
    await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
    shell.showItemInFolder(file);
    return file;
  });
  handle("removalPlan", (id) =>
    planRemoval(store.get(id), store.jobs.values(), store.root),
  );
  handle("remove", async (id, mode = "record") => {
    if (mode !== "record" && mode !== "files") throw new Error("移除方式无效");
    idle(id);
    const job = store.get(id);
    if (["running", "queued", "inspecting"].includes(job.status))
      throw new Error("请先取消任务，再移除记录");
    removing.add(id);
    try {
      if (mode === "files") {
        const plan = await planRemoval(job, store.jobs.values(), store.root);
        await trashRemovalPlan(plan, (target) => shell.trashItem(target));
      }
      store.remove(id);
      store.flush();
    } finally {
      removing.delete(id);
    }
  });
  handle("clearSession", async () => {
    if (
      [...store.jobs.values()].some((j) =>
        ["running", "inspecting", "queued"].includes(j.status),
      )
    )
      throw new Error("请等待任务结束或暂停后再清理会话");
    await browser.session.clearStorageData();
  });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  let updateAvailable = false;
  let updateDownloaded = false;
  autoUpdater.on("update-available", () => {
    updateAvailable = true;
    updateDownloaded = false;
  });
  autoUpdater.on("update-not-available", () => {
    updateAvailable = false;
  });
  autoUpdater.on("error", (error) => console.error("更新失败", error.message));
  handle("checkUpdates", async (action = "check") => {
    if (!store.config.updateUrl)
      return {
        status: "unconfigured",
        message: "尚未配置发布渠道；当前版本可正常本地使用",
      };
    if (!app.isPackaged)
      return {
        status: "development",
        message: "开发运行不安装更新，请使用打包后的应用检查",
      };
    if (
      [...store.jobs.values()].some((j) =>
        ["running", "queued", "inspecting"].includes(j.status),
      )
    )
      return { status: "busy", message: "请等待归档完成后更新" };
    autoUpdater.setFeedURL({
      provider: "generic",
      url: store.config.updateUrl,
    });
    if (action === "install") {
      if (!updateDownloaded) throw new Error("请先下载更新");
      autoUpdater.quitAndInstall();
      return { status: "installing", message: "即将重启安装更新" };
    }
    if (action === "download") {
      if (!updateAvailable) throw new Error("请先检查可用更新");
      await autoUpdater.downloadUpdate();
      updateDownloaded = true;
      return { status: "downloaded", message: "更新已下载，可重启并安装" };
    }
    updateAvailable = false;
    const result = await autoUpdater.checkForUpdates();
    return updateAvailable
      ? {
          status: "available",
          message: `发现版本 ${result!.updateInfo.version}`,
        }
      : { status: "current", message: "当前已是发布渠道的最新版本" };
  });
  createWindow();
  let notifyTimer: NodeJS.Timeout | undefined;
  store.onChange = () => {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("archive:changed");
    }, 70);
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "拾页",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "视图",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
    ]),
  );
  if (process.env.FOLIO_LIVE === "1") {
    store.settings({
      outputRoot: path.join(store.root, "exports"),
      maxScrollSteps: Math.min(
        500,
        Math.max(20, Number(process.env.FOLIO_SMOKE_STEPS) || 20),
      ),
    });
    await new Promise<void>((r) =>
      mainWindow!.webContents.once("did-finish-load", () => r()),
    );
    await runLive(store, engine, mainWindow!);
  }
  if (process.env.FOLIO_PIPELINE_E2E === "1") {
    await new Promise<void>((r) =>
      mainWindow!.webContents.once("did-finish-load", () => r()),
    );
    await runPipelineE2E(store, engine, mainWindow!);
  }
  if (process.env.FOLIO_E2E === "1") {
    await new Promise<void>((r) =>
      mainWindow!.webContents.once("did-finish-load", () => r()),
    );
    await runE2E({
      store,
      engine,
      window: mainWindow!,
      demoUrl: demo.url,
      repairImages: demo.repairImages,
    });
  }
}
app.on("second-instance", () => {
  mainWindow?.show();
  mainWindow?.focus();
});
app.on("activate", () => {
  if (store && !mainWindow) createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  engine?.stop();
  demo?.server.close();
});
if (gotLock)
  void boot().catch((err) => {
    console.error("启动失败", err.message);
    if (process.env.FOLIO_E2E !== "1")
      dialog.showErrorBox("拾页启动失败", String(err.message));
    app.exit(1);
  });
