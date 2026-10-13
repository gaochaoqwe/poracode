import type { Project, ProjectLocation, ResolvedDocumentTemplate, ThreadConfig } from "@/shared/contracts";
import { msg } from "@lingui/core/macro";
import type { ScenarioView } from "@/renderer/scenarios/catalog";
import { i18n } from "@/renderer/i18n/i18n";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { getActiveWorkspaceId } from "@/renderer/state/workspaceStore";
import { buildRoleContextBlock } from "@/renderer/state/roleMemory";
import { openNewThread, resolveNewThreadProjectId } from "./threadActions";

/** Number the localized steps so the agent reads them as an ordered method. */
function formatSteps(steps: readonly string[]): string {
  return steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
}

/** Absolute directory the agent runs in for a project — its project root. */
function projectRootPath(location: ProjectLocation): string {
  return location.kind === "wsl" ? location.linuxPath : location.path;
}

/** Path separator for a project location — Windows uses `\`, WSL/posix use `/`. */
function pathSeparator(location: ProjectLocation): "\\" | "/" {
  return location.kind === "windows" ? "\\" : "/";
}

/** Join a project-relative path onto the root with the location's own separator. */
function joinProjectPath(root: string, relative: string, location: ProjectLocation): string {
  const sep = pathSeparator(location);
  const base = root.replace(/[\\/]+$/, "");
  return `${base}${sep}${relative.split("/").join(sep)}`;
}

const workingDirectoryLabel = msg`Working directory (this conversation's project root)`;
const outputHereOnlyLabel = msg`Write every generated file under this directory only, never elsewhere:`;

/**
 * Pin the conversation's resolved working directory into the prompt. The skill
 * tells the agent to use "the project root" but cannot know the absolute path;
 * without this the agent guesses and may anchor output near the source material
 * (which is usually referenced by absolute path) instead of the project root.
 */
function formatWorkingDirectoryBlock(scenario: ScenarioView, project: Project | undefined): string {
  if (!scenario.fileOutputDir || !project) return "";
  const root = projectRootPath(project.location);
  if (!root) return "";
  const sep = pathSeparator(project.location);
  return [
    `${i18n._(workingDirectoryLabel)}: ${root}`,
    i18n._(outputHereOnlyLabel),
    `- ${joinProjectPath(root, scenario.fileOutputDir, project.location)}${sep}`,
    `- ${joinProjectPath(root, ".agentemployee", project.location)}${sep}`,
  ].join("\n");
}

/**
 * Wrap a resolved document template for the prompt. The agent fills the
 * skeleton and writes the result to `resultFile`; the app keeps no copy and the
 * right-panel preview re-reads that path.
 */
function formatTemplateBlock(template: ResolvedDocumentTemplate): string {
  return [
    "TEMPLATE",
    `resultFile: ${template.resultFile}`,
    `todoMarker: ${template.todoMarker}`,
    "-----",
    template.content,
    "-----",
  ].join("\n");
}

/**
 * Resolve a scenario's document template through the supervisor
 * (`project → global → builtin`). Never throws: a missing or unreadable
 * template degrades to a prompt-only start rather than blocking the draft.
 */
async function resolveTemplate(
  project: Project | undefined,
  templateId: string,
): Promise<ResolvedDocumentTemplate | null> {
  if (!project) return null;
  try {
    return await readBridge().resolveDocumentTemplate({
      projectLocation: project.location,
      templateId,
    });
  } catch {
    return null;
  }
}

/**
 * Resolve the active workspace's (岗位) default thread config to seed the draft
 * composer with the employee's default provider/model. Returns the workspace's
 * `defaultThreadConfig` when present; otherwise `undefined` so the composer keeps
 * its existing default. Reads the active workspace synchronously (never a hook).
 */
function resolveActiveWorkspaceDefaultConfig(): ThreadConfig | undefined {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) return undefined;
  const workspace = useSharedSettings
    .getState()
    .workspaces.find((item) => item.id === workspaceId);
  return workspace?.defaultThreadConfig;
}

/**
 * Lay down the draft for a scenario: seed the composer with the prompt, the
 * resolved template block (if any) and the numbered steps, record the scenario
 * for the guide card, open a fresh thread, and — for a templated scenario —
 * open the live document preview on the template's result file.
 *
 * A scenario authored without a `prompt` opens an *empty* composer: nothing is
 * seeded, and the steps live only in the guide card so all guidance sits above
 * the box for the user to write into (see the catalog's `prompt` doc).
 *
 * A `leadingSkillId` is seeded as a leading `/skill` token with
 * `bindLeadingSkill`, so the composer binds the scenario's bundled skill as a
 * segment (see `ThreadDraftComposerArea`); the token must start the seed text.
 */
function applyScenario(
  scenario: ScenarioView,
  projectId: string,
  project: Project | undefined,
  template: ResolvedDocumentTemplate | null,
): void {
  const store = useAppStore.getState();

  if (scenario.prompt) {
    const steps = scenario.steps.map((step) => i18n._(step));
    const workspaceId = getActiveWorkspaceId();
    const activeWorkspace = workspaceId
      ? useSharedSettings.getState().workspaces.find((item) => item.id === workspaceId)
      : undefined;
    const roleBlock = activeWorkspace ? buildRoleContextBlock(activeWorkspace) : "";
    const body = [
      // The role's persisted identity leads the task so the agent "remembers"
      // which employee it is — P1-04 role memory, isolated per workspace.
      roleBlock,
      i18n._(scenario.prompt),
      template ? formatTemplateBlock(template) : "",
      formatWorkingDirectoryBlock(scenario, project),
      formatSteps(steps),
    ]
      .filter((section) => section.length > 0)
      .join("\n\n");
    const text = scenario.leadingSkillId ? `/${scenario.leadingSkillId}\n\n${body}` : body;

    const workspaceDefaultConfig = resolveActiveWorkspaceDefaultConfig();
    store.setComposerSeed(projectId, text, {
      ...(scenario.leadingSkillId ? { bindLeadingSkill: true } : {}),
      ...(scenario.enableMcpServerIds?.length
        ? { enableMcpServerIds: scenario.enableMcpServerIds }
        : {}),
      ...(workspaceDefaultConfig ? { defaultConfig: workspaceDefaultConfig } : {}),
    });
  }

  store.setActiveScenario(projectId, scenario.id);
  // The code-review scenario needs the project-level code-review-index MCP to
  // index C/C++ source. The main process writes/merges it into the project's
  // `.mcp.json` (auto-discovered) — fire-and-forget, idempotent.
  // NB: the review UI itself (file tree / code view / issue list) is *not*
  // opened here — it only appears once a review task is actually triggered
  // (draft submitted) or opened directly from the task-info view, so entering
  // the scenario page without running a task never shows the code view.
  if (
    (scenario.id === "code-review" || scenario.id === "code-review-regression") &&
    project
  ) {
    void readBridge().reviewEnsureMcp({ projectLocation: project.location });
  }
  // The draft this opens is seeded above, so it must not be treated as an
  // abandoned draft and cleared.
  openNewThread(projectId, { seeded: true });

  if (scenario.documentTemplate) {
    usePanelStore.getState().openDocumentPanel({
      projectId,
      path: template?.resultFile ?? scenario.documentTemplate.defaultResultFile,
      title: template?.title ?? i18n._(scenario.title),
    });
  }
}

/**
 * Start a scenario: open a new draft composer prefilled with the scenario's
 * prompt and usage steps (and any built-in MCP servers it needs), for the user
 * to review before sending. A scenario authored without a prompt opens an empty
 * composer instead — see {@link applyScenario}. Deliberately does *not* auto-send
 * or force a provider/model — the scenario is a task entry point, not a hidden
 * configuration. Reuses the existing one-shot composer-seed mechanism
 * (`setComposerSeed`), so the composer needs no scenario-specific code. Also
 * records the scenario as active for the project so the draft can show its
 * guide card.
 *
 * Scenarios without a document template seed synchronously; a templated
 * scenario resolves the template first (a quick supervisor round-trip), so the
 * seed carries the skeleton by the time the composer consumes it.
 */
export function startScenario(scenario: ScenarioView, projectId?: string): void {
  const targetProjectId = projectId ?? resolveNewThreadProjectId();
  if (!targetProjectId) return;

  const project = useAppStore.getState().projects.find((item) => item.id === targetProjectId);
  const spec = scenario.documentTemplate;
  if (!spec) {
    applyScenario(scenario, targetProjectId, project, null);
    return;
  }
  void resolveTemplate(project, spec.templateId).then((template) =>
    applyScenario(scenario, targetProjectId, project, template),
  );
}
