import React, { useEffect, useRef, useState } from "react";
import { FileText, FolderX, ChevronRight } from "lucide-react";
import type { Job, RemovalMode, RemovalPlan } from "../shared/types";

type Props = {
  job: Job;
  onDismiss: () => void;
  onConfirm: (mode: RemovalMode) => Promise<void>;
  onPendingChange?: (pending: boolean) => void;
};
export function RemovalConfirm({
  job,
  onDismiss,
  onConfirm,
  onPendingChange,
}: Props) {
  const [mode, setMode] = useState<RemovalMode>("record");
  const [plan, setPlan] = useState<RemovalPlan>();
  const [planError, setPlanError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const safeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    safeRef.current?.focus();
    let alive = true;
    window.archive
      .removalPlan(job.id)
      .then((p) => {
        if (alive) setPlan(p);
      })
      .catch((e) => {
        if (alive)
          setPlanError(
            String(e.message).replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              "",
            ),
          );
      });
    return () => {
      alive = false;
    };
  }, [job.id]);
  return (
    <div
      className="row-confirm removal-confirm"
      role="group"
      aria-label="确认移除任务"
      onKeyDown={(e) => {
        if (pending) {
          e.stopPropagation();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
        }
      }}
    >
      <div className="removal-heading">
        <strong>移除这份资料</strong>
        <span>选择记录和文件的处理方式</span>
      </div>
      <div className="removal-choices" role="radiogroup" aria-label="移除方式">
        <label className={mode === "record" ? "selected" : ""}>
          <input
            type="radio"
            name={`removal-${job.id}`}
            checked={mode === "record"}
            disabled={pending}
            onChange={() => setMode("record")}
          />
          <FileText size={17} />
          <span>
            <strong>仅移除记录</strong>
            <small>文件保留在电脑上</small>
          </span>
        </label>
        <label className={mode === "files" ? "selected" : ""}>
          <input
            type="radio"
            name={`removal-${job.id}`}
            checked={mode === "files"}
            disabled={pending || !!planError || !plan}
            onChange={() => setMode("files")}
          />
          <FolderX size={17} />
          <span>
            <strong>记录与磁盘内容</strong>
            <small>导出文件、图片与缓存移入废纸篓</small>
          </span>
        </label>
      </div>
      {mode === "files" && plan && (
        <details className="removal-paths">
          <summary>
            查看文件范围（{plan.directories.length} 个目录）
            <ChevronRight size={13} />
          </summary>
          <div>
            {plan.directories.length ? (
              plan.directories.map((p) => <p key={p}>{p}</p>)
            ) : (
              <p>原目录已不存在，仅移除记录。</p>
            )}
            <small>
              包含目录中的所有文件；你另行复制到其他位置的文件会保留。废纸篓清空前仍占用磁盘空间。
            </small>
          </div>
        </details>
      )}
      {planError && (
        <p className="removal-note">
          文件范围无法安全确认，仍可仅移除记录。{planError}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="removal-footer">
        <span>
          {mode === "files" ? "可在系统废纸篓找回文件" : "电脑上的文件会保留"}
        </span>
        <div className="row-confirm-actions">
          <button ref={safeRef} disabled={pending} onClick={onDismiss}>
            保留<kbd>Esc</kbd>
          </button>
          <button
            className="confirm-action"
            disabled={pending || (mode === "files" && !plan)}
            onClick={async () => {
              setPending(true);
              onPendingChange?.(true);
              setError("");
              try {
                await onConfirm(mode);
              } catch (e) {
                setError(
                  String((e as Error).message).replace(
                    /^Error invoking remote method '[^']+': (?:Error: )?/,
                    "",
                  ),
                );
              } finally {
                setPending(false);
                onPendingChange?.(false);
              }
            }}
          >
            {pending
              ? "正在移除…"
              : mode === "files"
                ? "移除并移入废纸篓"
                : "移除记录"}
          </button>
        </div>
      </div>
    </div>
  );
}
