import initSqlJs, { type Database } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { now } from "./core";
import type { Job, Settings } from "../shared/types";
export class Store {
  db!: Database;
  jobs = new Map<string, Job>();
  config!: Settings;
  private timer?: NodeJS.Timeout;
  private dirty = new Set<string>();
  onChange = () => {};
  readonly root = process.env.FOLIO_DATA_DIR || app.getPath("userData");
  readonly file = path.join(this.root, "archive.sqlite");
  async init() {
    fs.mkdirSync(this.root, { recursive: true });
    const SQL = await initSqlJs({
      locateFile: (name) => require.resolve(`sql.js/dist/${name}`),
    });
    this.db = new SQL.Database(
      fs.existsSync(this.file) ? fs.readFileSync(this.file) : undefined,
    );
    this.db.run(
      "CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=1;",
    );
    this.config = {
      outputRoot: path.join(app.getPath("documents"), "拾页归档"),
      pageConcurrency: 2,
      assetConcurrency: 4,
      maxChapters: 80,
      maxScrollSteps: 2000,
      modelEndpoint: "",
      model: "",
      hasApiKey: false,
      aiMaxCalls: 8,
      updateUrl: "",
      ...this.read("config"),
    };
    this.config.hasApiKey = !!this.key();
    for (const row of this.db.exec("SELECT payload FROM jobs")[0]?.values ??
      []) {
      const job: Job = JSON.parse(String(row[0]));
      if (["running", "queued", "inspecting"].includes(job.status)) {
        job.status = job.chapters.length ? "paused" : "failed";
        job.error = "上次运行被中断，已有检查点已保留";
      }
      for (const c of job.chapters)
        if (["capturing", "checking"].includes(c.status))
          c.status = "discovered";
      this.jobs.set(job.id, job);
      this.db.run("INSERT OR REPLACE INTO jobs VALUES (?,?)", [
        job.id,
        JSON.stringify(job),
      ]);
    }
    this.flush();
  }
  private read(key: string) {
    const s = this.db.prepare("SELECT value FROM settings WHERE key=?");
    try {
      s.bind([key]);
      return s.step() ? JSON.parse(String(s.get()[0])) : undefined;
    } finally {
      s.free();
    }
  }
  private write(key: string, value: unknown) {
    this.db.run("INSERT OR REPLACE INTO settings VALUES (?,?)", [
      key,
      JSON.stringify(value),
    ]);
  }
  get(id: string) {
    const j = this.jobs.get(id);
    if (!j) throw new Error("任务不存在");
    return j;
  }
  save(job: Job) {
    job.updatedAt = now();
    this.jobs.set(job.id, job);
    this.dirty.add(job.id);
    this.changed();
  }
  event(job: Job, phase: string, message: string) {
    job.events.push({ at: now(), phase, message });
    job.events = job.events.slice(-120);
    this.save(job);
  }
  private changed() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
    this.onChange();
  }
  flush() {
    clearTimeout(this.timer);
    for (const id of this.dirty) {
      const job = this.jobs.get(id);
      if (job)
        this.db.run("INSERT OR REPLACE INTO jobs VALUES (?,?)", [
          id,
          JSON.stringify(job),
        ]);
    }
    this.dirty.clear();
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, this.db.export());
    fs.renameSync(tmp, this.file);
  }
  settings(patch: Partial<Settings> & { apiKey?: string }) {
    const { apiKey, ...config } = patch;
    this.config = { ...this.config, ...config };
    for (const [key, min, max] of [
      ["pageConcurrency", 1, 4],
      ["assetConcurrency", 1, 8],
      ["maxChapters", 1, 200],
      ["maxScrollSteps", 10, 5000],
      ["aiMaxCalls", 1, 30],
    ] as const)
      this.config[key] = Math.min(
        max,
        Math.max(min, Math.floor(Number(this.config[key]) || min)),
      );
    if (apiKey !== undefined) {
      if (apiKey && !safeStorage.isEncryptionAvailable())
        throw new Error("系统凭据加密不可用，未保存 API Key");
      this.write(
        "secret",
        apiKey ? safeStorage.encryptString(apiKey).toString("base64") : "",
      );
    }
    this.config.hasApiKey = !!this.key();
    this.write("config", this.config);
    this.changed();
  }
  key(): string {
    try {
      const encoded = this.read("secret");
      return encoded
        ? safeStorage.decryptString(Buffer.from(encoded, "base64"))
        : "";
    } catch {
      return "";
    }
  }
  remove(id: string) {
    this.jobs.delete(id);
    this.dirty.delete(id);
    this.db.run("DELETE FROM jobs WHERE id=?", [id]);
    this.changed();
  }
}
