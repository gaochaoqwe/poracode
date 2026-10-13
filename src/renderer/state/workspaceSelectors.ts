import { useShallow } from "zustand/react/shallow";
import {
  isProjectInWorkspace,
  isThreadInWorkspace,
  type Project,
  type ScenarioCategory,
  type Thread,
  type Workspace,
} from "@/shared/contracts";
import { isHomeProjectId } from "@/shared/homeScope";
import { useAppStore } from "./appStore";
import { useSharedSettings } from "./sharedSettingsStore";
import { useActiveWorkspaceId } from "./workspaceStore";
import { workspaceScopeIds } from "./workspaceHierarchy";

/**
 * Workspace-id lookup cached on the identity of the settings array. The list
 * changes only when the user edits it, so rebuilding the Set on every render of
 * every consumer would be pure waste.
 */
let cachedWorkspaces: readonly Workspace[] | null = null;
let cachedWorkspaceIds: ReadonlySet<string> = new Set();

function workspaceIdSet(workspaces: readonly Workspace[]): ReadonlySet<string> {
  if (workspaces !== cachedWorkspaces) {
    cachedWorkspaces = workspaces;
    cachedWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  }
  return cachedWorkspaceIds;
}

/**
 * Reactive predicate for "is this project in the active workspace". Returned as
 * a plain function so callers can filter their own lists without each one
 * re-deriving the rule (which lives in `@/shared/contracts/workspace`).
 *
 * The selection covers the active workspace *plus its employees' workspaces* when
 * a primary (一级) 岗位 container is active — see `workspaceScopeIds`.
 */
export function useWorkspaceProjectFilter(): (project: Project) => boolean {
  const workspaces = useSharedSettings((state) => state.workspaces);
  const knownWorkspaceIds = workspaceIdSet(workspaces);
  const activeWorkspaceId = useActiveWorkspaceId();
  const scopeIds = workspaceScopeIds(workspaces, activeWorkspaceId);
  return (project) => isProjectInWorkspace(project, activeWorkspaceId, knownWorkspaceIds, scopeIds);
}

/**
 * Reactive predicate for "is this thread in the active workspace". Only Home
 * threads can fail it — threads in real projects scope through their project
 * (see `isThreadInWorkspace` in `@/shared/contracts/workspace`).
 */
export function useWorkspaceThreadFilter(): (thread: Thread) => boolean {
  const workspaces = useSharedSettings((state) => state.workspaces);
  const knownWorkspaceIds = workspaceIdSet(workspaces);
  const activeWorkspaceId = useActiveWorkspaceId();
  const scopeIds = workspaceScopeIds(workspaces, activeWorkspaceId);
  return (thread) => isThreadInWorkspace(thread, activeWorkspaceId, knownWorkspaceIds, scopeIds);
}

/** Ids of projects the active workspace shows, in store order. Excludes Home. */
export function useWorkspaceProjectIds(): string[] {
  const isVisible = useWorkspaceProjectFilter();
  return useAppStore(
    useShallow((state) =>
      state.projects
        .filter((project) => !isHomeProjectId(project.id) && isVisible(project))
        .map((project) => project.id),
    ),
  );
}

/**
 * Scenario ids the active workspace surfaces by default. `undefined` means
 * "show every scenario" — the case for workspaces with no explicit list (the
 * general/test defaults, or a workspace created before this field existed). An
 * explicit empty array means "show none".
 */
export function useActiveWorkspaceScenarios(): readonly string[] | undefined {
  const activeWorkspaceId = useActiveWorkspaceId();
  return useSharedSettings(
    (state) => state.workspaces.find((w) => w.id === activeWorkspaceId)?.defaultScenarioIds,
  );
}

/** Task domain of the active workspace, if it has one. */
export function useActiveWorkspaceCategory(): ScenarioCategory | undefined {
  const activeWorkspaceId = useActiveWorkspaceId();
  return useSharedSettings(
    (state) => state.workspaces.find((w) => w.id === activeWorkspaceId)?.category,
  );
}

/**
 * Project ids the active workspace hides. Consumed both as a count (the sidebar's
 * "this workspace is empty but others aren't" copy) and as a membership test (the
 * tasks view, which hides tasks belonging to those projects).
 */
export function useProjectIdsHiddenByWorkspace(): ReadonlySet<string> {
  const isVisible = useWorkspaceProjectFilter();
  return useAppStore(
    useShallow(
      (state) =>
        new Set(
          state.projects
            .filter((project) => !isHomeProjectId(project.id) && !isVisible(project))
            .map((project) => project.id),
        ),
    ),
  );
}
