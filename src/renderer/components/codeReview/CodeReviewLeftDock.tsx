import { useEffect, useRef, useState } from "react";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useCodeReviewPoll, useCodeReviewStore } from "@/renderer/state/codeReviewStore";
import { collapseSidebar } from "@/renderer/state/sidebarOverlayStore";
import { CodeReviewDock } from "@/renderer/components/codeReview/CodeReviewDock";

const WIDTH_KEY = "agentemployee-code-review-dock-width";
const MIN_WIDTH = 260;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 340;

function loadWidth(): number {
  try {
    const raw = Number.parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
    if (Number.isFinite(raw)) return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));
  } catch {
    /* ignore */
  }
  return DEFAULT_WIDTH;
}

/**
 * 代码审查的问题清单面板（docked，渲染在代码视图右侧）。与文件清单（左）、
 * 代码视图（中）一起构成“三栏一体”的审查界面（对齐原 requirement_extractor：
 * 左树 / 中源码 / 右问题单）。可拖拽调整宽度并持久化；渲染时自动收起全局
 * 左侧边栏，让审查三栏成为主导界面。
 */
export function CodeReviewLeftDock() {
  const open = usePanelStore((s) => s.codeReviewPanelOpen);
  const context = usePanelStore((s) => s.codeReviewPanelContext);
  const setOpen = usePanelStore((s) => s.setCodeReviewPanelOpen);
  const [width, setWidth] = useState(loadWidth);
  const draggingRef = useRef<{
    startX: number;
    startWidth: number;
    handle: HTMLDivElement | null;
  } | null>(null);

  // 审查面板显示时收起全局左侧边栏，让审查三栏成为主导界面。
  useEffect(() => {
    if (open) collapseSidebar();
  }, [open]);

  useCodeReviewPoll(context?.projectId, context?.projectLocation);

  if (!open || !context) return null;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    draggingRef.current = { startX: event.clientX, startWidth: width, handle };
    handle.setPointerCapture(event.pointerId);
  };

  return (
    <div
      className="relative z-30 flex shrink-0 border-l border-[color:var(--border)] bg-[var(--content-background)]"
      style={{ width, minWidth: width }}
    >
      <CodeReviewDock
        projectId={context.projectId}
        projectName={context.projectName || context.projectId}
        {...(context.projectLocation ? { projectLocation: context.projectLocation } : {})}
        onClose={() => {
          // 关闭审查面板时同步退出「接管」模式，让工作台回到主区。
          useCodeReviewStore.getState().setBoardTakeover(false);
          setOpen(false);
        }}
      />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整审查面板宽度"
        className="agentemployee-review-resize-handle absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/60"
        onPointerDown={startDrag}
        onPointerMove={(event) => {
          const drag = draggingRef.current;
          if (!drag || !drag.handle) return;
          const delta = event.clientX - drag.startX;
          // 右侧面板：左缘向左拖（delta 为负）时面板变宽，故用 startWidth - delta。
          const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, drag.startWidth - delta));
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
