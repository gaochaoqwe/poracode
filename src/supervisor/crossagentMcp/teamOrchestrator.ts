import type { Team, TeamDispatchPolicy, Workspace } from "@/shared/contracts";

/**
 * P2-03/P2-04 — central team orchestration.
 *
 * A team groups employee roles (workspaces) that cooperate on a task. This
 * module owns the *decision* side of orchestration — resolving which member
 * roles are valid, and which target(s) a dispatched task should go to under a
 * team's policy. Actual spawning happens through an injected handler wired by
 * the supervisor (cross-agent MCP), keeping this core pure and testable.
 *
 * Deliberately provider-agnostic: it reads only team + workspace fields, never
 * branches on a provider name.
 */

/** A member role resolved from a team's workspace ids (invalid ids dropped). */
export interface TeamMember {
  workspaceId: string;
  name: string;
  /** Bound default provider kind (from the 岗位 fields), if any. */
  agentKind?: string | undefined;
  /** Bound default thread config, if any (used when spawning member threads). */
  defaultThreadConfig?: Workspace["defaultThreadConfig"] | undefined;
}

/** A task waiting to be dispatched to a team. */
export interface QueuedTeamTask {
  id: string;
  teamId: string;
  prompt: string;
  enqueuedAt: string;
  /**
   * How many times this task has been forwarded to member threads. The host
   * increments it on every drain and refuses to dispatch once it exceeds the
   * configured cap — a defensive guard against forwarding loops (there is no
   * automatic re-forwarding today; this bounds future handoff chains).
   */
  forwardCount: number;
  /** Optional ISO deadline; parked tasks pop earlier-deadline first. */
  deadline?: string;
}

/** Where a dispatched task should land. */
export interface DispatchDecision {
  policy: TeamDispatchPolicy;
  /**
   * Exactly one member for round-robin / manager-assigns; every member for
   * free-for-all. Empty when the team has no valid members.
   */
  targets: TeamMember[];
}

/**
 * Resolve a team's member ids into the live workspace roles, dropping ids that
 * no longer exist. Member order follows the team's declared order (stable for
 * round-robin rotation).
 */
export function resolveMemberRoles(
  team: Pick<Team, "memberEmployeeIds">,
  workspaces: readonly Workspace[],
): TeamMember[] {
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace] as const));
  const members: TeamMember[] = [];
  for (const id of team.memberEmployeeIds) {
    const workspace = byId.get(id);
    if (!workspace) continue;
    members.push({
      workspaceId: workspace.id,
      name: workspace.name,
      ...(workspace.agentKind ? { agentKind: workspace.agentKind } : {}),
      ...(workspace.defaultThreadConfig
        ? { defaultThreadConfig: workspace.defaultThreadConfig }
        : {}),
    });
  }
  return members;
}

/**
 * Pick the dispatch target(s) for a task under the team's policy.
 *
 * - `round-robin`: one member, rotating by `roundRobinCursor`.
 * - `free-for-all`: every member in parallel.
 * - `manager-assigns`: the manager role when it is a valid member; otherwise
 *   degrades to round-robin so the team still makes progress.
 *
 * The caller owns advancing `roundRobinCursor` between tasks.
 */
export function selectDispatchTargets(
  team: Pick<Team, "dispatchPolicy" | "managerEmployeeId">,
  members: readonly TeamMember[],
  roundRobinCursor: number,
): DispatchDecision {
  if (members.length === 0) {
    return { policy: team.dispatchPolicy, targets: [] };
  }
  switch (team.dispatchPolicy) {
    case "free-for-all":
      return { policy: "free-for-all", targets: [...members] };
    case "manager-assigns": {
      const manager = team.managerEmployeeId
        ? members.find((member) => member.workspaceId === team.managerEmployeeId)
        : undefined;
      if (manager) return { policy: "manager-assigns", targets: [manager] };
      // No valid manager role — degrade to round-robin.
      const target = members[roundRobinCursor % members.length]!;
      return { policy: "manager-assigns", targets: [target] };
    }
    case "round-robin":
    default: {
      const target = members[roundRobinCursor % members.length]!;
      return { policy: "round-robin", targets: [target] };
    }
  }
}

/** Append-only FIFO queue of team tasks, drained by the supervisor host. */
export class TeamTaskQueue {
  private tasks: QueuedTeamTask[] = [];

  get size(): number {
    return this.tasks.length;
  }

  enqueue(task: QueuedTeamTask): void {
    this.tasks.push(task);
  }

  dequeue(): QueuedTeamTask | undefined {
    return this.tasks.shift();
  }

  /** Pending tasks for a team (oldest first). */
  pendingFor(teamId: string): QueuedTeamTask[] {
    return this.tasks.filter((task) => task.teamId === teamId);
  }

  clear(): void {
    this.tasks = [];
  }
}
