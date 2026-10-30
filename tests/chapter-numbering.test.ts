import { test } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { chapterTitle } from "../shared/chapters";
import { createJob } from "../electron/core";
import { readerHTML } from "../electron/reader-html";

test("source numbers do not depend on archive position or invented chapter numbers", () => {
  assert.equal(
    chapterTitle({ title: "客服邮件分流", sourceNumber: "16." }),
    "16. 客服邮件分流",
  );
  assert.equal(
    chapterTitle({ title: "16. 客服邮件分流", sourceNumber: "16." }),
    "16. 客服邮件分流",
  );
  assert.equal(chapterTitle({ title: "前言" }), "前言");
  assert.equal(
    chapterTitle({ title: "子章节", sourceNumber: "2.1." }),
    "2.1. 子章节",
  );
});

test("HTML keeps source number 16 when only that chapter is selected, without duplicating its source heading", async () => {
  const job = createJob("https://example.com/book", "/tmp");
  job.title = "整本书";
  job.chapters = [15, 16, 17].map((n) => ({
    id: String(n),
    title: n === 16 ? "客服邮件分流" : `章节${n}`,
    sourceNumber: `${n}.`,
    url: job.url,
    selected: n === 16,
    status: "ready",
    assets: [],
    blocks: [
      {
        id: `h${n}`,
        type: "heading",
        text: n === 16 ? "客服邮件分流" : `章节${n}`,
        level: 1,
      },
      { id: `p${n}`, type: "paragraph", text: "正文" },
    ],
  }));
  const $ = cheerio.load(await readerHTML(job));
  assert.equal($(".chapter h2").length, 1);
  assert.equal($(".chapter h2").text(), "16. 客服邮件分流#");
  assert.equal($(".contents .toc-number").text(), "16.");
  assert(!$(".contents nav").text().includes("01"));
});
