import { test } from "node:test";
import assert from "node:assert/strict";
import { createJob } from "../electron/core";
import { mergeDirectory } from "../electron/directory";
import { reconcile, archiveNotice } from "../electron/completeness";
import { readerHTML } from "../electron/reader-html";

test("directory windows preserve relative order and distinguish same-title nodes", () => {
  const node = (n: number) => ({
    title: "同名",
    url: "https://example.com/book",
    navigationKey: `node:${n}`,
  });
  const links = mergeDirectory([node(3), node(4)], [node(1), node(2), node(3)]);
  assert.deepEqual(
    mergeDirectory(links, [node(4), node(5)]).map((n) => n.navigationKey),
    ["node:1", "node:2", "node:3", "node:4", "node:5"],
  );
});

test("failed stale content is excluded, missing and unknown-end chapters remain explicit", async () => {
  const job = createJob("https://example.com/book", "/tmp");
  job.chapters = ["ready", "failed", "ready"].map((status, i) => ({
    id: String(i),
    title: `第${i + 1}章`,
    url: job.url,
    selected: true,
    status: status as "ready" | "failed",
    assets: [],
    blocks: [
      {
        id: String(i),
        type: "paragraph",
        text: i === 1 ? "STALE-FAILED-BODY" : `本章内容${i}`,
      },
    ],
    capture: {
      title: "测试",
      firstText: "开头",
      lastText: "结尾",
      reachedEnd: i !== 2,
      steps: 2,
      retries: 0,
    },
  }));
  const r = reconcile(job);
  assert.deepEqual(r.failed, ["1"]);
  assert.deepEqual(r.truncated, ["2"]);
  assert.equal(r.verified, 1);
  assert(archiveNotice(job).includes("1 章未完成"));
  assert(!(await readerHTML(job)).includes("STALE-FAILED-BODY"));
  job.chapters[1].status = "ready";
  job.chapters[2].capture!.reachedEnd = true;
  reconcile(job);
  assert(
    !job.issues.some(
      (i) =>
        i.code === "chapter-missing" || i.code === "chapter-end-unverified",
    ),
  );
});

test("duplicate substantive bodies are reported without treating short boilerplate as duplicates", () => {
  const job = createJob("https://example.com/book", "/tmp");
  job.chapters = [1, 2, 3, 4].map((n) => ({
    id: String(n),
    title: `第${n}章`,
    url: job.url,
    selected: true,
    status: "ready",
    assets: [],
    blocks: [
      {
        id: String(n),
        type: "paragraph",
        text: n < 3 ? "这是需要核对的重复正文。".repeat(30) : "短提示",
      },
    ],
    capture: {
      title: "测试",
      firstText: "开头",
      lastText: "结尾",
      reachedEnd: true,
      steps: 2,
      retries: 0,
    },
  }));
  assert.deepEqual(reconcile(job).duplicateGroups, [["1", "2"]]);
  assert.equal(job.reconciliation!.verified, 2);
});
