import { Fragment } from "react";
import { ChevronRight, Code2, FileText, FlaskConical, Sparkles } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ScenarioCategory } from "@/shared/contracts";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import { startScenario } from "@/renderer/actions/scenarioActions";
import { SCENARIOS } from "@/renderer/scenarios/catalog";
import { useCurrentProjectId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { useActiveWorkspaceScenarios } from "@/renderer/state/workspaceSelectors";
import { SidebarScenarioFilter } from "./SidebarScenarioFilter";
import { useSidebarScenarioGroups } from "./useSidebarScenarioGroups";

const SCENARIO_CATEGORY_ICONS: Record<ScenarioCategory, typeof Sparkles> = {
  general: Sparkles,
  docs: FileText,
  code: Code2,
  test: FlaskConical,
};

/**
 * Scenarios for the active workspace, listed under "Skills · Plugins" in the
 * expanded sidebar. Clicking one starts a draft prefilled with the scenario's
 * method (see `startScenario`). Hidden entirely in the collapsed icon rail —
 * `SidebarPrimaryActions` only renders this when `!iconOnly`.
 */
export function SidebarScenarioList() {
  const { i18n } = useLingui();
  const workspaceScenarioIds = useActiveWorkspaceScenarios();
  const currentProjectId = useCurrentProjectId();
  const activeScenarioId = useAppStore((state) =>
    currentProjectId ? state.activeScenarioByProject[currentProjectId] : undefined,
  );

  const visibleScenarios =
    workspaceScenarioIds === undefined
      ? SCENARIOS
      : SCENARIOS.filter((scenario) => workspaceScenarioIds.includes(scenario.id));
  const { groups, showFilter, filterableGroups, filterValue, onChange, toggleCollapsed } =
    useSidebarScenarioGroups(visibleScenarios);

  if (visibleScenarios.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 pt-1">
      {showFilter ? (
        <SidebarScenarioFilter groups={filterableGroups} value={filterValue} onChange={onChange} />
      ) : (
        <div className="px-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
          <Trans>Scenarios</Trans>
        </div>
      )}
      <div className="flex max-h-[45vh] flex-col gap-0.5 overflow-y-auto">
        {groups.map((group) => (
          <Fragment key={group.key}>
            {group.label ? (
              <button
                type="button"
                aria-expanded={!group.collapsed}
                className="flex items-center gap-1 rounded-3xl px-1.5 pt-1.5 pb-0.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted/70 outline-none transition-colors hover:text-foreground focus-visible:focus-ring"
                onClick={() => toggleCollapsed(group.key)}
              >
                <ChevronRight
                  className={`size-3 shrink-0 transition-transform ${
                    group.collapsed ? "" : "rotate-90"
                  }`}
                />
                <span className="min-w-0 truncate">{i18n._(group.label)}</span>
              </button>
            ) : null}
            {group.label === null || !group.collapsed
              ? group.scenarios.map((scenario) => {
                  const Icon = SCENARIO_CATEGORY_ICONS[scenario.category];
                  return (
                    <SidebarButton
                      key={scenario.id}
                      icon={<Icon aria-hidden className="size-4" />}
                      label={i18n._(scenario.title)}
                      isActive={scenario.id === activeScenarioId}
                      onPress={() => startScenario(scenario, currentProjectId)}
                    />
                  );
                })
              : null}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
