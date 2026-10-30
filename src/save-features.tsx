import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  FileCheck2,
  Image,
  LayoutTemplate,
  LockKeyhole,
  ScanText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Job, Settings, TemplateId } from "../shared/types";
import { templates, templateFor } from "../shared/templates";
import { Modal } from "./modal";

const api = window.archive;
export const modelReady = (s: Settings) =>
  !!(s.modelEndpoint && s.model && s.hasApiKey);

export function TemplatePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: TemplateId;
  onChange: (id: TemplateId) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: 500, height: 500 });
  const [zoom, setZoom] = useState<"page" | "width">("page");
  useEffect(() => {
    if (!open || !viewportRef.current) return;
    const viewport = viewportRef.current;
    const observer = new ResizeObserver(([entry]) => {
      setPreviewSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [open]);
  useEffect(() => {
    if (!open || Object.keys(previews).length) return;
    let alive = true;
    Promise.all(
      templates.map(async (t) => [t.id, await api.templatePreview(t.id)]),
    )
      .then((pairs) => {
        if (alive) setPreviews(Object.fromEntries(pairs));
      })
      .catch(() => {
        if (alive) setError("暂时无法加载示例，请关闭后重试。");
      });
    return () => {
      alive = false;
    };
  }, [open]);
  const theme = templateFor(draft);
  const scale = Math.max(
    0.2,
    Math.min(
      1,
      (previewSize.width - 24) / 794,
      zoom === "page" ? (previewSize.height - 24) / 1123 : 1,
    ),
  );
  return (
    <>
      <button
        type="button"
        className="template-trigger"
        disabled={disabled}
        onClick={() => {
          setDraft(value);
          setError("");
          setOpen(true);
        }}
      >
        <span className="template-symbol" aria-hidden="true">
          <LayoutTemplate size={17} />
          <span className="template-mini-paper" data-theme={value}>
            <i />
            <i />
            <i />
            <i />
          </span>
        </span>
        <span className="template-copy">
          <small>文档排版</small>
          <strong>
            {templateFor(value).name}
            <span className="template-formats">PDF · Word</span>
          </strong>
        </span>
        <span className="template-change">
          预览与更换
          <ChevronRight size={13} />
        </span>
      </button>
      {open && (
        <Modal title="选择一套喜欢的排版" wide onClose={() => setOpen(false)}>
          <div className="template-workspace">
            <div
              className="template-sidebar"
              role="group"
              aria-label="内置排版模板"
            >
              {templates.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={`template-option ${draft === t.id ? "chosen" : ""}`}
                  aria-pressed={draft === t.id}
                  onClick={() => setDraft(t.id)}
                >
                  <span
                    className="template-paper"
                    data-theme={t.id}
                    style={
                      { "--theme-color": `#${t.accent}` } as React.CSSProperties
                    }
                  >
                    <span>
                      从阅读
                      <br />
                      到知识
                    </span>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>
                    <strong>{t.name}</strong>
                    <small>{t.description}</small>
                  </span>
                  {draft === t.id && <Check size={16} />}
                </button>
              ))}
              <p className="template-note">
                PDF 使用这套版式，Word 保留对应字体与层级。HTML
                自动使用网页阅读版，Markdown 保留内容结构；PDF 原件保持原样。
              </p>
            </div>
            <div className="template-stage">
              <div className="template-stage-heading">
                <div>
                  <span>{theme.name}</span>
                  <small>{theme.detail}</small>
                </div>
                <div
                  className="template-zoom"
                  role="group"
                  aria-label="预览缩放"
                >
                  <button
                    type="button"
                    aria-pressed={zoom === "page"}
                    onClick={() => setZoom("page")}
                  >
                    整页
                  </button>
                  <button
                    type="button"
                    aria-pressed={zoom === "width"}
                    onClick={() => setZoom("width")}
                  >
                    适合宽度
                  </button>
                </div>
              </div>
              <div className="template-viewport" ref={viewportRef}>
                {error ? (
                  <p role="alert">{error}</p>
                ) : previews[draft] ? (
                  <div
                    className="template-preview-sheet"
                    style={{ width: 794 * scale, height: 1123 * scale }}
                  >
                    <iframe
                      key={draft}
                      title={`${theme.name} 排版示例`}
                      srcDoc={previews[draft]}
                      sandbox=""
                      style={{
                        width: 794,
                        height: 1123,
                        transform: `scale(${scale})`,
                      }}
                    />
                  </div>
                ) : (
                  <div className="loading">正在准备示例…</div>
                )}
              </div>
              <span className="template-caption">
                A4 排版示例 · 实际分页随正文长度变化
              </span>
            </div>
          </div>
          <div className="modal-actions">
            <span>内置模板可直接使用，无需 AI</span>
            <button
              type="button"
              className="primary"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              使用这套排版
              <Check size={15} />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function AIReviewControl({
  value,
  onChange,
  settings,
  onConfigure,
  disabled = false,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  settings: Settings;
  onConfigure: () => void;
  disabled?: boolean;
}) {
  const ready = modelReady(settings);
  return (
    <div className={`ai-control ${value ? "enabled" : ""}`}>
      <div className="ai-control-heading">
        <span className="ai-control-icon" aria-hidden="true">
          <Sparkles size={17} />
        </span>
        <span className="ai-control-copy">
          <strong>
            AI 辅助检查
            <span className="ai-state">{value ? "已开启" : "可选"}</span>
          </strong>
          <span className="ai-control-description">
            <small>
              {value
                ? "保存后核对内容与页面"
                : ready
                  ? "模型已就绪，按需开启"
                  : "基础保存无需 AI"}
            </small>
            {!value && (
              <button
                type="button"
                className="ai-configure text-button"
                onClick={onConfigure}
                disabled={disabled}
              >
                {ready ? "服务设置" : "配置模型"}
                <ChevronRight size={12} />
              </button>
            )}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-label="AI 辅助检查"
          aria-checked={value}
          className="switch"
          disabled={disabled}
          onClick={() => (ready || value ? onChange(!value) : onConfigure())}
        >
          <span />
        </button>
      </div>
      {value && (
        <div className="ai-expanded">
          <div>
            <span>
              <ScanText size={15} />
              核对内容
            </span>
            <span>
              <Image size={15} />
              检查页面
            </span>
            <button type="button" className="text-button" onClick={onConfigure}>
              设置服务
            </button>
          </div>
          <p>
            发送待检查正文与页面图片，可能产生服务费用。检查会提示问题，不自动改写正文。
          </p>
        </div>
      )}
    </div>
  );
}

const accessCopy = {
  login: [
    "登录后，接着保存",
    "请在来源网站登录。登录成功后，回到这里重新检查。",
  ],
  membership: [
    "这部分内容需要会员权限",
    "请在来源网站使用已订阅或已购买的账号打开正文，再回来重新检查。",
  ],
  verification: [
    "来源网站需要你完成验证",
    "请打开网页，完成验证码或安全确认，再继续保存。",
  ],
  permission: [
    "当前账号还没有访问权限",
    "请在来源网站切换有权限的账号，或向内容所有者申请访问。",
  ],
  preview: [
    "现在只能看到部分预览",
    "请先在来源网页展开或解锁正文。当前预览不会作为完整内容导出。",
  ],
  "export-restricted": [
    "来源限制了保存或导出",
    "请在来源网页查看权限设置，或联系内容所有者确认是否允许导出。",
  ],
} as const;

export function AccessNotice({
  job,
  onOpen,
  onRetry,
}: {
  job: Job;
  onOpen: () => void;
  onRetry: () => void;
}) {
  if (job.status !== "waiting_login" && job.status !== "failed") return null;
  const kind = job.access?.kind === "available" ? undefined : job.access?.kind;
  if (!kind && job.status !== "waiting_login") return null;
  const resolvedKind = kind || "login";
  const [title, description] = accessCopy[resolvedKind];
  const done = job.chapters.filter((c) => c.status === "ready").length;
  return (
    <section className="access-notice" aria-label="来源访问状态">
      <div className="access-heading">
        <span className="access-icon">
          <LockKeyhole size={20} />
        </span>
        <div>
          <small>{new URL(job.access?.url || job.url).hostname}</small>
          <h3>{title}</h3>
        </div>
      </div>
      <p>{description}</p>
      {job.access?.evidence && (
        <div className="access-evidence">网页提示：{job.access.evidence}</div>
      )}
      <ol className="access-steps">
        <li>
          <span>1</span>打开来源网页
        </li>
        <li>
          <span>2</span>
          {resolvedKind === "membership"
            ? "确认账号与会员权限"
            : resolvedKind === "verification"
              ? "完成网页验证"
              : "处理访问提示"}
        </li>
        <li>
          <span>3</span>回来重新检查
        </li>
      </ol>
      <div className="access-actions">
        <button type="button" onClick={onOpen}>
          打开来源网页
          <ArrowUpRight size={14} />
        </button>
        <button type="button" className="primary" onClick={onRetry}>
          我已处理，重新检查
        </button>
      </div>
      <p className="access-footnote">
        <ShieldCheck size={13} />
        {done
          ? `已保留 ${done} 个完成章节，继续时会复用。`
          : "登录状态保存在这台电脑，与系统浏览器独立。"}
      </p>
    </section>
  );
}

export function ReviewSummary({ job }: { job: Job }) {
  if (!job.discovery && (!job.exports.length || !job.options.aiReview))
    return null;
  const counts = job.reconciliation;
  const labels = {
    "not-requested": "未启用",
    pending: "检查中",
    passed: "范围内未发现问题",
    issues: "有待核对项",
    unavailable: "未完成",
  };
  return (
    <details className="review-summary">
      <summary>
        <FileCheck2 size={16} />
        <strong>保存范围与检查</strong>
        <span>
          {counts
            ? `已取得 ${counts.captured} / ${counts.selected} 章`
            : `已发现 ${job.chapters.length} 章`}
        </span>
        <ChevronRight size={14} />
      </summary>
      <div>
        {job.discovery && (
          <p>
            {job.discovery.message}
            {job.discovery.declared
              ? `（页面声明 ${job.discovery.declared} 章，本次发现 ${job.discovery.observed} 章）`
              : ""}
          </p>
        )}
        {counts && (
          <p>
            选择 {counts.selected} 章，取得 {counts.captured}{" "}
            章，已到末尾且无重复 {counts.verified} 章。
            <br />
            起点：{counts.firstChapter}
            <br />
            终点：{counts.lastChapter}
          </p>
        )}
        {!!counts?.failed.length && (
          <p>
            未完成：
            {job.chapters
              .filter((c) => counts.failed.includes(c.id))
              .map((c) => c.title)
              .join("、")}
          </p>
        )}
        {!!counts?.truncated.length && (
          <p>{counts.truncated.length} 章尚未确认加载到末尾。</p>
        )}
        {!!counts?.duplicateGroups.length && (
          <p>{counts.duplicateGroups.length} 组正文重复，重试后仍需核对。</p>
        )}
        <p>
          {job.coverage.layoutScope ||
            (job.coverage.rulePages
              ? `已检查最终 PDF ${job.coverage.rulePages} 页`
              : "尚无最终 PDF 分页检查结果")}
        </p>
        {!!job.coverage.layoutRepairs?.length && (
          <p>自动排版调整：{job.coverage.layoutRepairs.join("；")}</p>
        )}
        {!!job.coverage.layoutChecks?.length && (
          <p>
            复检仍需核对：
            {job.coverage.layoutChecks
              .map((f) => `第 ${f.page} 页：${f.message}`)
              .join("；")}
          </p>
        )}
        {job.options.aiReview && (
          <>
            <p>
              内容核对：{labels[job.coverage.content]}
              <br />
              页面检查：{labels[job.coverage.layout]}
            </p>
          </>
        )}
        <small>结果仅针对实际检查的内容，不代表未知来源的全文完整性。</small>
      </div>
    </details>
  );
}
