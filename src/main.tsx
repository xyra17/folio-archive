import React, { useEffect, useRef, useState } from "react";
import { chapterTitle } from "../shared/chapters";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardPaste,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  Link2,
  Loader2,
  Keyboard,
  Trash2,
  Minus,
  Maximize2,
  Minimize2,
  Pause,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  ScanText,
  Image,
  X,
} from "lucide-react";
import type {
  AppState,
  Format,
  Job,
  JobOptions,
  JobStatus,
  Settings,
} from "../shared/types";
import "./style.css";
import { templateFor } from "../shared/templates";
import { Modal } from "./modal";
import { RemovalConfirm } from "./removal-confirm";
import {
  TemplatePicker,
  AIReviewControl,
  AccessNotice,
  ReviewSummary,
} from "./save-features";

const api = window.archive;
type Run = <T>(work: () => Promise<T>) => Promise<T | undefined>;
const initialOptions: JobOptions = {
  formats: ["pdf"],
  template: "reading",
  fromHeading: "",
  excludeHeadings: "",
  aiReview: false,
};
const formatNames: Record<Format, string> = {
  pdf: "PDF",
  docx: "Word",
  md: "Markdown",
  html: "HTML",
};
const stateNames: Record<JobStatus, string> = {
  inspecting: "正在读取链接",
  ready: "等待选择",
  queued: "等待保存",
  running: "正在保存",
  paused: "已暂停",
  waiting_login: "需要在网页确认",
  completed: "已保存",
  partial: "已保存 · 有提示",
  failed: "保存失败",
  cancelled: "已取消",
};
const phaseNames: Record<string, string> = {
  discover: "正在读取链接…",
  capture: "正在读取正文…",
  assets: "正在保存图片…",
  content: "正在检查内容…",
  layout: "正在整理排版…",
  export: "正在生成文件…",
};
const busy = (j: Job) => ["inspecting", "queued", "running"].includes(j.status);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "网页";
  }
};
const date = (s: string) =>
  new Date(s).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
const size = (n: number) =>
  n > 1048576
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
const warnings = (j: Job) =>
  j.issues.filter((i) => !i.resolved && i.code !== "scope-known");

function Formats({
  value,
  onChange,
  disabled = false,
  detailed = false,
}: {
  value: Format[];
  onChange: (f: Format[]) => void;
  disabled?: boolean;
  detailed?: boolean;
}) {
  return (
    <div
      className={`format-picker ${detailed ? "detailed" : ""}`}
      role="group"
      aria-label="保存格式"
    >
      {(["pdf", "docx", "md", "html"] as Format[]).map((f) => (
        <button
          key={f}
          type="button"
          disabled={disabled}
          className={`format-choice ${value.includes(f) ? "chosen" : ""}`}
          aria-pressed={value.includes(f)}
          onClick={() =>
            onChange(
              value.includes(f) ? value.filter((v) => v !== f) : [...value, f],
            )
          }
        >
          <span className={`format-mark ${f}`}>
            {f === "pdf"
              ? "PDF"
              : f === "docx"
                ? "W"
                : f === "html"
                  ? "</>"
                  : "MD"}
          </span>
          <span className="format-copy">
            <strong>{formatNames[f]}</strong>
            {detailed && (
              <small>
                {f === "pdf"
                  ? "阅读与打印"
                  : f === "docx"
                    ? "继续编辑"
                    : f === "html"
                      ? "离线网页"
                      : "笔记与整理"}
              </small>
            )}
          </span>
          <span className="format-check" aria-hidden="true">
            {value.includes(f) && <Check size={12} strokeWidth={2.5} />}
          </span>
        </button>
      ))}
    </div>
  );
}
function WindowControls({ state }: { state?: AppState }) {
  const expanded = state?.window.maximized || state?.window.fullscreen;
  const controls = [
    {
      action: "close",
      label: "关闭窗口",
      icon: <X size={9} strokeWidth={2.2} />,
    },
    {
      action: "minimize",
      label: "最小化窗口",
      icon: <Minus size={9} strokeWidth={2.2} />,
    },
    {
      action: "zoom",
      label: expanded ? "恢复窗口" : "放大窗口",
      icon: expanded ? (
        <Minimize2 size={8} strokeWidth={2.2} />
      ) : (
        <Plus size={9} strokeWidth={2.2} />
      ),
    },
  ] as const;
  return (
    <div
      className={`window-controls ${state?.platform === "win32" ? "windows" : "mac"}`}
      aria-label="窗口控制"
    >
      {controls.map((control) => (
        <button
          key={control.action}
          type="button"
          className={`window-control ${control.action}`}
          aria-label={control.label}
          title={
            control.action === "zoom"
              ? `${control.label} · 按住 Option 点击可切换全屏`
              : control.label
          }
          onClick={(e) =>
            void api.windowControl(
              control.action === "zoom" && e.altKey
                ? "fullscreen"
                : control.action,
            )
          }
        >
          <span>
            {state?.platform === "win32" && control.action === "zoom" ? (
              <Maximize2 size={10} />
            ) : (
              control.icon
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
function Status({ job: j }: { job: Job }) {
  const accessLabels: Record<string, string> = {
    login: "需要登录",
    membership: "需要会员权限",
    verification: "需要网页验证",
    permission: "暂无访问权限",
    preview: "仅显示预览",
    "export-restricted": "来源限制导出",
  };
  return (
    <span className={`status ${j.status}`}>
      {busy(j) ? (
        <Loader2 size={13} className="spin" />
      ) : j.status === "completed" ? (
        <CheckCircle2 size={13} />
      ) : null}
      {j.access &&
      j.access.kind !== "available" &&
      ["waiting_login", "failed"].includes(j.status)
        ? accessLabels[j.access.kind]
        : stateNames[j.status]}
    </span>
  );
}
function Options({
  value,
  onChange,
  disabled = false,
}: {
  value: JobOptions;
  onChange: (v: JobOptions) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="option-fields">
      <div className="form-grid">
        <label className="field">
          从哪个标题开始
          <input
            value={value.fromHeading}
            onChange={(e) =>
              onChange({ ...value, fromHeading: e.target.value })
            }
            placeholder="默认从开头保存"
          />
        </label>
        <label className="field">
          跳过的小节
          <input
            value={value.excludeHeadings}
            onChange={(e) =>
              onChange({ ...value, excludeHeadings: e.target.value })
            }
            placeholder="输入标题，多个用逗号分隔"
          />
        </label>
      </div>
    </fieldset>
  );
}
function JobRow({
  job: j,
  run,
  onSelect,
}: {
  job: Job;
  run: Run;
  onSelect: () => void;
}) {
  const [confirmation, setConfirmation] = useState<"cancel" | "remove" | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const quickRef = useRef<HTMLButtonElement>(null);
  const cancellable = busy(j) || ["paused", "waiting_login"].includes(j.status);
  const quickAction = cancellable ? "cancel" : "remove";
  useEffect(() => {
    if (confirmation) keepRef.current?.focus();
  }, [confirmation]);
  // A task may change state while confirmation is open. Never reuse stale intent.
  useEffect(() => {
    setConfirmation(null);
  }, [quickAction]);
  const dismiss = () => {
    setConfirmation(null);
    quickRef.current?.focus();
  };
  const confirm = async () => {
    if (pending || confirmation !== "cancel" || quickAction !== "cancel")
      return;
    setPending(true);
    await run(async () => {
      await api.action(j.id, "cancel");
      setConfirmation(null);
      quickRef.current?.focus();
    });
    setPending(false);
  };
  const main =
    j.exports.find((f) => j.options.formats.includes(f.format as Format)) ||
    j.exports.find((f) => f.format !== "report" && f.format !== "zip");
  return (
    <div
      className={`job-row ${confirmation ? "confirming" : ""}`}
      data-job-id={j.id}
      ref={rowRef}
      onKeyDown={(e) => {
        if (
          e.defaultPrevented ||
          e.repeat ||
          e.metaKey ||
          e.ctrlKey ||
          e.altKey ||
          pending
        )
          return;
        if (
          (e.target as HTMLElement).closest(
            'input,textarea,select,[contenteditable="true"],[role="textbox"]',
          )
        )
          return;
        if (e.key === "Escape" && confirmation) {
          e.preventDefault();
          e.stopPropagation();
          dismiss();
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          e.stopPropagation();
          setConfirmation(quickAction);
        }
      }}
    >
      <button className="job-main" onClick={onSelect}>
        <span className="document-icon">
          <FileText size={22} strokeWidth={1.5} />
        </span>
        <span className="job-copy">
          <strong title={j.title}>{j.title || host(j.url)}</strong>
          <span className="job-metadata">
            <span className="job-source">{host(j.url)}</span>
            <i>·</i>
            <span>{date(j.createdAt)}</span>
            {!busy(j) && main && (
              <>
                <i>·</i>
                <span>
                  {j.options.formats.map((f) => formatNames[f]).join(" / ")}
                </span>
              </>
            )}
            <span className="job-meta-status">
              <Status job={j} />
            </span>
          </span>
          {busy(j) && <span className="job-phase">{phaseNames[j.phase]}</span>}
        </span>
      </button>
      <div className="job-actions">
        {j.status === "waiting_login" ? (
          <button onClick={onSelect}>
            处理并继续
            <ChevronRight size={13} />
          </button>
        ) : j.status === "paused" ? (
          <button onClick={() => run(() => api.action(j.id, "resume"))}>
            继续
          </button>
        ) : j.status === "failed" ? (
          <button
            onClick={
              j.access?.kind === "export-restricted"
                ? onSelect
                : () => run(() => api.action(j.id, "retry"))
            }
          >
            {j.access?.kind === "export-restricted" ? "查看权限" : "重试"}
          </button>
        ) : j.status === "ready" ? (
          <button onClick={onSelect}>选择并保存</button>
        ) : j.status === "cancelled" && !main ? (
          <button onClick={onSelect}>重新保存</button>
        ) : busy(j) ? (
          <button
            className="icon-button"
            aria-label="暂停保存"
            onClick={() => run(() => api.action(j.id, "pause"))}
          >
            <Pause size={15} />
          </button>
        ) : main ? (
          <button onClick={() => run(() => api.open(j.id, main.name))}>
            打开
            <ArrowUpRight size={13} />
          </button>
        ) : null}
        <button
          className="job-details-link"
          aria-label={`查看 ${j.title} 的详情`}
          title="查看详情"
          onClick={onSelect}
        >
          详情
          <ChevronRight size={13} />
        </button>
        <button
          ref={quickRef}
          className={`job-quick-action ${quickAction === "remove" ? "job-remove" : "job-cancel"}`}
          title={`${cancellable ? "取消任务" : "从列表移除，保留已导出文件"}（Delete / Backspace）`}
          aria-label={`${cancellable ? "取消任务" : "从列表移除"}：${j.title}`}
          aria-keyshortcuts="Delete Backspace"
          aria-expanded={!!confirmation}
          disabled={pending}
          onClick={() =>
            confirmation ? dismiss() : setConfirmation(quickAction)
          }
        >
          {cancellable ? <X size={14} /> : <Trash2 size={14} />}
          {cancellable ? "取消" : "移除"}
        </button>
      </div>
      {confirmation === "remove" ? (
        <RemovalConfirm
          job={j}
          onDismiss={dismiss}
          onPendingChange={setPending}
          onConfirm={async (mode) => {
            const row = rowRef.current;
            const neighbor = row?.nextElementSibling?.matches(".job-row")
              ? row.nextElementSibling
              : row?.previousElementSibling;
            await api.remove(j.id, mode);
            setConfirmation(null);
            (
              neighbor?.querySelector<HTMLElement>("button") ||
              document.querySelector<HTMLElement>(".main-nav button")
            )?.focus();
          }}
        />
      ) : (
        confirmation && (
          <div className="row-confirm" role="group" aria-label="确认取消任务">
            <div className="row-confirm-copy">
              <strong>取消当前任务？</strong>
              <span>已有文件保留，可重新保存</span>
            </div>
            <div className="row-confirm-actions">
              <button ref={keepRef} disabled={pending} onClick={dismiss}>
                返回
                <kbd>Esc</kbd>
              </button>
              <button
                className="confirm-action"
                disabled={pending}
                onClick={confirm}
              >
                {pending ? "正在处理…" : "取消任务"}
              </button>
            </div>
          </div>
        )
      )}
      {busy(j) && (
        <div className="saving-line">
          <span />
        </div>
      )}
    </div>
  );
}
function TaskShortcuts() {
  return (
    <details className="job-keyboard-hint">
      <summary>
        <Keyboard size={13} />
        快捷键
      </summary>
      <span>
        焦点在任务上时，<kbd>Delete</kbd> / <kbd>Backspace</kbd>{" "}
        打开移除或取消确认，<kbd>Esc</kbd> 返回。
      </span>
    </details>
  );
}
function App() {
  const [state, setState] = useState<AppState>();
  const [view, setView] = useState<"save" | "library">("save");
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<JobOptions>(initialOptions);
  const [chooseChapters, setChooseChapters] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAI, setSettingsAI] = useState(false);
  const [toast, setToast] = useState("");
  const [dragging, setDragging] = useState(false);
  const [newJobId, setNewJobId] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const run: Run = async (work) => {
    try {
      return await work();
    } catch (e) {
      setToast(
        String((e as Error).message).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          "",
        ),
      );
    }
  };
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api
        .state()
        .then((s) => {
          if (alive) setState(s);
        })
        .catch((e) => setToast(e.message));
    void refresh();
    const off = api.onChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 6500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (!newJobId) return;
    const row = document.querySelector(`[data-job-id="${newJobId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setNewJobId("");
    }
  }, [newJobId, state]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setView("save");
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (!state)
    return (
      <div className="app">
        <header className="topbar">
          <WindowControls />
        </header>
        <div className="loading">
          <Loader2 size={20} className="spin" />
          正在打开拾页…
        </div>
      </div>
    );
  const job = state.jobs.find((j) => j.id === selected);
  const recent = state.jobs.slice(0, 4);
  const linkCount = input.split(/\n/).filter((line) => line.trim()).length;
  const modifier = state.platform === "darwin" ? "⌘" : "Ctrl";
  const visible = state.jobs.filter((j) =>
    `${j.title} ${j.url} ${j.tags.join(" ")} ${j.collection} ${j.chapters.map((c) => c.blocks.map((b) => b.text).join(" ")).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const urls = input
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!urls.length) {
      setError("请先粘贴一个网页链接。");
      inputRef.current?.focus();
      return;
    }
    if (urls.length > 30) {
      setError("一次最多保存 30 个链接，请分批添加。");
      inputRef.current?.focus();
      return;
    }
    try {
      urls.forEach((u) => {
        const parsed = new URL(u);
        if (
          !/^https?:$/.test(parsed.protocol) ||
          parsed.username ||
          parsed.password
        )
          throw Error();
      });
    } catch {
      setError("链接需以 https:// 或 http:// 开头，多个链接请分行填写。");
      return;
    }
    if (!options.formats.length) {
      setError("请选择至少一种保存格式。");
      return;
    }
    setSubmitting(true);
    await run(async () => {
      const ids = await api.create(urls, options, !chooseChapters);
      setInput("");
      if (chooseChapters) setSelected(ids[0]);
      else {
        if (ids.length > 4) setView("library");
        setNewJobId(ids[0]);
      }
    });
    setSubmitting(false);
  };
  return (
    <div
      className={`app ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes("text/uri-list") ||
          e.dataTransfer.types.includes("text/plain")
        ) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const text =
          e.dataTransfer
            .getData("text/uri-list")
            .split("\n")
            .filter((s) => !s.startsWith("#"))
            .join("\n") || e.dataTransfer.getData("text/plain");
        if (text) {
          setView("save");
          setInput(text);
          inputRef.current?.focus();
        }
      }}
    >
      <header className="topbar">
        <WindowControls state={state} />
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={19} strokeWidth={1.7} />
          </span>
          拾页
        </div>
        <nav className="main-nav" aria-label="主导航">
          <button
            className={view === "save" ? "active" : ""}
            aria-current={view === "save" ? "page" : undefined}
            onClick={() => setView("save")}
          >
            <Plus size={14} />
            保存网页
          </button>
          <button
            className={view === "library" ? "active" : ""}
            aria-current={view === "library" ? "page" : undefined}
            onClick={() => setView("library")}
          >
            <History size={15} />
            已保存
          </button>
        </nav>
        <button
          className="icon-button settings-trigger"
          aria-label="设置"
          onClick={() => {
            setSettingsAI(false);
            setSettingsOpen(true);
          }}
        >
          <Settings2 size={19} />
          <span>设置</span>
        </button>
      </header>
      <main className="workspace">
        {view === "save" ? (
          <div className="save-page workbench">
            <div className="intro">
              <div>
                <h1>保存网页与在线文档</h1>
                <p>粘贴链接，选择格式，保存到电脑后随时阅读。</p>
              </div>
            </div>
            <form className="composer" onSubmit={submit}>
              <div className="input-toolbar">
                <label className="url-label" htmlFor="source-url">
                  <span className="step-number" aria-hidden="true">
                    1
                  </span>
                  粘贴链接
                </label>
                <button
                  type="button"
                  className="paste-button"
                  onClick={() =>
                    run(async () => {
                      const text = await api.clipboardText();
                      if (!text.trim()) {
                        setToast("剪贴板里还没有链接，复制后再试。");
                        return;
                      }
                      setInput(text.trim());
                      setError("");
                      inputRef.current?.focus();
                    })
                  }
                >
                  <ClipboardPaste size={13} />
                  粘贴链接
                </button>
              </div>
              <textarea
                id="source-url"
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError("");
                }}
                spellCheck={false}
                autoComplete="off"
                rows={2}
                placeholder="粘贴网页、飞书文档或教程链接…"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    if (!submitting) e.currentTarget.form?.requestSubmit();
                  }
                }}
                aria-invalid={!!error}
                aria-describedby={error ? "url-error" : undefined}
              />
              <div className="input-caption">
                <span>多个链接，每行一个</span>
                <span className={linkCount > 30 ? "over-limit" : ""}>
                  {linkCount ? `${linkCount} / 30 个链接` : "最多 30 个链接"}
                  {!!input && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setInput("");
                        setError("");
                        inputRef.current?.focus();
                      }}
                    >
                      清空
                    </button>
                  )}
                </span>
              </div>
              <div className="format-line">
                <div className="format-heading">
                  <span className="format-step">
                    <span className="step-number" aria-hidden="true">
                      2
                    </span>
                    选择格式
                  </span>
                  <span className="multi-hint">默认 PDF，也可以多选</span>
                </div>
                <Formats
                  detailed
                  value={options.formats}
                  onChange={(formats) => setOptions({ ...options, formats })}
                />
              </div>
              <details className="save-preferences">
                <summary>
                  <Settings2 size={15} />
                  <strong>保存设置</strong>
                  <span className="preferences-overview">
                    {options.formats.includes("html") &&
                    !options.formats.some((f) => f === "pdf" || f === "docx")
                      ? "网页阅读版"
                      : templateFor(options.template).name}{" "}
                    · AI {options.aiReview ? "已开启" : "关闭"}
                  </span>
                  <ChevronDown size={14} />
                </summary>
                <div className="preferences-content">
                  <div className="save-enhancements">
                    <TemplatePicker
                      value={options.template}
                      onChange={(template) =>
                        setOptions({ ...options, template })
                      }
                    />
                    <AIReviewControl
                      value={options.aiReview}
                      onChange={(aiReview) =>
                        setOptions({ ...options, aiReview })
                      }
                      settings={state.settings}
                      onConfigure={() => {
                        setSettingsAI(true);
                        setSettingsOpen(true);
                      }}
                    />
                  </div>
                  <details className="advanced content-scope">
                    <summary>
                      <span className="scope-icon" aria-hidden="true">
                        <ScanText size={17} />
                      </span>
                      <span className="scope-copy">
                        <strong>内容范围</strong>
                        <small>
                          {chooseChapters
                            ? "保存前选择需要的章节"
                            : options.fromHeading || options.excludeHeadings
                              ? "按指定标题筛选正文"
                              : "保留正文与图片，可按标题筛选"}
                        </small>
                      </span>
                      <span className="scope-value">
                        {options.fromHeading ||
                        options.excludeHeadings ||
                        chooseChapters
                          ? "已自定义"
                          : "全文"}
                      </span>
                      <ChevronDown size={14} />
                    </summary>
                    <div className="advanced-content">
                      <Options value={options} onChange={setOptions} />
                      <label className="check-line">
                        <input
                          type="checkbox"
                          checked={chooseChapters}
                          onChange={(e) => setChooseChapters(e.target.checked)}
                        />
                        先选择章节，再开始保存
                      </label>
                    </div>
                  </details>
                </div>
              </details>
              {error && (
                <p className="inline-error" id="url-error" role="alert">
                  {error}
                </p>
              )}
              <div className="composer-footer">
                <button
                  type="button"
                  className="destination"
                  aria-label={`保存位置 ${state.settings.outputRoot.split(/[\\/]/).filter(Boolean).at(-1)}，点击更改`}
                  title={state.settings.outputRoot}
                  onClick={() =>
                    run(async () => {
                      const p = await api.chooseOutput();
                      if (p) await api.settings({ outputRoot: p });
                    })
                  }
                >
                  <FolderOpen size={16} />
                  <span>
                    <small>保存至</small>
                    <strong>
                      {state.settings.outputRoot
                        .split(/[\\/]/)
                        .filter(Boolean)
                        .at(-1)}
                    </strong>
                  </span>
                  <ChevronRight size={12} />
                </button>
                <button className="primary save-button" disabled={submitting}>
                  {submitting ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <ArrowDownToLine size={16} />
                  )}
                  保存到电脑
                  <kbd aria-hidden="true">{modifier} ↵</kbd>
                </button>
              </div>
            </form>
            {recent.length > 0 ? (
              <section className="recent-section">
                <div className="section-heading">
                  <h2>最近保存</h2>
                  <button
                    className="text-button"
                    onClick={() => setView("library")}
                  >
                    查看全部
                    <ChevronRight size={14} />
                  </button>
                </div>
                <div className="job-list">
                  {recent.map((j) => (
                    <JobRow
                      key={j.id}
                      job={j}
                      run={run}
                      onSelect={() => setSelected(j.id)}
                    />
                  ))}
                </div>
                <TaskShortcuts />
              </section>
            ) : (
              <section className="recent-section recent-empty">
                <div className="section-heading">
                  <h2>最近保存</h2>
                </div>
                <div className="recent-empty-copy">
                  <FileText size={20} strokeWidth={1.5} />
                  <p>还没有保存记录。试试上方粘贴链接，或</p>
                  <button
                    className="demo-link text-button"
                    onClick={() =>
                      run(async () => {
                        const ids = await api.demo();
                        setSelected(ids[0]);
                      })
                    }
                  >
                    保存一份示例
                    <ChevronRight size={13} />
                  </button>
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="library-page">
            <div className="library-heading">
              <div>
                <h1>已保存</h1>
                <p>文章和文档，都在这里。</p>
              </div>
              <button
                className="primary"
                onClick={() => {
                  setView("save");
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
              >
                <Plus size={16} />
                保存新链接
              </button>
            </div>
            <div className="library-toolbar">
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="搜索已保存内容"
                  placeholder="搜索标题或正文…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <span className="muted">{visible.length} 份资料</span>
            </div>
            {visible.length ? (
              <div className="job-list">
                {visible.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    run={run}
                    onSelect={() => setSelected(j.id)}
                  />
                ))}
                <TaskShortcuts />
              </div>
            ) : (
              <div className="empty">
                <FileText size={32} strokeWidth={1.3} />
                <h2>{search ? "没有找到相关内容" : "还没有保存的文章"}</h2>
                <p>
                  {search
                    ? "试试其他标题、来源或关键词。"
                    : "粘贴一个链接，保存你的第一份资料。"}
                </p>
                <button
                  onClick={() => {
                    setSearch("");
                    setView("save");
                  }}
                >
                  去保存网页
                  <ArrowUpRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </main>
      <footer className="app-footer">
        <span>
          <span className="local-dot" />
          本地保存
        </span>
        <span>拾页 {state.version}</span>
      </footer>
      {job && (
        <Modal
          key={job.id}
          title="文章与文件"
          className="job-detail-modal"
          wide
          onClose={() => setSelected("")}
        >
          <JobDetails
            job={job}
            run={run}
            settings={state.settings}
            onConfigure={() => {
              setSettingsAI(true);
              setSettingsOpen(true);
            }}
            onRemoved={() => setSelected("")}
          />
        </Modal>
      )}
      {settingsOpen && (
        <Modal
          title="设置"
          className="settings-modal"
          onClose={() => setSettingsOpen(false)}
        >
          <SettingsForm
            settings={state.settings}
            focusAI={settingsAI}
            run={run}
            onSaved={() => {
              setSettingsOpen(false);
              setToast("设置已保存");
            }}
          />
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <Link2 size={32} />
          <h2>松开，添加链接</h2>
        </div>
      )}
    </div>
  );
}
function JobDetails({
  job: j,
  run,
  onRemoved,
  settings,
  onConfigure,
}: {
  job: Job;
  run: Run;
  onRemoved: () => void;
  settings: Settings;
  onConfigure: () => void;
}) {
  const [tab, setTab] = useState(j.exports.length ? "preview" : "options");
  const [preview, setPreview] = useState<string | null>(null);
  const [options, setOptions] = useState(j.options);
  const [selected, setSelected] = useState(
    j.chapters.filter((c) => c.selected).map((c) => c.id),
  );
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [collection, setCollection] = useState(j.collection);
  const [tags, setTags] = useState(j.tags.join(", "));
  useEffect(() => {
    setSelected(j.chapters.filter((c) => c.selected).map((c) => c.id));
  }, [j.chapters.map((c) => c.id).join(",")]);
  useEffect(() => {
    let cancelled = false;
    if (tab === "preview" && j.previewPath && !busy(j))
      void api
        .preview(j.id)
        .then((url) => {
          if (!cancelled)
            setPreview(
              url ? `${url}?revision=${encodeURIComponent(j.updatedAt)}` : null,
            );
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    return () => {
      cancelled = true;
    };
  }, [tab, j.id, j.previewPath, j.status]);
  const problems = warnings(j).filter(
    (i) => !(j.status === "waiting_login" && i.code === "chapter-capture"),
  );
  const action = (a: Parameters<typeof api.action>[1]) =>
    run(() => api.action(j.id, a));
  const start = async () => {
    if (!options.formats.length || !selected.length) return;
    setSaving(true);
    await run(async () => {
      await api.updateJob(j.id, { selected, options });
      await api.start(j.id, options);
    });
    setSaving(false);
  };
  return (
    <>
      <div className="detail-heading detail-header">
        <h2>{j.title}</h2>
        <div className="detail-meta">
          <button
            className="text-button"
            onClick={() => run(() => api.source(j.id))}
          >
            {host(j.url)}
            <ExternalLink size={12} />
          </button>
          <span>·</span>
          <Status job={j} />
        </div>
      </div>
      <div className="detail-scroll">
        <AccessNotice
          job={j}
          onOpen={() => {
            void run(() => api.login(j.id));
          }}
          onRetry={() => {
            void action("retry");
          }}
        />
        {(j.status !== "ready" || j.exports.length > 0) && (
          <ReviewSummary job={j} />
        )}
        {j.error &&
          j.status !== "waiting_login" &&
          (!j.access || j.access.kind === "available") && (
            <div className="attention error">
              <h3>这次未能完成保存</h3>
              <p>{j.error}</p>
              <button onClick={() => action("retry")}>重新尝试</button>
              <button onClick={() => run(() => api.login(j.id))}>
                打开来源网页
              </button>
            </div>
          )}
        {busy(j) && (
          <div className="progress-notice">
            <Loader2 size={17} className="spin" />
            <div>
              <strong>{phaseNames[j.phase]}</strong>
              <p>你可以继续添加其他链接。</p>
            </div>
            <button onClick={() => action("pause")}>暂停</button>
          </div>
        )}
        {problems.length > 0 && (
          <details className="result-notice">
            <summary>
              {problems.length} 项内容需要留意
              <ChevronDown size={14} />
            </summary>
            <div>
              {problems.map((i) => (
                <p key={i.id}>
                  {i.message}
                  {i.chapterId && (
                    <button
                      className="text-button"
                      onClick={() =>
                        run(() => api.source(j.id, i.chapterId, i.blockId))
                      }
                    >
                      查看原文
                      <ArrowUpRight size={11} />
                    </button>
                  )}
                </p>
              ))}
            </div>
          </details>
        )}
        <div className="tabs" role="tablist" aria-label="文章详情">
          {[
            ["preview", "正文预览"],
            ["files", "文件"],
            ["options", "保存选项"],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "selected" : ""}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="tab-content" role="tabpanel">
          {tab === "preview" &&
            (preview ? (
              <iframe
                key={preview}
                src={preview}
                title={`${j.title} 正文预览`}
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="empty compact">
                <BookOpen size={29} strokeWidth={1.3} />
                <h3>
                  {j.exports.length
                    ? "此来源提供原始文件"
                    : "保存后，即可在这里预览"}
                </h3>
                <p>
                  {j.originalUrl
                    ? "原始 PDF 可在文件中直接打开。"
                    : "正文、图片与排版会一起保留。"}
                </p>
                {j.exports.length > 0 && (
                  <button onClick={() => setTab("files")}>查看文件</button>
                )}
              </div>
            ))}
          {tab === "files" && (
            <>
              {j.exports.length ? (
                <>
                  <div className="file-list">
                    {j.exports
                      .filter((f) => f.format !== "report")
                      .map((f) => (
                        <button
                          className="export-file"
                          key={f.name}
                          onClick={() => run(() => api.open(j.id, f.name))}
                        >
                          <FileText size={23} strokeWidth={1.5} />
                          <span>
                            <strong>{f.name}</strong>
                            <small>
                              {f.format === "docx"
                                ? "Word"
                                : f.format.toUpperCase()}{" "}
                              · {size(f.bytes)}
                              {f.pages ? ` · ${f.pages} 页` : ""}
                            </small>
                          </span>
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                  </div>
                  <p className="small-note">
                    {j.exports.some((f) => f.format === "html") &&
                      "HTML 已内嵌保存的图片，单个文件即可离线打开。"}
                    {j.exports.some((f) => f.format === "md") &&
                      "Markdown 请与图片文件夹一起保留。"}
                    离线资料包已包含所有文件。
                  </p>
                  <button onClick={() => run(() => api.reveal(j.id))}>
                    <FolderOpen size={15} />在 Finder 中查看
                  </button>
                </>
              ) : (
                <div className="empty compact">
                  <ArrowDownToLine size={28} />
                  <h3>文件会出现在这里</h3>
                  <p>保存完成后，直接点击打开。</p>
                </div>
              )}
            </>
          )}
          {tab === "options" && (
            <div
              className={`save-options ${j.chapters.length > 1 ? "has-chapters" : ""}`}
            >
              {j.chapters.length > 1 && (
                <div className="chapter-picker">
                  <div className="section-heading">
                    <h3>
                      选择章节{" "}
                      <span className="muted">
                        {selected.length} / {j.chapters.length}
                      </span>
                    </h3>
                    <button
                      className="text-button"
                      disabled={busy(j)}
                      onClick={() =>
                        setSelected(
                          selected.length === j.chapters.length
                            ? []
                            : j.chapters.map((c) => c.id),
                        )
                      }
                    >
                      {selected.length === j.chapters.length
                        ? "取消全选"
                        : "全选"}
                    </button>
                  </div>
                  <div
                    className="chapter-list"
                    role="group"
                    aria-label="选择要保存的章节"
                  >
                    {j.chapters.map((c) => (
                      <label className="check-line" key={c.id}>
                        <input
                          disabled={busy(j)}
                          type="checkbox"
                          checked={selected.includes(c.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, c.id]
                                : selected.filter((id) => id !== c.id),
                            )
                          }
                        />
                        <span>{chapterTitle(c)}</span>
                      </label>
                    ))}
                  </div>
                  <div className="chapter-picker-note">
                    保留原站顺序与编号，可只保存需要的章节。
                  </div>
                </div>
              )}
              <div className="save-configuration">
                <div className="save-section-heading">
                  <h3>导出设置</h3>
                  {!j.originalUrl && <span>可同时选择多种格式</span>}
                </div>
                <span className="save-field-label">文件格式</span>
                {j.originalUrl ? (
                  <p className="small-note">
                    此来源保存原始 PDF，暂不转换为其他格式。
                  </p>
                ) : (
                  <Formats
                    value={options.formats}
                    onChange={(formats) => setOptions({ ...options, formats })}
                    disabled={busy(j)}
                  />
                )}
                {!j.originalUrl && (
                  <div className="detail-enhancements">
                    <TemplatePicker
                      value={options.template}
                      onChange={(template) =>
                        setOptions({ ...options, template })
                      }
                      disabled={busy(j)}
                    />
                    <AIReviewControl
                      value={options.aiReview}
                      onChange={(aiReview) =>
                        setOptions({ ...options, aiReview })
                      }
                      settings={settings}
                      onConfigure={onConfigure}
                      disabled={busy(j)}
                    />
                  </div>
                )}
                <details className="advanced">
                  <summary>
                    内容范围
                    <ChevronDown size={14} />
                  </summary>
                  <div className="advanced-content">
                    <Options
                      value={options}
                      onChange={setOptions}
                      disabled={busy(j)}
                    />
                  </div>
                </details>
              </div>
            </div>
          )}
        </div>
        <details className="technical">
          <summary>
            归档详情与维护
            <ChevronDown size={14} />
          </summary>
          <div className="technical-content">
            <p className="small-note">
              {j.coverage.layoutScope || "检查结果以归档报告为准。"}
            </p>
            <div className="archive-stats">
              <span>
                <strong>
                  {j.chapters.filter((c) => c.status === "ready").length}
                </strong>
                已保存章节
              </span>
              <span>
                <strong>
                  {
                    j.chapters
                      .flatMap((c) => c.assets)
                      .filter((a) => a.status === "ready").length
                  }
                </strong>
                已保存图片
              </span>
              <span>
                <strong>{j.coverage.calls}</strong>AI 调用
              </span>
            </div>
            <div className="utility-actions">
              {!j.exports.length && (
                <button disabled={busy(j)} onClick={() => action("rediscover")}>
                  重新读取目录
                </button>
              )}
              {!!j.reconciliation &&
                (j.reconciliation.failed.length > 0 ||
                  j.reconciliation.truncated.length > 0) && (
                  <button
                    disabled={busy(j)}
                    onClick={() => action("retry-missing")}
                  >
                    重试未完成章节
                  </button>
                )}
              {j.exports.length > 0 && (
                <button disabled={busy(j)} onClick={() => action("refresh")}>
                  更新网页内容
                </button>
              )}
              {j.chapters.some((c) => c.evidencePath) && (
                <button disabled={busy(j)} onClick={() => action("reexport")}>
                  用已保存内容重新导出
                </button>
              )}
              {j.chapters.some((c) =>
                c.assets.some((a) => a.status === "failed"),
              ) && (
                <button
                  disabled={busy(j)}
                  onClick={() => action("retry-assets")}
                >
                  重试缺失图片
                </button>
              )}
              {(busy(j) || j.status === "paused") && (
                <button onClick={() => action("cancel")}>取消保存</button>
              )}
              <button onClick={() => run(() => api.diagnostic(j.id))}>
                导出诊断包
              </button>
              {j.exports.some((f) => f.format === "report") && (
                <button
                  onClick={() => run(() => api.open(j.id, "归档报告.json"))}
                >
                  归档报告
                </button>
              )}
            </div>
            <div className="form-grid">
              <label className="field">
                集合
                <input
                  disabled={busy(j)}
                  value={collection}
                  onChange={(e) => setCollection(e.target.value)}
                />
              </label>
              <label className="field">
                标签
                <input
                  disabled={busy(j)}
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="用逗号分隔"
                />
              </label>
            </div>
            <button
              disabled={busy(j)}
              onClick={() =>
                run(() =>
                  api.updateJob(j.id, {
                    collection,
                    tags: tags
                      .split(/[,，]/)
                      .map((t) => t.trim())
                      .filter(Boolean),
                  }),
                )
              }
            >
              保存分类
            </button>
            <details className="activity">
              <summary>查看处理记录</summary>
              {[...j.events].reverse().map((ev, i) => (
                <p key={i}>
                  <time>{new Date(ev.at).toLocaleTimeString("zh-CN")}</time>
                  {ev.message}
                </p>
              ))}
            </details>
            {confirmRemove ? (
              <RemovalConfirm
                job={j}
                onDismiss={() => setConfirmRemove(false)}
                onConfirm={async (mode) => {
                  await api.remove(j.id, mode);
                  onRemoved();
                }}
              />
            ) : (
              <button
                className="text-button danger"
                disabled={busy(j)}
                onClick={() => setConfirmRemove(true)}
              >
                从列表移除
              </button>
            )}
          </div>
        </details>
      </div>
      <div className="detail-footer">
        <div className="detail-footer-copy" role="status" aria-live="polite">
          <strong>
            {tab === "options"
              ? `已选 ${selected.length} / ${j.chapters.length} 个章节`
              : `${j.exports.filter((f) => f.format !== "report").length} 个导出文件`}
          </strong>
          <span>
            {tab === "options"
              ? options.formats.length
                ? options.formats.map((f) => formatNames[f]).join(" · ")
                : "请至少选择一种格式"
              : `${date(j.createdAt)} 添加`}
          </span>
        </div>
        <div className="detail-footer-actions">
          {j.exports.length > 0 && (
            <button onClick={() => run(() => api.reveal(j.id))}>
              <FolderOpen size={15} />
              打开文件夹
            </button>
          )}
          {tab === "options" && (
            <button
              className="primary"
              disabled={
                busy(j) || saving || !options.formats.length || !selected.length
              }
              onClick={start}
            >
              <ArrowDownToLine size={15} />
              {saving
                ? "正在提交…"
                : j.exports.length
                  ? "重新保存"
                  : "开始保存"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
function SettingsForm({
  settings: s,
  focusAI = false,
  run,
  onSaved,
}: {
  settings: Settings;
  focusAI?: boolean;
  run: Run;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(s);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [update, setUpdate] = useState("");
  const [testing, setTesting] = useState(false);
  const [connection, setConnection] = useState<{
    ok: boolean;
    message: string;
  }>();
  const [showKey, setShowKey] = useState(false);
  const [section, setSection] = useState<"general" | "ai" | "advanced">(
    focusAI ? "ai" : "general",
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const sections = [
    ["general", "通用", FolderOpen],
    ["ai", "AI 辅助检查", Sparkles],
    ["advanced", "高级", Settings2],
  ] as const;
  useEffect(() => {
    setConnection(undefined);
  }, [draft.modelEndpoint, draft.model, key, clearKey]);
  const set = (k: keyof Settings, v: unknown) => setDraft({ ...draft, [k]: v });
  useEffect(() => {
    setSection(focusAI ? "ai" : "general");
  }, [focusAI]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [section]);
  return (
    <form
      onInvalidCapture={(e) => {
        const input = e.target as HTMLInputElement;
        const panel = input.closest<HTMLElement>(".settings-panel");
        if (panel && panel.dataset.section !== section) {
          e.preventDefault();
          setSection(panel.dataset.section as typeof section);
          requestAnimationFrame(() => {
            input.focus();
            input.reportValidity();
          });
        }
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await run(async () => {
          await api.settings({
            ...draft,
            ...(key || clearKey ? { apiKey: clearKey ? "" : key } : {}),
          });
          onSaved();
        });
        setSaving(false);
      }}
    >
      <div className="settings-layout">
        <div
          className="settings-nav"
          role="tablist"
          aria-label="设置分类"
          aria-orientation="vertical"
        >
          {sections.map(([id, label, Icon], index) => (
            <button
              type="button"
              key={id}
              id={`settings-tab-${id}`}
              role="tab"
              aria-selected={section === id}
              aria-controls={`settings-panel-${id}`}
              tabIndex={section === id ? 0 : -1}
              onClick={() => setSection(id)}
              onKeyDown={(e) => {
                let next = index;
                if (e.key === "ArrowDown") next = (index + 1) % sections.length;
                else if (e.key === "ArrowUp")
                  next = (index + sections.length - 1) % sections.length;
                else if (e.key === "Home") next = 0;
                else if (e.key === "End") next = sections.length - 1;
                else return;
                e.preventDefault();
                setSection(sections[next][0]);
                document
                  .getElementById(`settings-tab-${sections[next][0]}`)
                  ?.focus();
              }}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <div className="settings-scroll" ref={scrollRef}>
          <section
            className="settings-panel"
            data-section="general"
            id="settings-panel-general"
            role="tabpanel"
            aria-labelledby="settings-tab-general"
            hidden={section !== "general"}
          >
            <div className="settings-section-heading">
              <h3>通用</h3>
              <p>设置新文件的默认保存位置。</p>
            </div>
            <label className="field">
              默认保存位置
              <div className="input-button">
                <input
                  name="outputRoot"
                  value={draft.outputRoot}
                  required
                  onChange={(e) => set("outputRoot", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() =>
                    run(async () => {
                      const p = await api.chooseOutput();
                      if (p) set("outputRoot", p);
                    })
                  }
                >
                  <FolderOpen size={16} />
                  更改…
                </button>
              </div>
              <small>已有文件保留在原来的位置。</small>
            </label>
            <div className="storage-note">
              <FolderOpen size={20} />
              <div>
                <strong>离线也能打开</strong>
                <p>文件保存在你的电脑，可直接阅读、编辑或分享。</p>
              </div>
            </div>
          </section>
          <section
            className="settings-panel ai-settings"
            data-section="ai"
            id="settings-panel-ai"
            role="tabpanel"
            aria-labelledby="settings-tab-ai"
            hidden={section !== "ai"}
          >
            <div className="settings-section-heading">
              <div className="settings-section-title">
                <h3>AI 辅助检查</h3>
                <span
                  className={`service-status ${s.hasApiKey && s.model && s.modelEndpoint ? "configured" : ""}`}
                >
                  {s.hasApiKey && s.model && s.modelEndpoint
                    ? "已配置"
                    : "未配置"}
                </span>
              </div>
              <p>连接自己的模型服务，按任务开启，保存后提示问题。</p>
              <div className="ai-capabilities">
                <span>
                  <ScanText size={14} />
                  内容遗漏与重复
                </span>
                <span>
                  <Image size={14} />
                  页面裁切与重叠
                </span>
              </div>
            </div>
            <label className="field">
              服务请求地址
              <input
                type="url"
                name="modelEndpoint"
                autoComplete="off"
                spellCheck={false}
                value={draft.modelEndpoint}
                onChange={(e) => set("modelEndpoint", e.target.value)}
                placeholder="https://api.example.com/v1/chat/completions"
              />
              <small>填写服务商提供的完整聊天补全地址。</small>
            </label>
            <div className="model-fields">
              <label className="field">
                模型名称
                <input
                  name="model"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.model}
                  onChange={(e) => set("model", e.target.value)}
                  placeholder="填写模型 ID"
                />
                <small>检查页面需支持图片的模型。</small>
              </label>
              <label className="field">
                API Key
                <div className="input-button">
                  <input
                    name="apiKey"
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={clearKey}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={
                      s.hasApiKey ? "已安全保存，留空则保留" : "输入服务密钥"
                    }
                  />
                  <button
                    type="button"
                    aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? "隐藏" : "显示"}
                  </button>
                </div>
                <small>使用系统加密保存在本机。</small>
              </label>
            </div>
            {s.hasApiKey && (
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(e) => setClearKey(e.target.checked)}
                />
                清除已保存密钥
              </label>
            )}
            <div className="connection-row">
              <button
                type="button"
                className="test-connection"
                disabled={
                  testing ||
                  !draft.modelEndpoint ||
                  !draft.model ||
                  clearKey ||
                  (!key && !s.hasApiKey)
                }
                onClick={async () => {
                  setTesting(true);
                  setConnection(undefined);
                  try {
                    const response = await api.testModel({
                      modelEndpoint: draft.modelEndpoint,
                      model: draft.model,
                      apiKey: key || undefined,
                      useSavedKey: !clearKey && s.hasApiKey,
                    });
                    setConnection({ ok: true, message: response.message });
                  } catch (e) {
                    setConnection({
                      ok: false,
                      message: String((e as Error).message).replace(
                        /^Error invoking remote method '[^']+': (?:Error: )?/,
                        "",
                      ),
                    });
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                {testing ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Link2 size={14} />
                )}
                {testing ? "正在连接…" : "测试连接"}
              </button>
              <small>会发起一次简短请求，可能产生服务费用。</small>
            </div>
            {connection && (
              <p
                className={`connection-result ${connection.ok ? "success" : "error"}`}
                role="status"
              >
                {connection.message}
              </p>
            )}
            <p className="ai-privacy-caption">
              仅在开启检查时发送正文与页面图片，基础保存无需配置。
            </p>
            <details className="ai-details">
              <summary>
                用量与数据说明
                <ChevronDown size={13} />
              </summary>
              <div>
                <div className="ai-budget">
                  <label className="field">
                    每个任务的调用上限
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={draft.aiMaxCalls}
                      onChange={(e) =>
                        set("aiMaxCalls", Number(e.target.value))
                      }
                    />
                  </label>
                  <p>达到上限后停止 AI 检查，报告会说明尚未检查的范围。</p>
                </div>
                <div className="ai-data-note">
                  <ShieldCheck size={15} />
                  <p>
                    开启后，待检查正文与页面图片会发送到你配置的服务。AI
                    只提示问题，不自动改写正文。
                  </p>
                </div>
              </div>
            </details>
          </section>
          <section
            className="settings-panel"
            data-section="advanced"
            id="settings-panel-advanced"
            role="tabpanel"
            aria-labelledby="settings-tab-advanced"
            hidden={section !== "advanced"}
          >
            <div className="settings-section-heading">
              <h3>高级</h3>
              <p>调整采集用量、更新渠道与网站会话。</p>
            </div>
            <div className="form-grid">
              {(
                [
                  ["pageConcurrency", "同时读取章节", 1, 4],
                  ["assetConcurrency", "同时下载图片", 1, 8],
                  ["maxChapters", "最多发现章节", 1, 200],
                  ["maxScrollSteps", "每章滚动次数上限", 10, 5000],
                ] as const
              ).map(([k, label, min, max]) => (
                <label className="field" key={k}>
                  {label}
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={draft[k]}
                    onChange={(e) => set(k, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
            <label className="field">
              更新渠道
              <input
                type="url"
                value={draft.updateUrl}
                onChange={(e) => set("updateUrl", e.target.value)}
                placeholder="发布后配置 HTTPS 更新目录"
              />
            </label>
            <div className="utility-actions">
              {(["check", "download", "install"] as const).map((action, i) => (
                <button
                  type="button"
                  key={action}
                  disabled={
                    (i === 1 && update !== "available") ||
                    (i === 2 && update !== "downloaded")
                  }
                  onClick={() =>
                    run(async () => {
                      const r = await api.checkUpdates(action);
                      setUpdate(r.status);
                      setMessage(r.message);
                    })
                  }
                >
                  {["检查更新", "下载更新", "重启安装"][i]}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  run(async () => {
                    await api.clearSession();
                    setMessage("网站的登录状态已清除");
                  })
                }
              >
                清除网站登录状态
              </button>
            </div>
            {message && (
              <p className="notice" role="status">
                {message}
              </p>
            )}
          </section>
        </div>
      </div>
      <div className="modal-actions">
        <span>设置仅保存在这台电脑</span>
        <button className="primary" disabled={saving}>
          {saving && <Loader2 size={14} className="spin" />}保存设置
        </button>
      </div>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
