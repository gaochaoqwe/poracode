import {
  Bot,
  FileDiff,
  FileText,
  FolderOpen,
  Gauge,
  Globe,
  LayoutList,
  NotebookPen,
  Puzzle,
  TerminalSquare,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { RightPanelTab } from "@/renderer/state/panelStore";

/** Single source of truth for panel-tab chrome, shared by the toolbar and every dock section. */
export const PANEL_TAB_ICONS: Record<RightPanelTab, LucideIcon> = {
  docks: LayoutList,
  subagent: Bot,
  terminal: TerminalSquare,
  files: FolderOpen,
  git: FileDiff,
  usage: Gauge,
  notes: NotebookPen,
  document: FileText,
  ports: Waypoints,
  browser: Globe,
  // Fallback chrome for the generic `scenario` tab; the active scenario panel
  // overrides the label/icon with its own at render time.
  scenario: Puzzle,
};

export function usePanelTabLabels(): Record<RightPanelTab, string> {
  const { t } = useLingui();
  return {
    docks: t`Docks`,
    subagent: t`Subagent`,
    terminal: t`Terminal`,
    files: t`Files`,
    git: t`Git`,
    usage: t`Usage`,
    notes: t`Notes`,
    document: t`Document`,
    ports: t`Ports`,
    browser: t`Browser`,
    scenario: t`Scenario`,
  };
}
