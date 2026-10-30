import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planRemoval, trashRemovalPlan } from "../electron/removal";
import { createJob } from "../electron/core";

async function fixture() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "folio-removal-test-")),
  );
  const data = path.join(root, "data");
  await fs.mkdir(data);
  const job = createJob("https://example.com", path.join(root, "exports"));
  const cache = path.join(data, "checkpoints", job.id);
  await fs.mkdir(job.outputDir, { recursive: true });
  await fs.mkdir(cache, { recursive: true });
  await fs.writeFile(path.join(job.outputDir, "article.pdf"), "fixture");
  return { root, data, job, cache };
}
test("file removal plans only the owned export and checkpoint directories; missing paths are idempotent", async () => {
  const f = await fixture();
  try {
    const plan = await planRemoval(f.job, [f.job], f.data);
    assert.deepEqual(plan.directories, [f.job.outputDir, f.cache]);
    const trash = path.join(f.root, "isolated-trash");
    await fs.mkdir(trash);
    await trashRemovalPlan(plan, async (p) =>
      fs.rename(p, path.join(trash, p === f.cache ? "cache" : "export")),
    );
    assert.equal(
      await fs.readFile(path.join(trash, "export", "article.pdf"), "utf8"),
      "fixture",
    );
    assert.equal(
      (await planRemoval(f.job, [f.job], f.data)).directories.length,
      0,
    );
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
test("unsafe ownership, shared output and symlinked folders are rejected", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      planRemoval({ ...f.job, outputDir: f.root }, [f.job], f.data),
      /归属/,
    );
    await assert.rejects(
      planRemoval(
        f.job,
        [f.job, { ...f.job, id: "another", outputDir: f.job.outputDir }],
        f.data,
      ),
      /重叠/,
    );
    await assert.rejects(
      planRemoval(
        { ...f.job, id: "exports", outputDir: path.dirname(f.job.outputDir) },
        [],
        f.data,
      ),
      /归属/,
    );
    await assert.rejects(
      planRemoval(
        f.job,
        [
          f.job,
          {
            ...f.job,
            id: "missing-child",
            outputDir: path.join(f.job.outputDir, "missing-child"),
          },
        ],
        f.data,
      ),
      /重叠/,
    );
    const destination = path.join(f.root, "outside");
    await fs.mkdir(destination);
    await fs.rm(f.job.outputDir, { recursive: true });
    await fs.symlink(destination, f.job.outputDir);
    await assert.rejects(planRemoval(f.job, [f.job], f.data), /替换/);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
test("partial trash failure is explicit and leaves remaining files available for retry", async () => {
  const f = await fixture();
  try {
    const plan = await planRemoval(f.job, [f.job], f.data);
    const moved = path.join(f.root, "moved");
    let count = 0;
    await assert.rejects(
      trashRemovalPlan(plan, async (p) => {
        if (count++) throw Error("permission denied");
        await fs.rename(p, moved);
      }),
      /已处理 1\/2.*记录已保留/,
    );
    const retry = await planRemoval(f.job, [f.job], f.data);
    assert.deepEqual(retry.directories, [f.cache]);
    assert.equal(
      await fs.readFile(path.join(moved, "article.pdf"), "utf8"),
      "fixture",
    );
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
