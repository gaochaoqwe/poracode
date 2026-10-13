import { useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, ExternalLink, X } from "lucide-react";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  useCodeReviewStore,
  useProjectReviewState,
} from "@/renderer/state/codeReviewStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { readBridge } from "@/renderer/bridge";
import { collapseSidebar } from "@/renderer/state/sidebarOverlayStore";
import {
  normalizeReviewFilePath,
  sameFile,
  filterIssuesByTask,
} from "@/renderer/state/codeReviewReport";
import { REVIEW_MODE_LABELS, useReviewMode } from "@/renderer/state/codeReviewMode";
import { highlightCodeForPath, type CodeHighlightLine } from "./codeHighlight";

const WIDTH_KEY = "agentemployee-code-review-codeview-width";
const MIN_WIDTH = 360;
const MAX_WIDTH = 1400;
const DEFAULT_WIDTH = 720;
const LINE_HEIGHT = 24;
/** 「定位」后问题行高亮持续时间（毫秒） */
const FLASH_MS = 3600;

function loadWidth(): number {
  try {
    const raw = Number.parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
    if (Number.isFinite(raw)) return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));
  } catch {
    /* ignore */
  }
  return DEFAULT_WIDTH;
}

/** Absolute / external paths (Windows drive or POSIX `/`) read via external IPC. */
function isExternalPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function getFileName(filePath: string): string {
  const clean = normalizeReviewFilePath(filePath);
  const parts = clean.split("/");
  return parts[parts.length - 1] || clean;
}

interface FileIssueEntry {
  key: string;
  line: number;
}

/**
 * 深色“代码视图”（code-review 配置项场景，作为三栏一体的中间面板）：
 *
 * 绑定 —— 通过 panelStore 的 codeReviewPanelContext（projectId + projectLocation）
 * 与当前项目绑定：文件以项目相对路径经 readProjectFile 读取，绝对路径走
 * readExternalFile。随文件清单（左）选中的 selectedReviewFile 联动加载；随问题
 * 清单（右）“定位”的 focusIssueKey 联动滚动并高亮问题行。
 *
 * 显隐 —— codeReviewStore.codeViewOpen 控制（可在问题清单头部或本面板右上切换，
 * persisted per-session）；仅当代码审查面板打开、当前场景为 code-review 时挂载。
 *
 * 配色 —— 对齐源 requirement_extractor 函数代码视图（VS Code Dark+）：容器
 * #1a1a1a / 行号 #2d2d2d / 文件名 #61dafb / 语法高亮 token 色。问题行**不做
 * 常态标记**，仅在问题单点击「定位」时把目标行闪一下（约数秒后自动消失）。
 */
export function CodeReviewCodeView() {
  const open = usePanelStore((s) => s.codeReviewPanelOpen);
  const context = usePanelStore((s) => s.codeReviewPanelContext);
  const projectId = context?.projectId;
  const activeScenario = useAppStore((s) =>
    projectId ? s.activeScenarioByProject[projectId] : undefined,
  );
  const reviewState = useProjectReviewState(projectId ?? null);
  const mode = useReviewMode(projectId);
  const selectedReviewFile = useCodeReviewStore((s) => s.selectedReviewFile);
  const setSelectedReviewFile = useCodeReviewStore((s) => s.setSelectedReviewFile);
  const selectedReviewTaskId = useCodeReviewStore((s) => s.selectedReviewTaskId);
  const codeViewOpen = useCodeReviewStore((s) => s.codeViewOpen);
  const setCodeViewOpen = useCodeReviewStore((s) => s.setCodeViewOpen);
  const boardTakeover = useCodeReviewStore((s) => s.boardTakeover);
  const focusIssueKey = useCodeReviewStore((s) => s.focusIssueKey);
  const focusNonce = useCodeReviewStore((s) => s.focusNonce);
  const setFocusIssueKey = useCodeReviewStore((s) => s.setFocusIssueKey);

  const [width, setWidth] = useState(loadWidth);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrollInfo, setScrollInfo] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  const codeScrollRef = useRef<HTMLDivElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  const draggingRef = useRef<{
    startX: number;
    startWidth: number;
    handle: HTMLDivElement | null;
  } | null>(null);

  const location = context?.projectLocation;
  const currentFile = selectedReviewFile;

  // 当前文件的相关问题：按行聚合，供行点击聚焦与「定位」高亮使用。
  // 链路 / 功能审查在「功能模块列表」里选中某个任务时，只统计该任务的问题。
  const issueByLine = useMemo(() => {
    const map = new Map<number, FileIssueEntry[]>();
    if (!currentFile) return map;
    for (const issue of filterIssuesByTask(reviewState?.issues ?? [], selectedReviewTaskId)) {
      if (!sameFile(issue.file, currentFile)) continue;
      if (issue.line === null || !Number.isFinite(issue.line) || issue.line <= 0) continue;
      const entry = { key: issue.key, line: issue.line as number };
      const list = map.get(entry.line);
      if (list) list.push(entry);
      else map.set(entry.line, [entry]);
    }
    return map;
  }, [currentFile, reviewState, selectedReviewTaskId]);

  const codeLines: CodeHighlightLine[] = useMemo(() => {
    if (content === null) return [];
    return highlightCodeForPath(content, currentFile ?? "");
  }, [content, currentFile]);

  const isProblemLine = (lineNumber: number): boolean => issueByLine.has(lineNumber);

  // 当前聚焦行由 focusIssueKey 派生（点击问题行 / 问题单“定位”都会写 focusIssueKey）。
  const focusedLine: number | null = useMemo(() => {
    if (!focusIssueKey) return null;
    const issue = filterIssuesByTask(reviewState?.issues ?? [], selectedReviewTaskId).find(
      (i) => i.key === focusIssueKey,
    );
    if (!issue || issue.line === null || !Number.isFinite(issue.line) || issue.line <= 0) return null;
    return issue.line;
  }, [focusIssueKey, reviewState, selectedReviewTaskId]);

  // 「定位」临时高亮：仅跟随 focusIssueKey 指向的行。闪烁由纯 CSS 动画完成（约
  // FLASH_MS 后淡出），并用 focusNonce 作为 key 让重复定位同一问题时能重新闪烁 ——
  // 不做任何常态红色标记。
  const flashLine = focusedLine;
  // 高亮元素的重挂载 key：同一行重复定位也会生成新 key，从而重启动画。
  const flashKey = (lineNumber: number, index: number) =>
    flashLine === lineNumber ? `${index}:${focusNonce}` : String(index);

  // 选中文件变化时加载内容（配置项场景从磁盘读取源码）。
  useEffect(() => {
    if (!open || !projectId || activeScenario !== "code-review" || !currentFile || !location) {
      // eslint-disable-next-line react/set-state-in-effect -- 外部状态（面板/场景/文件）变化时清空旧内容
      setContent(null);
      return;
    }
    let cancelled = false;
    const path = normalizeReviewFilePath(currentFile);
    // eslint-disable-next-line react/set-state-in-effect -- 发起异步读取时同步切换加载态
    setLoading(true);
    // eslint-disable-next-line react/set-state-in-effect -- 发起异步读取时清除上一文件的错误
    setError(null);
    const read = isExternalPath(path)
      ? readBridge()
          .readExternalFile({ projectLocation: location, absolutePath: path })
          .then((r) => (r.status === "ready" ? (r.content ?? "") : null))
      : readBridge()
          .readProjectFile({ projectLocation: location, path })
          .then((r) => (r.status === "ready" ? (r.content ?? "") : null));
    read
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setLoading(false);
        if (text === null) setError("文件不存在或不可读");
      })
      .catch((err) => {
        if (cancelled) return;
        setContent(null);
        setLoading(false);
        setError(String(err?.message ?? err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, activeScenario, currentFile, location]);

  // 「定位」只在**用户真的触发**（`focusNonce` 自增）时处理一次：自动切到该问题所在
  // 文件并记录待滚动行。这里刻意用 ref 记住已处理的 nonce，而不是依赖 `reviewState` /
  // `currentFile` —— 轮询每 3s 刷新一次 reviewState，若让它参与判断，用户刚在左侧树上
  // 切过去的文件会被「拉回」当前聚焦问题所在文件（表现为点击其它文件切不过去）。
  const handledFocusRef = useRef(-1);
  useEffect(() => {
    if (!focusIssueKey) return;
    if (handledFocusRef.current === focusNonce) return;
    const issue = filterIssuesByTask(reviewState?.issues ?? [], selectedReviewTaskId).find(
      (i) => i.key === focusIssueKey,
    );
    if (!issue || issue.line === null || !Number.isFinite(issue.line) || issue.line <= 0) return;
    handledFocusRef.current = focusNonce;
    pendingScrollRef.current = issue.line;
    if (currentFile && !sameFile(issue.file, currentFile)) {
      setSelectedReviewFile(issue.file);
    }
  }, [focusIssueKey, focusNonce, reviewState, currentFile, selectedReviewTaskId, setSelectedReviewFile]);

  // 内容加载完成后：优先滚动到 pendingScrollRef 指定的行；否则每个文件只在首次加载时
  // 滚到首个问题行。仅操作 DOM（scrollTop）与 ref，不触发额外渲染；并用「文件 + 行数」
  // 作为去重键，避免每 3s 轮询都把用户手动滚动的位置拽回去。
  const lastAutoScrollKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (codeLines.length === 0) return;
    const el = codeScrollRef.current;
    if (!el) return;
    if (pendingScrollRef.current !== null) {
      el.scrollTop = Math.max(0, (pendingScrollRef.current - 1) * LINE_HEIGHT - 60);
      pendingScrollRef.current = null;
      lastAutoScrollKeyRef.current = `${currentFile}::${codeLines.length}`;
      return;
    }
    const key = `${currentFile}::${codeLines.length}`;
    if (lastAutoScrollKeyRef.current === key) return;
    lastAutoScrollKeyRef.current = key;
    if (focusedLine !== null) {
      el.scrollTop = Math.max(0, (focusedLine - 1) * LINE_HEIGHT - 60);
    } else if (issueByLine.size > 0) {
      el.scrollTop = Math.max(0, (Math.min(...issueByLine.keys()) - 1) * LINE_HEIGHT - 60);
    }
  }, [codeLines, issueByLine, focusedLine, currentFile]);

  function handleScroll(event: React.UIEvent<HTMLDivElement>): void {
    const el = event.currentTarget;
    setScrollInfo({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
    if (lineNumbersRef.current) {
      lineNumbersRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>): void {
    const el = codeScrollRef.current;
    if (el) el.scrollTop += event.deltaY;
  }

  function focusLineAt(lineNumber: number): void {
    const entries = issueByLine.get(lineNumber);
    const first = entries?.[0];
    if (!first) return;
    setFocusIssueKey(first.key);
  }

  function handleLineKeyDown(event: React.KeyboardEvent, lineNumber: number): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      focusLineAt(lineNumber);
    }
  }

  function openInEditor(): void {
    if (!currentFile) return;
    collapseSidebar();
    const store = useFileEditorStore.getState();
    if (focusedLine !== null && focusedLine > 0) {
      void store.openFile(currentFile, null, false, { lineNumber: focusedLine });
    } else {
      void store.openFile(currentFile);
    }
  }

  if (!open || !projectId || activeScenario !== "code-review" || !codeViewOpen) return null;

  // 「接管」模式（从项目看板进入）：工作台已隐藏，代码视图撑满剩余宽度。
  const takeover = boardTakeover;

  const minimapViewportStyle =
    scrollInfo.scrollHeight && scrollInfo.clientHeight
      ? {
          height: `${(scrollInfo.clientHeight / scrollInfo.scrollHeight) * 100}%`,
          top: `${(scrollInfo.scrollTop / scrollInfo.scrollHeight) * 100}%`,
        }
      : {};

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    draggingRef.current = { startX: event.clientX, startWidth: width, handle };
    handle.setPointerCapture(event.pointerId);
  };

  return (
    <div
      className={`code-review-codeview relative z-30 flex h-full min-h-0 flex-col border-r border-[#3c3c3c] ${
        takeover ? "min-w-0 flex-1" : "shrink-0"
      }`}
      style={takeover ? { minWidth: width } : { width, minWidth: width }}
    >
      {/* 头部 */}
      <div className="cr-cv-header">
        <FileCode2 className="cr-cv-header-icon" />
        {mode ? <span className="cr-cv-mode">{REVIEW_MODE_LABELS[mode]}</span> : null}
        <div className="cr-cv-header-info">
          <span className="cr-cv-filename">
            {currentFile ? getFileName(currentFile) : "代码视图"}
          </span>
          {currentFile ? (
            <span className="cr-cv-path">{normalizeReviewFilePath(currentFile)}</span>
          ) : null}
        </div>
        {issueByLine.size > 0 ? (
          <span className="cr-cv-problems">问题 {issueByLine.size}</span>
        ) : null}
        <div className="cr-cv-header-actions">
          <button type="button" title="在编辑器中打开" aria-label="在编辑器中打开" onClick={openInEditor}>
            <ExternalLink className="size-3.5" />
          </button>
          <button type="button" title="关闭代码视图" aria-label="关闭代码视图" onClick={() => setCodeViewOpen(false)}>
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 主体：行号 + 代码 + 小地图 */}
      <div className="cr-cv-body">
        <div className="cr-cv-gutter" onWheel={handleWheel}>
          <div className="cr-cv-gutter-inner" ref={lineNumbersRef}>
            {codeLines.map((_, index) => {
              const lineNumber = index + 1;
              const isProblem = isProblemLine(lineNumber);
              const isFlash = flashLine === lineNumber;
              return (
                <div
                  key={flashKey(lineNumber, index)}
                  role="button"
                  tabIndex={isProblem ? 0 : -1}
                  className={`cr-cv-lineno${isProblem ? " has-problem" : ""}${isFlash ? " flash" : ""}`}
                  onClick={() => isProblem && focusLineAt(lineNumber)}
                  onKeyDown={(e) => isProblem && handleLineKeyDown(e, lineNumber)}
                >
                  {lineNumber}
                </div>
              );
            })}
          </div>
        </div>

        <div className="cr-cv-scroll" ref={codeScrollRef} onScroll={handleScroll}>
          <pre className="cr-cv-pre">
            <code>
              {codeLines.map((segments, index) => {
                const lineNumber = index + 1;
                const isProblem = isProblemLine(lineNumber);
                const isFlash = flashLine === lineNumber;
                return (
                  <span
                    key={flashKey(lineNumber, index)}
                    role="button"
                    tabIndex={isProblem ? 0 : -1}
                    className={`cr-cv-line${isProblem ? " has-problem" : ""}${isFlash ? " flash" : ""}`}
                    onClick={() => isProblem && focusLineAt(lineNumber)}
                    onKeyDown={(e) => isProblem && handleLineKeyDown(e, lineNumber)}
                  >
                    {segments.length === 0
                      ? " "
                      : segments.map((seg, segIndex) =>
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
        </div>

        {codeLines.length > 50 ? (
          <div className="cr-cv-minimap">
            <div className="cr-cv-minimap-content">
              {codeLines.map((_, index) => {
                const lineNumber = index + 1;
                const isProblem = isProblemLine(lineNumber);
                const isFlash = flashLine === lineNumber;
                const visible =
                  scrollInfo.scrollHeight &&
                  lineNumber * LINE_HEIGHT >= scrollInfo.scrollTop &&
                  (lineNumber - 1) * LINE_HEIGHT <= scrollInfo.scrollTop + scrollInfo.clientHeight;
                return (
                  <div
                    key={flashKey(lineNumber, index)}
                    role="button"
                    tabIndex={isProblem ? 0 : -1}
                    aria-label={`跳转到第 ${lineNumber} 行`}
                    className={`cr-cv-minimap-line${isProblem ? " has-problem" : ""}${isFlash ? " flash" : ""}${visible ? " visible" : ""}`}
                    onClick={() => focusLineAt(lineNumber)}
                    onKeyDown={(e) => handleLineKeyDown(e, lineNumber)}
                  />
                );
              })}
            </div>
            <div className="cr-cv-minimap-viewport" style={minimapViewportStyle} />
          </div>
        ) : null}
      </div>

      {/* 底部状态 */}
      <div className="cr-cv-footer">
        {loading ? (
          <span>加载中…</span>
        ) : error ? (
          <span className="cr-cv-error">{error}</span>
        ) : content === null ? (
          <span>请在左侧文件清单中选择文件</span>
        ) : (
          <span>
            {codeLines.length} 行 · 问题 {issueByLine.size} 条
          </span>
        )}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整代码视图宽度"
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

      {/* 本面板独立的深色配色（对齐源 requirement_extractor 函数代码视图） */}
      <style>{`
        .code-review-codeview { background: #1a1a1a; color: #e0e0e0; font-family: 'Consolas','Monaco','Courier New',monospace; font-size: 14px; line-height: ${LINE_HEIGHT}px; }
        .cr-cv-header { display:flex; align-items:center; gap:10px; padding:0 12px; height:44px; flex-shrink:0; background:#2d2d2d; border-bottom:1px solid #404040; }
        .cr-cv-header-icon { width:16px; height:16px; flex-shrink:0; color:#61dafb; }
        .cr-cv-mode { flex-shrink:0; font-size:11px; font-weight:600; color:#9cdcfe; background:#37373d; border:1px solid #4b4b52; border-radius:4px; padding:1px 6px; }
        .cr-cv-header-info { display:flex; align-items:center; gap:10px; min-width:0; flex:1; }
        .cr-cv-filename { font-size:15px; font-weight:600; color:#61dafb; white-space:nowrap; }
        .cr-cv-path { font-size:12px; color:#666; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cr-cv-problems { flex-shrink:0; font-size:12px; font-weight:600; color:#fff; background:#e74c3c; border-radius:10px; padding:1px 9px; }
        .cr-cv-header-actions { display:flex; align-items:center; gap:4px; flex-shrink:0; }
        .cr-cv-header-actions button { display:flex; align-items:center; justify-content:center; width:26px; height:26px; border:0; border-radius:4px; background:transparent; color:#b0b0b0; cursor:pointer; }
        .cr-cv-header-actions button:hover { background:#3c3c3c; color:#fff; }
        .cr-cv-body { flex:1; min-height:0; display:flex; overflow:hidden; background:#1a1a1a; position:relative; }
        .cr-cv-gutter { flex-shrink:0; width:60px; height:100%; overflow:hidden; background:#2d2d2d; border-right:1px solid #404040; position:relative; }
        .cr-cv-gutter-inner { padding:12px 0; will-change:transform; }
        .cr-cv-lineno { height:${LINE_HEIGHT}px; padding-right:12px; text-align:right; color:#666; user-select:none; font-size:13px; line-height:${LINE_HEIGHT}px; cursor:default; transition:background-color .15s ease,color .15s ease; }
        .cr-cv-lineno:hover { background:#404040; }
        .cr-cv-lineno.has-problem { color:#9aa4b0; cursor:pointer; }
        .cr-cv-lineno.flash { animation:crCvFlashGutter ${FLASH_MS}ms ease-out 1 forwards; }
        @keyframes crCvFlashGutter { 0% { background:#5a4a1a; color:#ffd54f; font-weight:bold; } 100% { background:transparent; color:#9aa4b0; font-weight:normal; } }
        .cr-cv-scroll { flex:1; height:100%; min-width:0; overflow:auto; }
        .cr-cv-pre { margin:0; padding:0; min-height:100%; box-sizing:border-box; color:#e0e0e0; }
        .cr-cv-line { display:block; min-height:${LINE_HEIGHT}px; padding:0 12px; white-space:pre; box-sizing:border-box; cursor:default; transition:background-color .15s ease,border-color .15s ease; }
        .cr-cv-line:hover { background:rgba(255,255,255,0.04); }
        .cr-cv-line.has-problem { cursor:pointer; }
        /* 定位高亮：约 FLASH_MS 内闪烁数次后自动淡出，不残留任何标记。 */
        .cr-cv-line.flash { animation:crCvFlashLine ${FLASH_MS}ms ease-out 1 forwards; }
        @keyframes crCvFlashLine {
          0% { background:rgba(255,213,79,0.34); box-shadow:inset 4px 0 0 #ffd54f; }
          12% { background:rgba(255,213,79,0.08); }
          24% { background:rgba(255,213,79,0.30); }
          36% { background:rgba(255,213,79,0.08); }
          48% { background:rgba(255,213,79,0.26); }
          100% { background:transparent; box-shadow:inset 0 0 0 transparent; }
        }
        .cr-cv-line .keyword { color:#c586c0; font-weight:bold; }
        .cr-cv-line .type { color:#4ec9b0; }
        .cr-cv-line .string { color:#ce9178; }
        .cr-cv-line .comment { color:#6a9955; font-style:italic; }
        .cr-cv-line .number { color:#b5cea8; }
        .cr-cv-line .function { color:#dcdcaa; font-weight:500; }
        .cr-cv-line .preprocessor { color:#9cdcfe; font-weight:500; }
        .cr-cv-minimap { position:absolute; top:0; right:0; width:76px; height:100%; background:#2d2d2d; border-left:1px solid #404040; overflow:hidden; z-index:1; }
        .cr-cv-minimap-content { position:relative; height:100%; width:100%; }
        .cr-cv-minimap-line { height:2px; width:100%; background:#3a3a3a; margin-bottom:1px; cursor:pointer; transition:background-color .15s ease; }
        .cr-cv-minimap-line:hover { background:#555; }
        .cr-cv-minimap-line.has-problem { background:#5a5a5a; }
        .cr-cv-minimap-line.flash { animation:crCvFlashMini ${FLASH_MS}ms ease-out 1 forwards; }
        @keyframes crCvFlashMini { 0% { background:#ffd54f; height:4px; } 100% { background:#5a5a5a; height:2px; } }
        .cr-cv-minimap-line.visible { background:#5a5a5a; }
        .cr-cv-minimap-viewport { position:absolute; left:0; right:0; background:rgba(97,218,251,0.18); border:1px solid #61dafb; pointer-events:none; }
        .cr-cv-footer { flex-shrink:0; height:28px; display:flex; align-items:center; padding:0 12px; font-size:12px; color:#888; background:#2d2d2d; border-top:1px solid #404040; }
        .cr-cv-error { color:#f56c6c; }
        .cr-cv-scroll::-webkit-scrollbar { width:9px; height:9px; }
        .cr-cv-scroll::-webkit-scrollbar-track { background:#2d2d2d; }
        .cr-cv-scroll::-webkit-scrollbar-thumb { background:#555; border-radius:4px; }
        .cr-cv-scroll::-webkit-scrollbar-thumb:hover { background:#777; }
        .cr-cv-scroll::-webkit-scrollbar-corner { background:#2d2d2d; }
      `}</style>
    </div>
  );
}
