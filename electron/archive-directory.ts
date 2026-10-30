import fs from "node:fs/promises";
import path from "node:path";
import type { Job } from "../shared/types";

const ownerFile = ".folio-archive.json";
const pending = new WeakMap<Job, Promise<void>>();

export function archiveFolderName(title: string, savedAt: string): string {
  const date = new Date(savedAt);
  if (!Number.isFinite(date.getTime())) throw new Error("保存时间无效");
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const cleaned = title
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_")
    .trim();
  let shortened = "";
  // Stay below common filesystem byte limits, including for Chinese and emoji.
  for (const char of cleaned) {
    if (Buffer.byteLength(shortened + char, "utf8") > 180) break;
    shortened += char;
  }
  return `${stamp}${shortened.replace(/[. ]+$/g, "") || "未命名文档"}`;
}

export async function ownsArchiveDirectory(job: Job): Promise<boolean> {
  if (path.basename(job.outputDir) === job.id) return true;
  try {
    const file = path.join(job.outputDir, ownerFile);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const owner = JSON.parse(await fs.readFile(file, "utf8"));
    return owner.jobId === job.id;
  } catch {
    return false;
  }
}

// Reserve each new folder exclusively; retries keep the same folder and time.
export function ensureArchiveDirectory(job: Job): Promise<void> {
  const running = pending.get(job);
  if (running) return running;
  const promise = prepare(job).finally(() => pending.delete(job));
  pending.set(job, promise);
  return promise;
}

async function prepare(job: Job) {
  try {
    const stat = await fs.lstat(job.outputDir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !(await ownsArchiveDirectory(job))
    )
      throw new Error("保存文件夹无法确认归属");
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const root = path.dirname(job.outputDir);
  await fs.mkdir(root, { recursive: true });
  const base = archiveFolderName(job.title, job.createdAt);
  for (let n = 1; ; n++) {
    const candidate = path.join(root, n === 1 ? base : `${base} (${n})`);
    try {
      await fs.mkdir(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    try {
      await fs.writeFile(
        path.join(candidate, ownerFile),
        JSON.stringify({ jobId: job.id }),
        { flag: "wx" },
      );
    } catch (error) {
      await fs.rmdir(candidate).catch(() => {});
      throw error;
    }
    job.outputDir = candidate;
    return;
  }
}
