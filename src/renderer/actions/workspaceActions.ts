import { toast } from "@heroui/react";
import { msg, plural } from "@lingui/core/macro";
import { isProjectInWorkspace, type ScenarioCategory, type Workspace } from "@/shared/contracts";
import { i18n } from "@/renderer/i18n/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  getActiveWorkspaceId,
  getActiveWorkspaceScopeIds,
  useWorkspaceStore,
} from "@/renderer/state/workspaceStore";

/** Create a workspace and switch to it. Returns null when the name is blank. */
export function createWorkspace(name: string): Workspace | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const workspace = useSharedSettings.getState().addWorkspace(trimmed);
  useWorkspaceStore.getState().setActiveWorkspaceId(workspace.id);
  return workspace;
}

/**
 * Create a new employee under a primary post (一级岗位): the workspace hangs
 * from `parentWorkspaceId` at `roleRank` (defaults to level 3, the executor
 * tier). Does not switch the active workspace. Returns the new employee, or
 * `null` when the name is blank or the parent is missing.
 */
export function createEmployeeUnderPost(
  name: string,
  parentWorkspaceId: string,
  roleRank: 1 | 2 | 3 = 3,
): Workspace | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const workspaces = useSharedSettings.getState().workspaces;
  if (!workspaces.some((w) => w.id === parentWorkspaceId)) return null;
  return useSharedSettings.getState().addWorkspace(trimmed, {
    parentWorkspaceId,
    roleRank,
  });
}

/**
 * Follow a project into its own workspace when it lives outside the active one.
 * Opening work the current workspace hides would otherwise leave the user
 * staring at a sidebar that does not contain the thread they just started, so
 * the view moves to where the work is. No-op for projects the active workspace
 * already shows (including unfiled ones and Home).
 */
export function switchWorkspaceForProject(projectId: string): void {
  const project = useAppStore.getState().projects.find((item) => item.id === projectId);
  const targetWorkspaceId = project?.workspaceId;
  if (!project || !targetWorkspaceId) return;
  const knownWorkspaceIds = new Set(
    (useSharedSettings.getState().workspaces ?? []).map((workspace) => workspace.id),
  );
  // A container selection already covers its employees' projects, so following
  // the project would be a pointless jump to the very workspace it lives in.
  if (
    isProjectInWorkspace(
      project,
      getActiveWorkspaceId(),
      knownWorkspaceIds,
      getActiveWorkspaceScopeIds(),
    )
  ) {
    return;
  }
  useWorkspaceStore.getState().setActiveWorkspaceId(targetWorkspaceId);
}

export function renameWorkspace(workspaceId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  useSharedSettings.getState().renameWorkspace(workspaceId, trimmed);
}

/**
 * Copy a workspace — including its employee (岗位) profile, default scenario
 * list, and provider/model binding — under a fresh id and name, and switch to
 * it. Returns the new workspace, or `null` when the source/name is invalid.
 */
export function duplicateWorkspace(workspaceId: string, name: string): Workspace | null {
  const workspace = useSharedSettings.getState().duplicateWorkspace(workspaceId, name);
  if (!workspace) return null;
  useWorkspaceStore.getState().setActiveWorkspaceId(workspace.id);
  return workspace;
}

/** Set (or clear) a workspace's task domain. */
export function setWorkspaceCategory(
  workspaceId: string,
  category: ScenarioCategory | undefined,
): void {
  useSharedSettings.getState().setWorkspaceCategory(workspaceId, category);
}

/** Set (or clear, with `undefined` = "show every scenario") a workspace's default scenarios. */
export function setWorkspaceDefaultScenarios(
  workspaceId: string,
  scenarioIds: string[] | undefined,
): void {
  useSharedSettings.getState().setWorkspaceDefaultScenarios(workspaceId, scenarioIds);
}

/**
 * Patch a workspace's digital-employee (岗位) profile: persona, responsibilities,
 * skills, capability tags, default provider/model binding, and job permissions.
 * `undefined` values clear the corresponding field. See
 * `sharedSettingsStore.updateWorkspaceProfile`.
 */
export function updateWorkspaceProfile(
  workspaceId: string,
  patch: Parameters<ReturnType<typeof useSharedSettings.getState>["updateWorkspaceProfile"]>[1],
): void {
  useSharedSettings.getState().updateWorkspaceProfile(workspaceId, patch);
}

/**
 * Where a deleted workspace's projects would land. Exported so the confirm dialog
 * names the same destination the deletion actually uses — two copies of this rule
 * would let the dialog promise one workspace while the action picks another.
 */
export function workspaceDeletionFallback(workspaceId: string): Workspace | undefined {
  return useSharedSettings.getState().workspaces.find((w) => w.id !== workspaceId);
}

/**
 * Delete a workspace, handing its projects to another one first. Deleting a
 * grouping must never delete the work inside it, so the projects are always
 * re-filed rather than left pointing at a workspace that no longer exists.
 */
export function deleteWorkspace(workspaceId: string): void {
  const fallback = workspaceDeletionFallback(workspaceId);
  if (!fallback) {
    toast.warning(i18n._(msg`Keep at least one workspace.`));
    return;
  }

  let movedCount = 0;
  for (const project of useAppStore.getState().projects) {
    if (project.workspaceId === workspaceId) movedCount += 1;
  }
  const wasActive = getActiveWorkspaceId() === workspaceId;

  useAppStore.getState().refileProjects(workspaceId, fallback.id);
  useSharedSettings.getState().removeWorkspace(workspaceId);
  if (wasActive) useWorkspaceStore.getState().setActiveWorkspaceId(fallback.id);

  if (movedCount > 0) {
    const target = fallback.name;
    toast.info(
      i18n._(
        msg`${plural(movedCount, {
          one: `Moved # project to ${target}.`,
          other: `Moved # projects to ${target}.`,
        })}`,
      ),
    );
  }
}
