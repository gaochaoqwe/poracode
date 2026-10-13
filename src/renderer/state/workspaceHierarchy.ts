import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import type { Team, Workspace } from "@/shared/contracts";

/**
 * Workspace (岗位) org-tree selectors. The whole renderer funnels through these
 * instead of re-deriving `roleRank` / `parentWorkspaceId` / `teamId` /
 * `hiddenInNav` checks so the rule lives in one place:
 *
 * - **Primary (一级) container** = a workspace with no `roleRank`. The category
 *   buckets the sidebar nav shows; they never spawn threads directly.
 * - **Secondary (二级) employee** = a workspace with `roleRank` 1/2/3, hanging
 *   under a primary via `parentWorkspaceId`, and optionally grouped under a
 *   **Team** (via `teamId`).
 * - **Visibility**: `hiddenInNav` on an employee or a team hides that entry from
 *   nav / dock. Consumers must only consume the filtered helpers below.
 *
 * Pure functions over arrays; no store access, cheap to unit-test.
 */

export type EmployeeRank = NonNullable<Workspace["roleRank"]>;

export interface SecondaryRankGroup {
  rank: EmployeeRank;
  employees: Workspace[];
}

/** A team bucket: the team entity plus its members grouped by rank. */
export interface TeamEmployeeGroup {
  team: Team;
  ranks: SecondaryRankGroup[];
}

/** Group employees by roleRank 1→2→3, preserving within-rank order; drop empty ranks. */
function groupByRank(employees: readonly Workspace[]): SecondaryRankGroup[] {
  const groups: SecondaryRankGroup[] = [];
  for (const rank of [1, 2, 3] as const) {
    const list = employees.filter((employee) => employee.roleRank === rank);
    if (list.length > 0) groups.push({ rank, employees: list });
  }
  return groups;
}

/** Primary (一级) containers in their existing stored order. */
export function primaryWorkspaces(workspaces: readonly Workspace[]): Workspace[] {
  return workspaces.filter((workspace) => workspace.roleRank === undefined);
}

/** True when the workspace is a primary category container (not a spawnable employee). */
export function isPrimaryWorkspace(workspace: Workspace): boolean {
  return workspace.roleRank === undefined;
}

/**
 * Resolve the primary (一级) container a workspace belongs to. Primary containers
 * return themselves; secondary employees climb their `parentWorkspaceId` to the
 * owning container. Falls back to the first primary container when an employee's
 * parent is missing/unknown, and finally to the workspace itself when no primary
 * exists (legacy flat model). Used so context surfaces (e.g. the workspace
 * switcher trigger) always present a stable category label instead of a
 * secondary employee's name.
 */
export function primaryContainerOf(
  workspaces: readonly Workspace[],
  workspaceId: string,
): Workspace | undefined {
  const primaries = primaryWorkspaces(workspaces);
  const target = workspaces.find((workspace) => workspace.id === workspaceId);
  if (!target) return primaries[0];
  if (isPrimaryWorkspace(target)) return target;
  const parent = workspaces.find((workspace) => workspace.id === target.parentWorkspaceId);
  if (parent && isPrimaryWorkspace(parent)) return parent;
  return primaries[0];
}

/**
 * Everything a workspace selection covers: the workspace itself plus, when it is
 * a primary (一级) container, every employee hanging under it (recursively, so a
 * future employee-of-employee nests correctly). Consumed by the membership rule
 * `isProjectInWorkspace` / `isThreadInWorkspace` so picking a 岗位 shows that
 * post *and its employees'* work — a container on its own usually owns no
 * projects, and an empty sidebar after switching would read as a broken switch.
 *
 * Returns an empty set for `null`/unknown ids; callers feeding the membership
 * rule never pass one in that state (the active id is resolved first).
 */
export function workspaceScopeIds(
  workspaces: readonly Workspace[],
  activeWorkspaceId: string | null,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!activeWorkspaceId) return ids;
  if (!workspaces.some((workspace) => workspace.id === activeWorkspaceId)) return ids;
  ids.add(activeWorkspaceId);

  // Walk down the org tree level by level. Workspace lists are tiny (tens of
  // entries), so the repeated scans stay cheaper than an index to maintain.
  let frontier = new Set([activeWorkspaceId]);
  while (frontier.size > 0) {
    const next = new Set<string>();
    for (const workspace of workspaces) {
      const parent = workspace.parentWorkspaceId;
      if (!parent || !frontier.has(parent) || ids.has(workspace.id)) continue;
      ids.add(workspace.id);
      next.add(workspace.id);
    }
    frontier = next;
  }
  return ids;
}

/** Teams not hidden from nav (nav/dock consume only these). */
export function visibleTeams(teams: readonly Team[]): Team[] {
  return teams.filter((team) => !team.hiddenInNav);
}

/** Employees (workspaces) not hidden from nav (nav/dock consume only these). */
export function visibleEmployees(workspaces: readonly Workspace[]): Workspace[] {
  return workspaces.filter((workspace) => !workspace.hiddenInNav);
}

/**
 * Secondary (二级) employees under one primary container, grouped by
 * `roleRank` 1→2→3. Within each rank the stored order is preserved. Groups with
 * no members are omitted. Hidden employees are excluded.
 */
export function secondaryEmployees(
  workspaces: readonly Workspace[],
  primaryId: string,
): SecondaryRankGroup[] {
  return groupByRank(
    visibleEmployees(workspaces).filter(
      (workspace) => workspace.parentWorkspaceId === primaryId && workspace.roleRank !== undefined,
    ),
  );
}

/** Total visible secondary employees under a primary (across all ranks/teams). */
export function secondaryEmployeeCount(
  workspaces: readonly Workspace[],
  primaryId: string,
): number {
  let count = 0;
  for (const group of secondaryEmployees(workspaces, primaryId)) count += group.employees.length;
  return count;
}

/**
 * Team-layer view under one primary container: visible secondary employees
 * bucketed by their team. Each known, visible team becomes a `TeamEmployeeGroup`
 * (members further split by rank). Employees with no teamId — or whose team is
 * hidden/unknown — land in the `ungrouped` fallback bucket instead.
 */
export function teamWorkspaces(
  workspaces: readonly Workspace[],
  teams: readonly Team[],
  primaryId: string,
): { teams: TeamEmployeeGroup[]; ungrouped: SecondaryRankGroup[] } {
  const visibleTeamIds = new Set(visibleTeams(teams).map((team) => team.id));
  const teamById = new Map(teams.map((team) => [team.id, team] as const));

  const buckets = new Map<string, Workspace[]>();
  const unbucketed: Workspace[] = [];

  for (const workspace of visibleEmployees(workspaces)) {
    if (workspace.parentWorkspaceId !== primaryId || workspace.roleRank === undefined) continue;
    if (workspace.teamId) {
      // A visible, known team buckets its members; a hidden/unknown team hides
      // the whole team — its members drop out entirely (no fallback bucket).
      if (visibleTeamIds.has(workspace.teamId)) {
        const list = buckets.get(workspace.teamId) ?? [];
        list.push(workspace);
        buckets.set(workspace.teamId, list);
      }
    } else {
      unbucketed.push(workspace);
    }
  }

  const teamGroups: TeamEmployeeGroup[] = [];
  for (const [teamId, employees] of buckets) {
    const team = teamById.get(teamId);
    if (!team) continue;
    teamGroups.push({ team, ranks: groupByRank(employees) });
  }

  return { teams: teamGroups, ungrouped: groupByRank(unbucketed) };
}

/** i18n label for a management rank. Callers render with `t(rankLabel)`. */
export function roleRankLabel(rank: EmployeeRank): MessageDescriptor {
  if (rank === 1) return msg`Level 1`;
  if (rank === 2) return msg`Level 2`;
  return msg`Level 3`;
}

/**
 * Workspaces rendered as assignable employee cards (the dock): visible
 * secondary employees only — primary containers are nav buckets, and hidden
 * employees are never dispatched to. Before the two-tier seed exists (no
 * workspace carries a rank yet) fall back to the whole list so legacy flat docks
 * never go empty.
 */
export function assignableWorkspaces(workspaces: readonly Workspace[]): Workspace[] {
  const secondary = workspaces.filter(
    (workspace) => workspace.roleRank !== undefined && !workspace.hiddenInNav,
  );
  return secondary.length > 0 ? secondary : [...workspaces];
}
