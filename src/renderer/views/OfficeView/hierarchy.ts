import type { Workspace } from "@/shared/contracts";

/**
 * Org-tree helpers. Level-1 workspaces are containers (no roleRank); level-2
 * workspaces are employees (roleRank 1-3) optionally grouped under a team
 * (teamId). OfficeView renders only visible employees as desks. Regions
 * (desk stripe color + legend key) follow team first, then container parent.
 */

export interface TeamLike {
  id: string;
  hiddenInNav?: boolean | undefined;
}

/** Ids of teams flagged hidden in nav — their employees disappear entirely. */
export function hiddenTeamIds(teams: readonly TeamLike[]): Set<string> {
  return new Set(teams.filter((t) => t.hiddenInNav === true).map((t) => t.id));
}

/** A level-2 employee: has an explicit rank. Everything else is a container. */
export function isEmployeeWorkspace(workspace: Workspace): boolean {
  return workspace.roleRank !== undefined;
}

/** Hidden in nav (workspace itself or its whole team) → not rendered. */
export function isVisibleEmployee(workspace: Workspace, hiddenTeams: ReadonlySet<string>): boolean {
  if (workspace.hiddenInNav === true) return false;
  if (workspace.teamId !== undefined && hiddenTeams.has(workspace.teamId)) return false;
  return true;
}

/**
 * Visible level-2 employees only — the office floor renders exactly these.
 */
export function employeeWorkspaces(
  workspaces: readonly Workspace[],
  hiddenTeams: ReadonlySet<string> = new Set(),
): Workspace[] {
  return workspaces.filter((w) => isEmployeeWorkspace(w) && isVisibleEmployee(w, hiddenTeams));
}

/**
 * Region key: team first, then the level-1 container, then the unranked
 * fallback. Same-team desks share a stripe color + legend entry.
 */
export const UNRANKED_REGION_KEY = "unranked";

export function regionKeyForEmployee(workspace: Workspace): string {
  return workspace.teamId ?? workspace.parentWorkspaceId ?? UNRANKED_REGION_KEY;
}

/** Region stripe colors — 4 distinct mid hues, kept apart from accents/teams. */
export const REGION_COLOR_CYCLE: readonly number[] = [0x7fb3d5, 0xd5c17f, 0x9bc48a, 0xc49bb5];

export function regionColorForIndex(index: number): number {
  return REGION_COLOR_CYCLE[index % REGION_COLOR_CYCLE.length] ?? REGION_COLOR_CYCLE[0]!;
}

/** Rank as a tiny pixel-dot row (1/2/3 dots) — pure count, used by the floor. */
export function rankDotCount(rank: number | undefined): number {
  if (rank === undefined || rank < 1 || rank > 3) return 0;
  return rank;
}
