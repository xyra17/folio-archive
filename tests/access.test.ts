import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSourceAccess, type AccessSignals } from "../shared/access";

const signals = (
  gateText: string,
  patch: Partial<AccessSignals> = {},
): AccessSignals => ({
  title: "文章",
  bodyText: "正文",
  contentText: "已展示的文章内容",
  gateText,
  loginForm: false,
  collapsed: false,
  exportDisabled: false,
  ...patch,
});

test("access gates distinguish membership, login, permission and preview", () => {
  for (const text of [
    "开通会员后阅读全文",
    "剩余内容仅限订阅用户阅读",
    "本文为会员专享",
    "Subscribe to continue reading",
    "This content is exclusive to paid members",
  ])
    assert.equal(detectSourceAccess(signals(text)).kind, "membership", text);
  assert.equal(detectSourceAccess(signals("请登录后查看")).kind, "login");
  assert.equal(detectSourceAccess(signals("申请访问权限")).kind, "permission");
  assert.equal(
    detectSourceAccess(signals("当前仅显示部分预览")).kind,
    "preview",
  );
  assert.equal(
    detectSourceAccess(signals("", { collapsed: true })).kind,
    "preview",
  );
});

test("export restriction and verification take priority; free prose is not a gate", () => {
  assert.equal(
    detectSourceAccess(signals("请先登录", { exportDisabled: true })).kind,
    "export-restricted",
  );
  assert.equal(
    detectSourceAccess(signals("", { title: "Verify you are human" })).kind,
    "verification",
  );
  assert.equal(
    detectSourceAccess(
      signals("", {
        contentText: "这篇文章讨论会员制度，以及如何设计付费内容。",
      }),
    ).kind,
    "available",
  );
  assert.equal(
    detectSourceAccess(signals("会员中心　登录　订阅通讯")).kind,
    "available",
  );
});
