/**
 * Team → desk visual mapping. Teams group workspaces (memberEmployeeIds are
 * workspace ids); each team gets a stable cycle color drawn as a small chip on
 * its members' desks. Colors deliberately avoid the per-desk accent cycle so
 * the two encodings never read as the same thing.
 */

export interface TeamLike {
  id: string;
  memberEmployeeIds: readonly string[];
}

/** Mid-saturation team hues, distinct from DESK_ACCENT_CYCLE. */
export const TEAM_COLOR_CYCLE: readonly number[] = [
  0x9b59b6, 0xe67e22, 0x16a085, 0xc0392b, 0x34495e,
];

/** The first team that lists this workspace as a member, if any. */
export function teamForWorkspace(
  teams: readonly TeamLike[],
  workspaceId: string,
): TeamLike | undefined {
  return teams.find((team) => team.memberEmployeeIds.includes(workspaceId));
}

/** Stable per-team cycle color; undefined when the workspace is not in a team. */
export function teamColorForWorkspace(
  teams: readonly TeamLike[],
  workspaceId: string,
): number | undefined {
  const index = teams.findIndex((team) => team.memberEmployeeIds.includes(workspaceId));
  if (index < 0) return undefined;
  return TEAM_COLOR_CYCLE[index % TEAM_COLOR_CYCLE.length] ?? TEAM_COLOR_CYCLE[0];
}
