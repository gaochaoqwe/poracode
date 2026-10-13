import { useEffect, useMemo, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { Code2, ExternalLink, FileDiff } from "lucide-react";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  useCodeReviewStore,
  useProjectReviewState,
} from "@/renderer/state/codeReviewStore";
import type { RegressionDiffReport, RegressionFileStatus } from "@/renderer/state/codeReviewReport";
import { getLanguageFromPath } from "@/renderer/views/FileEditorOverlay/parts/FileEditorPane/parts/langMap";
import {
  defineAppThemes,
  useResolvedTheme,
} from "@/renderer/views/FileEditorOverlay/parts/FileEditorPane/parts/monacoThemes";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { collapseSidebar } from "@/renderer/state/sidebarOverlayStore";
import {
  highlightCodeForPath,
  type CodeHighlightLine,
} from "./codeHighlight";

const WIDTH_KEY = "agentemployee-code-review-regression-width";
const MIN_WIDTH = 420;
const MAX_WIDTH = 1080;
const DEFAULT_WIDTH = 640;

function loadWidth(): number {
  try {
    const raw = Number.parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
    if (Number.isFinite(raw)) return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));
  } catch {
    /* ignore */
  }
  return DEFAULT_WIDTH;
}

const STATUS_BADGE_CLASS: Record<RegressionFileStatus, string> = {
  added: "bg-success-500/15 text-success-500",
  deleted: "bg-danger-500/15 text-danger-500",
  modified: "bg-warning-500/15 text-warning-600",
};

const STATUS_LABEL: Record<RegressionFileStatus, string> = {
  added: "新增",
  deleted: "删除",
  modified: "修改",
};

const DIFF_OPTIONS: MonacoEditor.IStandaloneDiffEditorConstructionOptions = {
  fontSize: 13,
  lineHeight: 20,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: "on",
  automaticLayout: true,
  padding: { top: 4, bottom: 4 },
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    verticalSliderSize: 8,
    horizontalSliderSize: 8,
  },
};

/**
 * 最新报告：updatedAt 降序（无效日期按 0），同分取数组最后一项；
 * 全部缺失 updatedAt 时自然落到最后一项。
 */
function pickLatestReport(
  reports: readonly RegressionDiffReport[],
): RegressionDiffReport | null {
  if (reports.length === 0) return null;
  let bestIndex = reports.length - 1;
  let bestScore = -1;
  for (let i = 0; i < reports.length; i++) {
    const updatedAt = reports[i]?.updatedAt;
    const time = updatedAt ? new Date(updatedAt).getTime() : 0;
    const score = Number.isFinite(time) ? time : 0;
    if (score >= bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return reports[bestIndex] ?? null;
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted">
      {text}
    </div>
  );
}

const SNAPSHOT_LINE_HEIGHT = 20;

/**
 * 深色源码快照：对变更文件的变更后源码（right；删除文件回退到 left）做逐行高亮，
 * 复用自研 codeHighlight tokenizer，配色对齐配置项场景的 CodeView（VS Code Dark+）。
 */
function SourceSnapshot({ text, path }: { text: string; path: string }) {
  const codeLines: CodeHighlightLine[] = useMemo(
    () => highlightCodeForPath(text, path),
    [text, path],
  );
  const content = codeLines.length === 0 ? text.split("\n") : codeLines;
  return (
    <div
      className="h-full overflow-auto bg-[#1e1e1e]"
      style={{ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", fontSize: 13 }}
    >
      <pre className="min-h-full box-border m-0 p-0" style={{ color: "#e0e0e0" }}>
        <code>
          {content.map((line, index) => {
            const segs = Array.isArray(line) ? line : [{ text: line, cls: "plain" }];
            const isEmpty = segs.length === 0;
            return (
              <span
                key={index}
                className="cr-rv-line block whitespace-pre box-border"
                style={{ minHeight: SNAPSHOT_LINE_HEIGHT, padding: "0 12px" }}
              >
                {isEmpty
                  ? " "
                  : segs.map((seg, segIndex) =>
                      seg.cls === "plain" ? (
                        <span key={segIndex}>{seg.text}</span>
                      ) : (
                        <span key={segIndex} className={seg.cls}>
                          {seg.text}
                        </span>
                      ),
                    )}
              </span>
            );
          })}
        </code>
      </pre>
      <style>
        {`
          .cr-rv-line:hover { background: rgba(255,255,255,0.04); }
          .cr-rv-line .keyword { color: #c586c0; font-weight: bold; }
          .cr-rv-line .type { color: #4ec9b0; }
          .cr-rv-line .string { color: #ce9178; }
          .cr-rv-line .comment { color: #6a9955; font-style: italic; }
          .cr-rv-line .number { color: #b5cea8; }
          .cr-rv-line .function { color: #dcdcaa; font-weight: 500; }
          .cr-rv-line .preprocessor { color: #9cdcfe; font-weight: 500; }
        `}
      </style>
    </div>
  );
}

/**
 * 回归审查（code-review-regression）场景的差异视图，作为“三栏一体”审查界面的
 * 中间面板：左为文件清单（共享 CodeReviewFileTree 的变更文件列表），中为本
 * Monaco DiffEditor（左基线 / 右变更），右为问题清单。选中文件由 store 的
 * selectedReviewFile 驱动；宽度可拖拽并持久化。
 */
export function CodeReviewRegressionView() {
  const open = usePanelStore((s) => s.codeReviewPanelOpen);
  const context = usePanelStore((s) => s.codeReviewPanelContext);
  const projectId = context?.projectId;
  const activeScenario = useAppStore((s) =>
    projectId ? s.activeScenarioByProject[projectId] : undefined,
  );
  const reviewState = useProjectReviewState(projectId ?? null);
  const selectedReviewFile = useCodeReviewStore((s) => s.selectedReviewFile);
  const setSelectedReviewFile = useCodeReviewStore((s) => s.setSelectedReviewFile);
  const theme = useResolvedTheme();
  const [width, setWidth] = useState(loadWidth);
  const [viewMode, setViewMode] = useState<"diff" | "snapshot">("diff");
  const draggingRef = useRef<{
    startX: number;
    startWidth: number;
    handle: HTMLDivElement | null;
  } | null>(null);

  const diffReports = reviewState?.diffReports ?? [];
  const latestReport = pickLatestReport(diffReports);
  const changedFiles = latestReport?.changedFiles ?? [];
  const reportKey = latestReport
    ? `${latestReport.taskId}\n${latestReport.fileName}\n${latestReport.updatedAt ?? ""}\n${changedFiles
        .map((file) => file.path)
        .join("\n")}`
    : "";

  const [trackedKey, setTrackedKey] = useState<string>(reportKey);
  // 最新报告变化时：当前选中文件仍在新报告里则保留，否则重置为首个变更文件。
  if (trackedKey !== reportKey) {
    setTrackedKey(reportKey);
    const stillPresent =
      selectedReviewFile !== null && changedFiles.some((file) => file.path === selectedReviewFile);
    const next = stillPresent ? selectedReviewFile : (changedFiles[0]?.path ?? null);
    setSelectedReviewFile(next);
  }
  // 面板关闭时清除联动选择，避免残留过滤状态污染问题清单。
  useEffect(() => {
    if (!open) setSelectedReviewFile(null);
  }, [open, setSelectedReviewFile]);

  if (!open || !projectId || activeScenario !== "code-review-regression") return null;

  // 选中文件由文件清单（左）驱动；未选中时回退到首个变更文件。
  const currentFile =
    changedFiles.find((file) => file.path === selectedReviewFile) ?? changedFiles[0] ?? null;
  const monacoTheme = theme === "dark" ? "agentemployee-dark" : "agentemployee-light";

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    draggingRef.current = { startX: event.clientX, startWidth: width, handle };
    handle.setPointerCapture(event.pointerId);
  };

  const openInEditor = () => {
    if (!currentFile) return;
    collapseSidebar();
    const store = useFileEditorStore.getState();
    if (currentFile.right !== null) {
      void store.openFile(currentFile.path, null, false, { lineNumber: 1 });
    } else {
      void store.openFile(currentFile.path);
    }
  };

  return (
    <div
      className="relative z-30 flex h-full min-h-0 shrink-0 flex-col border-r border-[color:var(--border)] bg-[var(--content-background)]"
      style={{ width, minWidth: width }}
    >
      {/* 头部：当前文件路径 + 状态徽标 + 差异/快照切换 + 打开编辑器 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[color:var(--border)] px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {currentFile?.path ?? "差异视图"}
        </span>
        {currentFile ? (
          <span
            className={`shrink-0 rounded px-1 text-[0.8em] ${STATUS_BADGE_CLASS[currentFile.status]}`}
          >
            {STATUS_LABEL[currentFile.status]}
          </span>
        ) : null}
        <button
          type="button"
          title="差异对比"
          aria-label="差异对比"
          onClick={() => setViewMode("diff")}
          className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
            viewMode === "diff"
              ? "bg-foreground/10 text-foreground"
              : "text-muted hover:bg-foreground/5 hover:text-foreground"
          }`}
        >
          <FileDiff className="size-3.5" />
        </button>
        <button
          type="button"
          title="源码快照"
          aria-label="源码快照"
          onClick={() => setViewMode("snapshot")}
          className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
            viewMode === "snapshot"
              ? "bg-foreground/10 text-foreground"
              : "text-muted hover:bg-foreground/5 hover:text-foreground"
          }`}
        >
          <Code2 className="size-3.5" />
        </button>
        <button
          type="button"
          title="打开变更后源码到编辑器"
          aria-label="打开变更后源码到编辑器"
          disabled={!currentFile}
          onClick={openInEditor}
          className={`flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40`}
        >
          <ExternalLink className="size-3.5" />
        </button>
      </div>
      {viewMode === "diff" ? (
        <div className="flex shrink-0 border-b border-[color:var(--border)] text-[0.8em] text-muted">
          <div className="min-w-0 flex-1 px-3 py-0.5">基线</div>
          <div className="min-w-0 flex-1 px-3 py-0.5">变更</div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {diffReports.length === 0 ? (
          <EmptyHint text="等待回归审查生成变更差异…" />
        ) : changedFiles.length === 0 ? (
          <EmptyHint text="未发现变更文件" />
        ) : !currentFile ? (
          <EmptyHint text="选择左侧文件查看差异" />
        ) : viewMode === "snapshot" ? (
          <SourceSnapshot text={currentFile.right ?? currentFile.left ?? ""} path={currentFile.path} />
        ) : (
          <DiffEditor
            original={currentFile.left ?? ""}
            modified={currentFile.right ?? ""}
            language={getLanguageFromPath(currentFile.path)}
            theme={monacoTheme}
            beforeMount={(monaco) => defineAppThemes(monaco)}
            options={DIFF_OPTIONS}
            loading={
              <div className="flex h-full items-center justify-center text-xs text-muted">
                加载编辑器…
              </div>
            }
          />
        )}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整回归差异面板宽度"
        className="agentemployee-review-resize-handle absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/60"
        onPointerDown={startDrag}
        onPointerMove={(event) => {
          const drag = draggingRef.current;
          if (!drag || !drag.handle) return;
          const delta = event.clientX - drag.startX;
          const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, drag.startWidth + delta));
          setWidth(next);
          try {
            localStorage.setItem(WIDTH_KEY, String(Math.round(next)));
          } catch {
            /* ignore */
          }
        }}
        onPointerUp={() => {
          draggingRef.current = null;
        }}
      />
    </div>
  );
}
