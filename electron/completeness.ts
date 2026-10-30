import type { Job } from "../shared/types";
import { hash, issue } from "./core";

export function duplicateChapters(job: Job): string[][] {
  const groups = new Map<string, string[]>();
  for (const c of job.chapters.filter(
    (c) => c.selected && c.status !== "failed",
  )) {
    const body = c.blocks
      .filter((b) => b.type !== "heading" && b.type !== "image")
      .map((b) => b.text.normalize("NFKC").replace(/\s+/g, ""))
      .join("");
    if (body.length < 150) continue;
    const key = hash(body);
    groups.set(key, [...(groups.get(key) || []), c.id]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function reconcile(job: Job) {
  job.issues = job.issues.filter(
    (i) =>
      ![
        "chapter-missing",
        "chapter-duplicate",
        "chapter-end-unverified",
      ].includes(i.code),
  );
  const selected = job.chapters.filter((c) => c.selected);
  const duplicates = duplicateChapters(job);
  const duplicated = new Set(duplicates.flat());
  const failed = selected
    .filter((c) => c.status === "failed" || !c.blocks.length)
    .map((c) => c.id);
  const truncated = selected
    .filter(
      (c) =>
        c.blocks.length && !failed.includes(c.id) && !c.capture?.reachedEnd,
    )
    .map((c) => c.id);
  job.reconciliation = {
    selected: selected.length,
    captured: selected.filter((c) => c.blocks.length && !failed.includes(c.id))
      .length,
    verified: selected.filter(
      (c) =>
        c.status === "ready" && c.capture?.reachedEnd && !duplicated.has(c.id),
    ).length,
    failed,
    truncated,
    duplicateGroups: duplicates,
    firstChapter: selected[0]?.title,
    lastChapter: selected.at(-1)?.title,
  };
  for (const id of failed)
    job.issues.push(
      issue(
        "chapter-missing",
        `未完成章节：${selected.find((c) => c.id === id)!.title}；不会将旧正文作为本次成功结果`,
        { chapterId: id, severity: "error" },
      ),
    );
  for (const id of truncated)
    job.issues.push(
      issue(
        "chapter-end-unverified",
        `章节尚未确认到达末尾：${selected.find((c) => c.id === id)!.title}`,
        { chapterId: id },
      ),
    );
  for (const group of duplicates)
    job.issues.push(
      issue(
        "chapter-duplicate",
        `这些章节的正文完全相同，重新采集后仍需人工核对：${group.map((id) => selected.find((c) => c.id === id)!.title).join("、")}`,
        { chapterId: group[0] },
      ),
    );
  return job.reconciliation;
}

export function archiveNotice(job: Job) {
  const details: string[] = [];
  if (
    job.discovery &&
    ["truncated", "unavailable"].includes(job.discovery.status)
  )
    details.push(job.discovery.message);
  if (job.reconciliation) {
    const r = job.reconciliation;
    if (r.failed.length || r.truncated.length || r.duplicateGroups.length)
      details.push(
        `所选 ${r.selected} 章，已取得 ${r.captured} 章；${r.failed.length} 章未完成，${r.truncated.length} 章末尾未确认，${r.duplicateGroups.length} 组重复正文待核对。详情见归档报告。`,
      );
  }
  return details.join(" ");
}
