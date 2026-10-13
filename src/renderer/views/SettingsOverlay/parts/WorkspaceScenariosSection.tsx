import { Fragment, useState } from "react";
import { Button, Popover, Surface, Tooltip } from "@heroui/react";
import { Check, UserCog } from "lucide-react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { SCENARIO_CATEGORIES, type ScenarioCategory, type Workspace } from "@/shared/contracts";
import {
  DEFAULT_SCENARIO_IDS_BY_CATEGORY,
  SCENARIOS,
  SCENARIO_CATEGORY_LABELS,
  groupScenariosForDisplay,
  scenariosByCategory,
} from "@/renderer/scenarios/catalog";
import {
  setWorkspaceCategory,
  setWorkspaceDefaultScenarios,
} from "@/renderer/actions/workspaceActions";
import { Select } from "@/renderer/components/common";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { WorkspaceEmployeeEditor } from "./WorkspaceEmployeeEditor";

const ALL_SCENARIO_IDS = SCENARIOS.map((scenario) => scenario.id);

/**
 * Per-workspace scenario configuration. A workspace's domain picks the framing,
 * and its default scenarios decide which task entry points its Home view shows.
 * Listing none means "show every scenario" (the pre-existing behavior), which is
 * why the picker's reset action clears the field instead of storing every id.
 */
export function WorkspaceScenariosSection() {
  const { t, i18n } = useLingui();
  const workspaces = useSharedSettings((state) => state.workspaces);
  const [editing, setEditing] = useState<Workspace | null>(null);
  if (workspaces.length === 0) return null;

  const categoryOptions = SCENARIO_CATEGORIES.map((category) => ({
    id: category,
    label: i18n._(SCENARIO_CATEGORY_LABELS[category]),
  }));

  return (
    <>
      <h2 className="mb-2 mt-6 text-sm font-semibold text-foreground">
        <Trans>Employees</Trans>
      </h2>
      <p className="mb-3 text-xs text-muted">
        <Trans>
          Each workspace is an employee (岗位): give it a domain, the scenarios it should surface,
          and its persona / capabilities / default model. A workspace with no scenarios shows every
          scenario.
        </Trans>
      </p>
      <Surface variant="secondary" className="divide-y divide-[var(--hairline)] rounded-xl">
        {workspaces.map((workspace) => (
          <div key={workspace.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {workspace.name}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Tooltip delay={150}>
                <Tooltip.Trigger>
                  <Button
                    variant="ghost"
                    size="sm"
                    isIconOnly
                    aria-label={t`Edit employee`}
                    onPress={() => setEditing(workspace)}
                  >
                    <UserCog className="size-4" />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <Trans>Edit employee</Trans>
                </Tooltip.Content>
              </Tooltip>
              <Select
                aria-label={t`Workspace domain`}
                className="w-[150px]"
                options={categoryOptions}
                value={workspace.category ?? "general"}
                onChange={(value) => {
                  const category = value as ScenarioCategory;
                  setWorkspaceCategory(workspace.id, category);
                  // Picking a domain re-scopes the default scenarios to match, so
                  // choosing "Document writing" clears the code scenarios instead
                  // of leaving the previous selection behind. A domain with no
                  // scenarios of its own (general/test) clears the list, which
                  // means "show every scenario".
                  const scenarioIds = DEFAULT_SCENARIO_IDS_BY_CATEGORY[category];
                  setWorkspaceDefaultScenarios(
                    workspace.id,
                    scenarioIds.length > 0 ? [...scenarioIds] : undefined,
                  );
                }}
              />
              <ScenarioPicker workspace={workspace} />
            </div>
          </div>
        ))}
      </Surface>
      {editing ? (
        <WorkspaceEmployeeEditor
          isOpen
          workspace={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function ScenarioPicker(props: { workspace: Workspace }) {
  const { i18n } = useLingui();
  const [isOpen, setIsOpen] = useState(false);
  const ids = props.workspace.defaultScenarioIds;
  // A stored list can name scenarios the catalog no longer ships (a workspace
  // saved before those entries were removed). Drop them here so the count and
  // checkmarks reflect only ids that still resolve.
  const selected = new Set((ids ?? ALL_SCENARIO_IDS).filter((id) => ALL_SCENARIO_IDS.includes(id)));
  const isAll = ids === undefined || selected.size === ALL_SCENARIO_IDS.length;
  const byCategory = scenariosByCategory();

  const toggle = (scenarioId: string) => {
    const next = new Set(selected);
    if (next.has(scenarioId)) next.delete(scenarioId);
    else next.add(scenarioId);
    const isEverything = ALL_SCENARIO_IDS.every((id) => next.has(id));
    setWorkspaceDefaultScenarios(props.workspace.id, isEverything ? undefined : [...next]);
  };

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger>
        <Button variant="secondary" size="sm" className="min-w-[7rem]">
          {isAll ? (
            <Trans>All scenarios</Trans>
          ) : (
            <Plural value={selected.size} one="# scenario" other="# scenarios" />
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="w-72 p-0">
        <Popover.Dialog className="flex max-h-[inherit] flex-col overflow-hidden !p-0">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs text-muted">
              <Trans>Default scenarios</Trans>
            </span>
            <button
              type="button"
              className="text-xs text-foreground/70 hover:text-foreground"
              onClick={() => setWorkspaceDefaultScenarios(props.workspace.id, undefined)}
            >
              <Trans>Use all</Trans>
            </button>
          </div>
          <div
            role="listbox"
            aria-multiselectable="true"
            className="agentemployee-menu no-scrollbar max-h-80 overflow-y-auto py-1.5"
          >
            {SCENARIO_CATEGORIES.map((category) => {
              const items = byCategory.get(category) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={category}>
                  <p className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.1em] text-muted/70">
                    {i18n._(SCENARIO_CATEGORY_LABELS[category])}
                  </p>
                  {groupScenariosForDisplay(items).map((group) => (
                    <Fragment key={group.key}>
                      {group.label ? (
                        <p className="px-3 pt-1.5 pb-0.5 text-[10px] font-medium tracking-[0.1em] text-muted/50">
                          {i18n._(group.label)}
                        </p>
                      ) : null}
                      {group.scenarios.map((scenario) => {
                        const isOn = selected.has(scenario.id);
                        const handleToggle = () => toggle(scenario.id);
                        return (
                          <div
                            key={scenario.id}
                            role="option"
                            aria-selected={isOn}
                            tabIndex={0}
                            className="agentemployee-menu-item mx-1.5 flex h-7 cursor-default items-center gap-2 px-1.5"
                            onClick={handleToggle}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleToggle();
                              }
                            }}
                          >
                            <Check
                              className={`size-3 shrink-0 transition-opacity ${
                                isOn ? "opacity-100" : "opacity-0"
                              }`}
                            />
                            <span className="min-w-0 truncate text-sm">
                              {i18n._(scenario.title)}
                            </span>
                          </div>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              );
            })}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
