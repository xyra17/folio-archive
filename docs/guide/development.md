# 开发指南

[返回 README](../../README.md)

## 环境

- Node.js 24+、npm。
- 当前主要支持与验证环境：macOS Apple Silicon。
- 安装依赖需联网，包含 Electron 与打包工具的运行文件。安装后的桌面应用不要求用户另装 Node.js、Python、Pandoc 或 LibreOffice。

```bash
git clone https://github.com/xyra17/folio-archive.git
cd folio-archive
npm ci
npm run dev
```

`npm run dev` 启动 Vite 并打开 Electron。修改 Electron 主进程或 preload 后请重启开发进程。

建议使用独立资料目录进行开发，避免修改日常资料库。在 macOS / Linux shell 中：

```bash
FOLIO_DATA_DIR="$PWD/.test-data/dev" npm run dev
```

## 构建与测试

| 命令 | 用途 |
| --- | --- |
| `npm test` | URL / 路径边界、内容范围、并发、差异、HTML 阅读版、目录命名等单元测试 |
| `npm run build` | TypeScript 检查、Vite 和 Electron 构建 |
| `npm start` | 运行已构建的应用 |
| `npm run test:e2e` | 以本机模拟来源测试采集、四种导出、权限恢复和 UI 行为 |
| `npm run test:pipeline` | 目录、章节核对、漏章重试、跨页排版与成品检查 |
| `npm run test:sites` | 访问公开网页样本，结果受网络和来源变化影响 |
| `npm run format` | 格式化代码 |
| `npm run package:mac` | 生成 macOS arm64 应用目录 |
| `npm run dist:mac` | 生成 macOS arm64 DMG / ZIP |

E2E 会打开本地 Electron 窗口，需要图形桌面环境。默认数据在 `.test-output/`，不使用日常资料库；测试输出可能包含正文，不应提交仓库。单元测试不等于全部网页兼容性保证。

安装包默认输出在 `release/`。Windows 的 `npm run dist:win` 仅预留配置，尚未构建和验收；不要据此宣传已支持 Windows。

### 验证打包应用

```bash
npm run package:mac
FOLIO_EXECUTABLE="$PWD/release/mac-arm64/拾页.app/Contents/MacOS/拾页" \
FOLIO_DATA_DIR="$PWD/.test-output/packaged" node scripts/e2e.mjs
```

### 验证真实来源

以下命令会访问传入的网页，使用独立测试资料库，并生成本地归档。只传入你有权访问和保存的链接。

```bash
npm run test:smoke -- 'https://example.com/document'
```

默认仅首章、最多滚动 20 次，避免把快速检查误当作完整资料验收。需要整套资料时可显式指定：

```bash
FOLIO_SMOKE_ALL_CHAPTERS=1 FOLIO_SMOKE_STEPS=160 \
  npm run test:smoke -- 'https://example.com/book'
```

测试模式关闭付费模型调用。报告位于 `.test-output/live/`；结束后请检查具体内容、素材和缺失记录。

## 代码结构

```text
src/                       React 界面与 PDF 检查渲染器
shared/                    类型、模板、章节与访问状态
electron/main.ts           应用入口、IPC、本地预览和更新
electron/browser.ts        隔离来源会话、目录发现与滚动采集
electron/extract.ts        内容块解析与范围过滤
electron/engine.ts         队列、检查点、素材、版本与重试
electron/export.ts         PDF / Word / Markdown / HTML / ZIP
electron/reader-html.ts    单文件 HTML 阅读版
electron/review.ts         可选 AI 检查与预算
electron/store.ts          SQLite 与模型密钥加密
electron/archive-directory.ts 文件夹命名与归属
tests/                    单元测试和公开来源样本清单
scripts/                  开发、构建、测试与依赖声明生成
docs/guide/               使用、开发与隐私文档
```

处理流程为：链接 → 目录和访问状态识别 → 正文 / 素材采集 → 范围过滤与检查 → 格式导出 → 结果报告。基础流程使用程序规则；模型检查可选。

来源窗口与应用界面隔离，来源页面没有 Node.js 权限或应用 IPC。HTML 导出清理来源脚本，只授权阅读版自有的固定脚本。

## 发布

`npm run dist:mac` 生成分发文件。公开安装包应附 SHA-256 校验值，并说明架构、签名状态与本次实际验证范围。当前构建没有 Developer ID 签名与公证。

正式签名、公证与更新托管需要维护者自己的账号和渠道。不要在源码中写入 Apple 凭据、GitHub Token 或模型密钥。第三方运行时依赖声明由构建中的 `scripts/notices.mjs` 生成，输出到 `THIRD_PARTY_NOTICES.md` 并放入应用包。

本地历史验收材料、个人测试截图和清理记录不属于公共文档，已从默认 Git 提交范围排除。
