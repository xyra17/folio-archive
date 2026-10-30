import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  archiveFolderName,
  ensureArchiveDirectory,
} from "../electron/archive-directory";
import { createJob } from "../electron/core";
import { planRemoval } from "../electron/removal";

test("folder names sort by local save date and preserve readable, filesystem-safe titles", () => {
  const at = new Date(2026, 9, 30, 17, 7, 0).toISOString();
  assert.equal(
    archiveFolderName("文章标题", new Date(2026, 9, 30, 21, 14).toISOString()),
    "2026-10-30文章标题",
  );
  assert.equal(
    archiveFolderName("Effective context engineering for AI agents", at),
    "2026-10-30Effective context engineering for AI agents",
  );
  assert.equal(
    archiveFolderName("  文档\n标题: A/B? . ", at),
    "2026-10-30文档 标题_ A_B_",
  );
  const long = archiveFolderName("标题😀".repeat(100), at);
  assert(Buffer.byteLength(long) < 220);
  assert(!long.includes("\ufffd"));
  assert.equal(
    archiveFolderName("同名", at),
    archiveFolderName("同名", new Date(2026, 9, 30, 23, 59, 59).toISOString()),
  );
  assert(
    archiveFolderName("同名", at) <
      archiveFolderName("同名", new Date(2026, 9, 31, 0).toISOString()),
  );
});

test("concurrent same-title saves never reuse another folder; resume and file removal retain ownership", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-naming-")),
  );
  try {
    const data = path.join(root, "data");
    await fs.mkdir(data);
    const jobs = Array.from({ length: 3 }, (_, hour) => {
      const job = createJob("https://example.com", path.join(root, "exports"));
      job.title = "文章标题";
      job.createdAt = new Date(2026, 9, 30, 17 + hour, 7).toISOString();
      return job;
    });
    await Promise.all(
      jobs.flatMap((job) => [
        ensureArchiveDirectory(job),
        ensureArchiveDirectory(job),
      ]),
    );
    assert.equal(new Set(jobs.map((j) => j.outputDir)).size, 3);
    assert.deepEqual(
      jobs.map((j) => path.basename(j.outputDir)).sort(),
      [
        "2026-10-30文章标题",
        "2026-10-30文章标题 (2)",
        "2026-10-30文章标题 (3)",
      ].sort(),
    );
    const job = jobs[0];
    const first = job.outputDir;
    await fs.writeFile(path.join(first, "文章.html"), "saved content");
    job.title = "重新识别的标题";
    await ensureArchiveDirectory(job);
    assert.equal(job.outputDir, first);
    assert.equal(
      await fs.readFile(path.join(first, "文章.html"), "utf8"),
      "saved content",
    );
    assert.deepEqual((await planRemoval(job, jobs, data)).directories, [first]);
    const owner = path.join(first, ".folio-archive.json");
    await fs.writeFile(owner, JSON.stringify({ jobId: jobs[1].id }));
    await assert.rejects(planRemoval(job, jobs, data), /归属/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("legacy UUID folders stay readable and retries preserve their existing files", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-legacy-")),
  );
  try {
    const job = createJob("https://example.com", root);
    const previous = job.outputDir;
    await fs.mkdir(previous);
    await fs.writeFile(path.join(previous, "old.pdf"), "old content");
    await ensureArchiveDirectory(job);
    assert.equal(job.outputDir, previous);
    assert.equal(
      await fs.readFile(path.join(previous, "old.pdf"), "utf8"),
      "old content",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
