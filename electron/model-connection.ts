import { webURL } from "./core";
import type { ModelConnection } from "../shared/types";

export async function testModelConnection(
  config: ModelConnection,
  savedKey: string,
): Promise<{ message: string }> {
  const endpoint = webURL(String(config.modelEndpoint || ""));
  const model = String(config.model || "")
    .trim()
    .slice(0, 200);
  const key = config.apiKey?.trim() || (config.useSavedKey ? savedKey : "");
  if (!model || !key) throw new Error("请填写模型名称和 API Key");
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 32,
    }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? "服务拒绝访问，请检查密钥和模型权限。"
        : `连接失败（HTTP ${response.status}），请检查地址与模型名称。`,
    );
  const body = await response.json();
  if (
    typeof body.choices?.[0]?.message?.content !== "string" ||
    !body.choices[0].message.content.trim()
  )
    throw new Error("服务返回格式不兼容，请使用聊天补全兼容接口。");
  return {
    message: "连接成功。排版检查还需要模型支持图片；请保存设置后开启检查。",
  };
}
