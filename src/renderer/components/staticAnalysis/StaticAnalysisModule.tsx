import { useEffect } from "react";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useStaticAnalysisPoll } from "@/renderer/state/staticAnalysisStore";
import { collapseSidebar } from "@/renderer/state/sidebarOverlayStore";
import { StaticAnalysisDock } from "@/renderer/components/staticAnalysis/StaticAnalysisDock";

/**
 * 静态分析模块（三栏一体，左=任务创建/规则/文件清单，中=问题单，右=代码视图）。
 * 与代码审查一致：面板打开时收起全局左侧边栏；从工作台「项目看板」或场景触发任务后打开。
 */
export function StaticAnalysisModule() {
  const open = usePanelStore((s) => s.staticAnalysisPanelOpen);
  const context = usePanelStore((s) => s.staticAnalysisPanelContext);
  const setOpen = usePanelStore((s) => s.setStaticAnalysisPanelOpen);

  useEffect(() => {
    if (open) collapseSidebar();
  }, [open]);

  useStaticAnalysisPoll(context?.projectId, context?.projectLocation);

  if (!open || !context) return null;

  return (
    <div className="relative z-30 flex min-w-0 flex-1 shrink-0 border-l border-[color:var(--border)] bg-[var(--content-background)]">
      <StaticAnalysisDock
        projectId={context.projectId}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
