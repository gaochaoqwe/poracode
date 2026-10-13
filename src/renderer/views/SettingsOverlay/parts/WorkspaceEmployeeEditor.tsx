import { useState } from "react";
import { Label, Modal, TextArea, TextField } from "@heroui/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  SCENARIO_CATEGORIES,
  type ScenarioCategory,
  baseAgentKind,
  type Workspace,
} from "@/shared/contracts";
import {
  DEFAULT_SCENARIO_IDS_BY_CATEGORY,
  SCENARIO_CATEGORY_LABELS,
} from "@/renderer/scenarios/catalog";
import { Button, Select, ToggleSwitch } from "@/renderer/components/common";
import { updateWorkspaceProfile } from "@/renderer/actions/workspaceActions";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ResponsibilityList, TagInput } from "./WorkspaceRoleFields";
import { WorkspaceCapabilitiesEditor } from "./WorkspaceCapabilitiesEditor";

/**
 * Employee (岗位) editor. A workspace is an employee role: it owns a persona,
 * a list of responsibilities, skill ids and capability tags, a default provider
 * with a default agent instance and model, and job-level permission toggles.
 * Saving patches the workspace via `updateWorkspaceProfile` in one persist
 * write. Everything is data-bound: no branch on a provider name.
 */
export function WorkspaceEmployeeEditor(props: {
  isOpen: boolean;
  workspace: Workspace;
  onClose: () => void;
}) {
  const { t, i18n } = useLingui();
  const { isOpen, workspace, onClose } = props;

  // Local edit state, reset whenever a new workspace is opened.
  const [persona, setPersona] = useState(workspace.persona ?? "");
  const [responsibilities, setResponsibilities] = useState<string[]>(
    workspace.responsibilities ?? [],
  );
  const [skillIds, setSkillIds] = useState<string[]>(workspace.skillIds ?? []);
  const [capabilityTags, setCapabilityTags] = useState<string[]>(workspace.capabilityTags ?? []);
  const [agentKind, setAgentKind] = useState(workspace.agentKind ?? "");
  const [agentInstanceId, setAgentInstanceId] = useState(workspace.agentInstanceId ?? "");
  const [model, setModel] = useState(workspace.defaultThreadConfig?.model ?? "");
  const [allowComputerUse, setAllowComputerUse] = useState(
    workspace.permissions?.allowComputerUse === true,
  );
  const [requireApproval, setRequireApproval] = useState(
    workspace.permissions?.requireApproval === true,
  );
  const [workspacePaths, setWorkspacePaths] = useState<string[]>(
    workspace.permissions?.workspacePaths ?? [],
  );
  const [capabilityIds, setCapabilityIds] = useState<string[]>(workspace.capabilityIds ?? []);
  // Default is visible; a persisted `hiddenInNav: true` means the toggle is off.
  const [showInNav, setShowInNav] = useState(workspace.hiddenInNav !== true);
  const [category, setCategory] = useState<ScenarioCategory | undefined>(workspace.category);
  const [defaultScenarioIds, setDefaultScenarioIds] = useState<string[]>(
    workspace.defaultScenarioIds ?? [],
  );

  const [prevKey, setPrevKey] = useState({ open: isOpen, id: workspace.id });
  if (prevKey.open !== isOpen || prevKey.id !== workspace.id) {
    setPrevKey({ open: isOpen, id: workspace.id });
    if (isOpen) {
      setPersona(workspace.persona ?? "");
      setResponsibilities(workspace.responsibilities ?? []);
      setSkillIds(workspace.skillIds ?? []);
      setCapabilityTags(workspace.capabilityTags ?? []);
      setAgentKind(workspace.agentKind ?? "");
      setAgentInstanceId(workspace.agentInstanceId ?? "");
      setModel(workspace.defaultThreadConfig?.model ?? "");
      setAllowComputerUse(workspace.permissions?.allowComputerUse === true);
      setRequireApproval(workspace.permissions?.requireApproval === true);
      setWorkspacePaths(workspace.permissions?.workspacePaths ?? []);
      setCapabilityIds(workspace.capabilityIds ?? []);
      setShowInNav(workspace.hiddenInNav !== true);
      setCategory(workspace.category);
      setDefaultScenarioIds(workspace.defaultScenarioIds ?? []);
    }
  }

  // Provider list and per-provider model surface come from the discovered
  // agent statuses; agent instances (auth profiles) live in shared settings.
  const agents = useAgentStatusesStore((state) => state.agentStatuses);
  const agentInstances = useSharedSettings((state) => state.agentInstances);

  const providerOptions = agents.map((agent) => ({ id: agent.kind, label: agent.label }));
  const selectedAgent = agents.find((agent) => agent.kind === agentKind);
  const modelOptions = (selectedAgent?.capabilities.models ?? []).map((entry) => ({
    id: entry.id,
    label: entry.label,
  }));
  // Instances belong to a provider by their driver, matched against the base
  // kind so instance-scoped kinds ("gdsAgent:work") still resolve their base.
  const baseKind = baseAgentKind(agentKind);
  const instanceOptions = Object.values(agentInstances)
    .filter((instance) => instance.driver === baseKind)
    .map((instance) => ({ id: instance.id, label: instance.displayName ?? instance.id }));

  // Switching provider changes both the model surface and the instance set, so
  // drop the stale picks rather than persist dangling references.
  const handleProviderChange = (kind: string) => {
    setAgentKind(kind);
    setAgentInstanceId("");
    setModel("");
  };

  function save() {
    const modelValue = model.trim();
    updateWorkspaceProfile(workspace.id, {
      persona: persona.trim() || undefined,
      responsibilities: responsibilities.map((item) => item.trim()).filter(Boolean),
      skillIds: [...skillIds],
      capabilityTags: [...capabilityTags],
      agentKind: agentKind || undefined,
      agentInstanceId: agentInstanceId || undefined,
      // Empty list means no configured capabilities; omit the key.
      ...(capabilityIds.length > 0 ? { capabilityIds: [...capabilityIds] } : {}),
      // Visible is the default: omit the key, only persist when hidden.
      hiddenInNav: showInNav ? undefined : true,
      // Preserve any other default-config fields; only the model is edited here.
      defaultThreadConfig: modelValue
        ? { ...(workspace.defaultThreadConfig ?? {}), model: modelValue }
        : undefined,
      permissions: {
        allowComputerUse,
        requireApproval,
        // An empty list means no explicit directory scope is declared; omit the
        // key rather than persist an empty array.
        ...(workspacePaths.length > 0 ? { workspacePaths } : {}),
      },
      // Domain + default scenarios, cleared when unset. Scenarios are omitted
      // when empty, meaning "show every scenario".
      ...(category ? { category } : {}),
      ...(defaultScenarioIds.length > 0 ? { defaultScenarioIds: [...defaultScenarioIds] } : {}),
    });
    onClose();
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[560px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              <Trans>Edit employee</Trans> — {workspace.name}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="max-h-[70vh] overflow-y-auto px-5 pb-5 pt-2">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>
                  <Trans>Task domain</Trans>
                </Label>
                <Select
                  aria-label={t`Task domain`}
                  className="w-full"
                  options={SCENARIO_CATEGORIES.map((c) => ({
                    id: c,
                    label: i18n._(SCENARIO_CATEGORY_LABELS[c]),
                  }))}
                  value={category ?? "general"}
                  onChange={(value) => {
                    const next = value as ScenarioCategory;
                    setCategory(next);
                    // Picking a domain re-scopes default scenarios to match.
                    const scenarioIds = DEFAULT_SCENARIO_IDS_BY_CATEGORY[next];
                    setDefaultScenarioIds(scenarioIds.length > 0 ? [...scenarioIds] : []);
                  }}
                />
                <p className="text-xs text-muted">
                  {defaultScenarioIds.length === 0 ? (
                    <Trans>Shows every scenario</Trans>
                  ) : (
                    <Plural
                      value={defaultScenarioIds.length}
                      one="# default scenario"
                      other="# default scenarios"
                    />
                  )}
                </p>
              </div>

              <TextField value={persona} onChange={setPersona}>
                <Label>
                  <Trans>Persona</Trans>
                </Label>
                <TextArea
                  placeholder={t`Describe the employee's role framing, e.g. "I am the document writer…"`}
                  rows={3}
                />
              </TextField>

              <div className="space-y-1.5">
                <Label>
                  <Trans>Responsibilities</Trans>
                </Label>
                <ResponsibilityList
                  items={responsibilities}
                  onChange={setResponsibilities}
                  ariaLabel={t`Responsibility`}
                  placeholder={t`e.g. Draft requirements docs`}
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  <Trans>Skills</Trans>
                </Label>
                <TagInput
                  chips={skillIds}
                  onChange={setSkillIds}
                  ariaLabel={t`Skill`}
                  placeholder={t`Type a skill id and press Enter`}
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  <Trans>Capability tags</Trans>
                </Label>
                <TagInput
                  chips={capabilityTags}
                  onChange={setCapabilityTags}
                  ariaLabel={t`Capability tag`}
                  placeholder={t`Type a tag and press Enter`}
                />
              </div>

              <div className="space-y-2">
                <Select
                  aria-label={t`Provider`}
                  className="w-full"
                  options={providerOptions}
                  value={agentKind}
                  onChange={handleProviderChange}
                />
                <div className="flex gap-2">
                  <Select
                    aria-label={t`Agent instance`}
                    className="w-full"
                    placeholder={t`Agent instance`}
                    options={instanceOptions}
                    value={agentInstanceId}
                    onChange={setAgentInstanceId}
                  />
                  <Select
                    aria-label={t`Default model`}
                    className="w-full"
                    placeholder={t`Default model`}
                    options={modelOptions}
                    value={model}
                    onChange={setModel}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border p-3">
                <ToggleSwitch
                  isSelected={allowComputerUse}
                  onChange={(next) => setAllowComputerUse(next)}
                >
                  <Trans>Allow computer use</Trans>
                </ToggleSwitch>
                <ToggleSwitch
                  isSelected={requireApproval}
                  onChange={(next) => setRequireApproval(next)}
                >
                  <Trans>Require approval</Trans>
                </ToggleSwitch>
                <ToggleSwitch isSelected={showInNav} onChange={(next) => setShowInNav(next)}>
                  <Trans>Show in navigation</Trans>
                </ToggleSwitch>
                <div className="space-y-1.5 border-t border-border pt-3">
                  <Label>
                    <Trans>Authorized workspace directories</Trans>
                  </Label>
                  <p className="text-xs text-muted">
                    <Trans>
                      Authorized workspace directories the employee may operate in; empty means no
                      explicit scope.
                    </Trans>
                  </p>
                  <TagInput
                    chips={workspacePaths}
                    onChange={setWorkspacePaths}
                    ariaLabel={t`Workspace directory`}
                    placeholder={t`Type a directory path and press Enter`}
                  />
                </div>
              </div>

              <div className="space-y-1.5 rounded-lg border border-border p-3">
                <Label>
                  <Trans>Capabilities</Trans>
                </Label>
                <p className="text-xs text-muted">
                  <Trans>
                    Solid dots are implemented today; hollow dots are catalogued but not yet
                    available. Add unknown ids below as custom capability ids.
                  </Trans>
                </p>
                <WorkspaceCapabilitiesEditor selected={capabilityIds} onChange={setCapabilityIds} />
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="ghost" className="text-muted" onPress={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button variant="primary" onPress={save}>
              <Trans>Save</Trans>
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
