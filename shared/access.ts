import type { SourceAccess } from "./types";

export interface AccessSignals {
  title: string;
  bodyText: string;
  contentText: string;
  gateText: string;
  loginForm: boolean;
  collapsed: boolean;
  exportDisabled: boolean;
}

// Serialized into the isolated page; keep this function self-contained.
export function detectSourceAccess(s: AccessSignals): SourceAccess {
  const gate = s.gateText.replace(/\s+/g, " ").trim();
  const result = (
    kind: SourceAccess["kind"],
    message: string,
    evidence?: string,
  ): SourceAccess => ({
    kind,
    message,
    ...(evidence ? { evidence: evidence.slice(0, 140) } : {}),
  });
  const match = (pattern: RegExp) => gate.match(pattern)?.[0];
  if (s.exportDisabled)
    return result(
      "export-restricted",
      "来源明确限制保存或导出",
      "来源页面的导出权限提示",
    );
  const challenge = `${s.title} ${s.bodyText.slice(0, 900)}`.match(
    /安全验证|访问验证|请完成验证|访问异常|请求异常|Verify you are human|Just a moment|403 Forbidden/i,
  );
  if (challenge && s.contentText.length < 3000)
    return result("verification", "请先在来源网页完成安全验证", challenge[0]);
  const member = match(
    /(?:开通|购买|订阅|升级|加入)[^。！？\n]{0,24}(?:后(?:可|即可)?(?:查看|阅读|解锁)|解锁(?:全文|剩余|内容)|会员(?:后|可|即享|专享)?|继续阅读|阅读全文)|(?:剩余|完整|全部)内容[^。！？\n]{0,18}(?:会员|订阅|付费|购买)|(?:本文|本篇|此文|此内容|该内容|本节|文章)(?:为|是)?[^。！？\n]{0,8}(?:会员专享|付费内容|订阅专享)|仅限(?:付费)?(?:会员|订阅用户)(?:阅读|查看)|(?:subscribe|subscription required|become a member|purchase)[^.!?\n]{0,40}(?:read|continue|unlock|access)|(?:only|exclusive|available)[^.!?\n]{0,25}(?:paid members|subscribers)/i,
  );
  if (member)
    return result("membership", "当前内容需要会员、订阅或购买权限", member);
  const permission = match(
    /没有访问权限|无权访问|暂无访问权限|请求访问权限|申请(?:查看|访问)权限|access denied|request access/i,
  );
  if (permission)
    return result("permission", "当前账号没有这份内容的访问权限", permission);
  const login = match(
    /登录后(?:可继续阅读完整内容|阅读全文|查看|阅读)|请(?:先)?登录(?:后查看|后阅读|以继续)?|扫码登录|登录以查看|sign in to (?:continue|read|view)|log in to (?:continue|read|view)/i,
  );
  if (login || s.loginForm)
    return result(
      "login",
      "请先登录来源网站，再继续保存",
      login || "来源网站的登录页面",
    );
  const preview = match(
    /本节为部分预览|(?:当前|本文|本篇|此处)(?:仅|只)(?:显示|提供|可查看|可阅读)(?:部分|预览|试读)|试读(?:结束|到此)|免费预览(?:结束|到此)|preview (?:only|ends)|end of (?:the )?(?:free )?preview/i,
  );
  if (preview) return result("preview", "当前页面只提供部分预览", preview);
  if (s.collapsed)
    return result(
      "preview",
      "正文仍处于折叠或预览状态",
      "页面仍有可见的正文遮罩",
    );
  return result("available", "已读取当前可见正文");
}
