import fs from "node:fs/promises";
import path from "node:path";
import type { Job, RemovalPlan } from "../shared/types";
import { ownsArchiveDirectory } from "./archive-directory";

const contains = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return (
    !relative || (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};
async function directory(target: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("目录已被替换或不是普通文件夹，未移除任何记录");
    const parent = await fs.realpath(path.dirname(target));
    const real = await fs.realpath(target);
    if (real !== path.join(parent, path.basename(target)))
      throw new Error("目录路径存在重定向，无法安全移除");
    return real;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function planRemoval(
  job: Job,
  jobs: Iterable<Job>,
  dataRoot: string,
): Promise<RemovalPlan> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      job.id,
    ) ||
    !path.isAbsolute(job.outputDir)
  )
    throw new Error("任务目录无法确认归属，请仅移除记录");
  const root = await fs.realpath(dataRoot);
  const output = await directory(job.outputDir);
  if (
    path.basename(job.outputDir) !== job.id &&
    output &&
    !(await ownsArchiveDirectory(job))
  )
    throw new Error("任务目录无法确认归属，请仅移除记录");
  const checkpointsRoot = path.join(dataRoot, "checkpoints");
  const checkpoints = await directory(checkpointsRoot);
  if (checkpoints && checkpoints !== path.join(root, "checkpoints"))
    throw new Error("缓存目录路径异常，请仅移除记录");
  const cache = await directory(path.join(checkpointsRoot, job.id));
  const directories = [output, cache].filter((p): p is string => !!p);
  for (const target of directories) {
    if (contains(target, root))
      throw new Error("任务目录与应用数据重叠，请仅移除记录");
    for (const other of jobs) {
      if (other.id === job.id) continue;
      const lexical = path.resolve(other.outputDir);
      const outputLexical = path.resolve(job.outputDir);
      if (contains(outputLexical, lexical) || contains(lexical, outputLexical))
        throw new Error("任务目录与其他任务重叠，请仅移除记录");
      const otherDir = await directory(other.outputDir);
      if (
        otherDir &&
        (contains(target, otherDir) || contains(otherDir, target))
      )
        throw new Error("任务目录与其他任务重叠，请仅移除记录");
    }
  }
  if (output && cache && (contains(output, cache) || contains(cache, output)))
    throw new Error("任务导出与缓存目录重叠，请仅移除记录");
  return { directories, outputDirectory: job.outputDir };
}
export async function trashRemovalPlan(
  plan: RemovalPlan,
  trash: (target: string) => Promise<void>,
) {
  let completed = 0;
  for (const target of plan.directories) {
    try {
      // Recheck immediately before handing this directory to the OS.
      if (await directory(target)) await trash(target);
      completed++;
    } catch (error) {
      throw new Error(
        `无法将全部文件移入废纸篓（已处理 ${completed}/${plan.directories.length} 个目录）。记录已保留，可重试或仅移除记录。${(error as Error).message}`,
      );
    }
  }
}
