import { useState, type ReactNode } from "react";
import { LayoutDashboard, Palette } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkbenchTab } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { OfficeView } from "@/renderer/views/OfficeView/OfficeView";
import { TasksView } from "@/renderer/views/TasksView/TasksView";
import { ProjectBoardPanel } from "./parts/ProjectBoardPanel";
import { FlowDriverStrip } from "./parts/FlowDriverStrip";

function WorkbenchTabButton({
  active,
  onSelect,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={`rounded border px-2 py-0.5 text-xs ${
        active
          ? "border-[var(--foreground)] bg-[var(--surface-hover)] text-foreground"
          : "border-[var(--hairline)] text-muted"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The Workbench — one module hosting the task board, the project board and the
 * office floor behind a single tab strip. The task board leads, the project
 * board and the office floor (with its sub-views) follow. The active tab lives
 * in the view state (`openWorkbench`) rather than local React state, so every
 * entry point (sidebar, floating pet, employee dock, code-review dock) lands on
 * the surface it meant to.
 */
export function WorkbenchView({ tab }: { tab: WorkbenchTab }) {
  const { t } = useLingui();
  const openWorkbench = useAppStore((s) => s.openWorkbench);
  // The office palette is a Workbench-level preference so it survives switching
  // between the task board and the floor.
  const [brutalist, setBrutalist] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-3 py-2">
        <LayoutDashboard className="size-4 shrink-0 text-muted" />
        <span className="shrink-0 text-sm font-medium text-foreground">
          <Trans>Workbench</Trans>
        </span>
        {/* The strip scrolls on its own once the window is too narrow for all
            five tabs, so the title and the palette toggle stay put. */}
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="tablist">
          <WorkbenchTabButton active={tab === "tasks"} onSelect={() => openWorkbench("tasks")}>
            <Trans>Task board</Trans>
          </WorkbenchTabButton>
          <WorkbenchTabButton
            active={tab === "projects"}
            onSelect={() => openWorkbench("projects")}
          >
            <Trans>Project board</Trans>
          </WorkbenchTabButton>
          <WorkbenchTabButton active={tab === "office"} onSelect={() => openWorkbench("office")}>
            <Trans>Office</Trans>
          </WorkbenchTabButton>
          <WorkbenchTabButton active={tab === "flow"} onSelect={() => openWorkbench("flow")}>
            <Trans>Orgflow</Trans>
          </WorkbenchTabButton>
          <WorkbenchTabButton
            active={tab === "approvals"}
            onSelect={() => openWorkbench("approvals")}
          >
            <Trans>Approvals</Trans>
          </WorkbenchTabButton>
        </div>
        {tab === "office" ? (
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            <Trans>Each desk is a digital employee; click a desk to open its thread.</Trans>
          </span>
        ) : null}
        {tab !== "tasks" && tab !== "projects" ? (
          <button
            type="button"
            onClick={() => setBrutalist((value) => !value)}
            aria-pressed={brutalist}
            className="ml-auto flex shrink-0 items-center gap-1 rounded border border-[var(--hairline)] px-2 py-1 text-xs text-muted transition-colors hover:bg-[var(--surface-hover)]"
          >
            <Palette className="size-3.5" />
            {brutalist ? t`Neo-brutalist: on` : t`Neo-brutalist: off`}
          </button>
        ) : null}
      </div>
      {tab === "tasks" ? (
        <TasksView embedded />
      ) : tab === "projects" ? (
        <div className="flex h-full min-h-0 flex-col">
          <FlowDriverStrip />
          <div className="min-h-0 flex-1">
            <ProjectBoardPanel />
          </div>
        </div>
      ) : (
        <OfficeView tab={tab} brutalist={brutalist} />
      )}
    </div>
  );
}
