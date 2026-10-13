import { useLingui } from "@lingui/react/macro";
import type { ProjectLocation } from "@/shared/contracts";
import {
  useXlsxIssuesScenarioPanelAvailable,
  XLSX_ISSUES_SCENARIO_PANEL,
} from "@/renderer/components/scenarios/xlsxIssuesScenarioPanel";
import type { RegisteredScenarioPanel } from "./scenarioPanelTypes";

/**
 * Resolve the scenario panel (if any) available for a project, for the generic
 * right-panel `scenario` tab. Shared panel hosts call only this; no concrete
 * scenario/panel name appears outside this registry.
 *
 * Hook safety: every registered panel's availability hook is called explicitly,
 * one line each — never through a loop/map — so the number and order of hook
 * calls is constant across renders. To add a panel, add one import, one
 * availability call, and one branch here.
 */
export function useAvailableScenarioPanel(
  projectId: string | undefined,
  projectLocation: ProjectLocation | undefined,
): RegisteredScenarioPanel | null {
  const { i18n } = useLingui();
  const xlsxIssuesAvailable = useXlsxIssuesScenarioPanelAvailable(projectId, projectLocation);

  if (projectId && xlsxIssuesAvailable) {
    return {
      id: XLSX_ISSUES_SCENARIO_PANEL.id,
      label: i18n._(XLSX_ISSUES_SCENARIO_PANEL.label),
      icon: XLSX_ISSUES_SCENARIO_PANEL.icon,
      Component: XLSX_ISSUES_SCENARIO_PANEL.Component,
      projectId,
      ...(projectLocation ? { projectLocation } : {}),
    };
  }

  return null;
}
