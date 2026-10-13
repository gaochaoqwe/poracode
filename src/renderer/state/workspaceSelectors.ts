import { useShallow } from "zustand/react/shallow";
import {
  isProjectInWorkspace,
  isThreadInWorkspace,
  type Project,
  type ScenarioCategory,
  type Thread,
  type Workspace,
} from "@/shared/contracts";
import { DEFAULT_SCENARIO_IDS_BY_CATEGORY } from "@/renderer/scenarios/catalog";
import { isHomeProjectId } from "@/shared/homeScope";
import { useAppStore } from "./appStore";
import { useSharedSettings } from "./sharedSettingsStore";
import { useActiveWorkspaceId } from "./workspaceStore";
import { isPrimaryWorkspace, workspaceScopeIds } from "./workspaceHierarchy";

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
 * Scenario ids a workspace surfaces by default. `undefined` means "show every
 * scenario" — the case for workspaces with no explicit list (the general/test
 * defaults, or a workspace created before this field existed). An explicit
 * empty array means "show none".
 *
 * Resolution order (see {@link resolveWorkspaceScenarioScope}): the workspace's
 * own list wins, then its own task domain, then — for a secondary (二级) 岗位
 * with neither — its primary (一级) container's list/domain. This last step is
 * what scopes the scenario list to the active 岗位 instead of showing every
 * scenario when the user picks a team member in the workspace switcher.
 */
export function useActiveWorkspaceScenarios(): readonly string[] | undefined {
  const activeWorkspaceId = useActiveWorkspaceId();
  return useSharedSettings((state) =>
    resolveWorkspaceScenarioScope(state.workspaces, activeWorkspaceId),
  );
}

/**
 * Task domain of the active workspace, with the same primary-container
 * inheritance as {@link resolveWorkspaceScenarioScope}: an explicit category
 * wins, otherwise a secondary employee inherits its container's domain.
 */
export function useActiveWorkspaceCategory(): ScenarioCategory | undefined {
  const activeWorkspaceId = useActiveWorkspaceId();
  return useSharedSettings((state) =>
    resolveWorkspaceCategory(state.workspaces, activeWorkspaceId),
  );
}

/** Category defaults for a workspace that only carries a domain, not a list. */
function defaultScenarioIdsForCategory(
  category: ScenarioCategory | undefined,
): readonly string[] | undefined {
  if (category === undefined) return undefined;
  const ids = DEFAULT_SCENARIO_IDS_BY_CATEGORY[category];
  // A category with no scenarios of its own shows every scenario rather than
  // none (mirrors the default-workspace seeding rule).
  return ids.length > 0 ? ids : undefined;
}

/**
 * Scenario ids a workspace surfaces, resolving org-tree inheritance. Explicit
 * fields on the workspace itself always win; a secondary (二级) 岗位 that has
 * neither its own list nor its own domain inherits its primary (一级) container's
 * list/domain, so clicking any 岗位 in the workspace switcher scopes the sidebar
 * scenario list to that post's work. Pure function — cheap to unit-test.
 */
export function resolveWorkspaceScenarioScope(
  workspaces: readonly Workspace[],
  workspaceId: string | null,
): readonly string[] | undefined {
  const workspace = workspaceId ? workspaces.find((w) => w.id === workspaceId) : undefined;
  if (!workspace) return undefined;
  if (workspace.defaultScenarioIds !== undefined) return workspace.defaultScenarioIds;
  const own = defaultScenarioIdsForCategory(workspace.category);
  if (own !== undefined) return own;
  if (workspace.roleRank !== undefined && workspace.parentWorkspaceId) {
    const container = workspaces.find(
      (w) => w.id === workspace.parentWorkspaceId && isPrimaryWorkspace(w),
    );
    if (container) {
      if (container.defaultScenarioIds !== undefined) return container.defaultScenarioIds;
      const inherited = defaultScenarioIdsForCategory(container.category);
      if (inherited !== undefined) return inherited;
    }
  }
  return undefined;
}

/**
 * Task domain of a workspace, resolving the same primary-container inheritance
 * as {@link resolveWorkspaceScenarioScope}. Pure function — cheap to unit-test.
 */
export function resolveWorkspaceCategory(
  workspaces: readonly Workspace[],
  workspaceId: string | null,
): ScenarioCategory | undefined {
  const workspace = workspaceId ? workspaces.find((w) => w.id === workspaceId) : undefined;
  if (!workspace) return undefined;
  if (workspace.category !== undefined) return workspace.category;
  if (workspace.roleRank !== undefined && workspace.parentWorkspaceId) {
    return workspaces.find(
      (w) => w.id === workspace.parentWorkspaceId && isPrimaryWorkspace(w),
    )?.category;
  }
  return undefined;
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
