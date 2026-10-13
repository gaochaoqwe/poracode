import { randomUUID } from "node:crypto";
import type {
  DispatchTeamTaskPayload,
  DispatchTeamTaskResult,
  ProjectLocation,
  Team,
  TeamDispatchPolicy,
  TeamDispatchTargetResult,
  TeamIdPayload,
  TeamMemberThreadSummary,
  TeamRunChange,
  TeamRunStatus,
  TeamSnapshot,
  ThreadConfig,
  TerminalSize,
  Workspace,
} from "@/shared/contracts";
import {
  TeamTaskQueue,
  resolveMemberRoles,
  selectDispatchTargets,
  type QueuedTeamTask,
  type TeamMember,
} from "./teamOrchestrator";
import { EmployeeTaskQueue, type EmployeeQueuedTask } from "./employeeTaskQueue";
import type { EmployeeQueueSnapshot } from "@/shared/ipc/events";

/**
 * P2-06/P2-07 — the supervisor host side of team orchestration.
 *
 * Owns the runtime glue around the pure decision functions in
 * `teamOrchestrator`: the FIFO {@link TeamTaskQueue}, per-team round-robin
 * cursors, and the drain step that turns a {@link DispatchDecision} into
 * actual member threads via an injected spawn handler. Spawning, persistence,
 * and thread-status reads are all delegated so this module stays testable
 * without a live `ThreadSessionManager` or SQLite.
 *
 * Deliberately provider-agnostic: it reads only team + workspace fields and
 * calls the injected handlers — no provider names, no kind branches.
 */

/**
 * Defensive cap on how many times one task may be forwarded to member threads.
 * There is no automatic re-forwarding today; this bounds future handoff chains.
 */
export const MAX_TEAM_TASK_FORWARDS = 3;

/**
 * Thread statuses that mean the run is still in flight. Everything else
 * (`finished` / `error` / `inactive` / `idle`) counts as settled. `needs_approval`
 * is deliberately active: the thread is parked on a human gate, not finished.
 */
const ACTIVE_THREAD_STATUSES = new Set(["launching", "working", "needs_reply", "needs_approval"]);

/** A dispatched run whose member threads are still in flight. */
interface TrackedTeamRun {
  teamId: string;
  prompt: string;
  policy: TeamDispatchPolicy;
  targetWorkspaceIds: string[];
  createdAt: string;
  threadIds: string[];
  /** threadId → workspaceId, so terminal settlement can free the right employee. */
  threadWorkspace: Map<string, string>;
  /** threadIds already freed back to their employee queue. */
  freed: Set<string>;
}

/**
 * Launch context the caller supplies for a team task. The member's own binding
 * (`agentKind` / `agentInstanceId` / workspace `defaultThreadConfig`) is layered
 * on top by the spawn handler; this is just the project + base model config.
 */
export interface TeamDispatchBase {
  projectLocation: ProjectLocation;
  config: ThreadConfig;
  initialSize: TerminalSize;
  prompt: string;
}

/** One member a drained task targets; the host maps it onto a startThread call. */
export interface TeamSpawnRequest {
  member: TeamMember;
  /** The full workspace record, so the host can read `agentInstanceId` too. */
  workspace: Workspace;
  base: TeamDispatchBase;
  task: QueuedTeamTask;
}

export interface TeamDispatcherDeps {
  /** Read the live teams + workspaces straight from the shared-settings cache. */
  readTeams: () => { teams: readonly Team[]; workspaces: readonly Workspace[] };
  /** Spawn one member thread; resolves to the new thread id. Throws on failure. */
  spawnMemberThread: (request: TeamSpawnRequest) => Promise<string>;
  /**
   * Persist one team-run row (insert on "running", update on terminal status).
   * Optional: when absent, dispatch proceeds without persistence — the host
   * bridges it to main via the `team-run-change` event.
   */
  recordTeamRun?: (change: TeamRunChange) => void | Promise<void>;
  /**
   * Read a spawned member thread's live status for team snapshots. Optional:
   * when absent, snapshots degrade to thread entries without a status.
   */
  readMemberThreadStatus?: (threadId: string) => string | undefined;
  /**
   * Emit the per-employee queue snapshot after every state change (markBusy /
   * enqueue / markIdle / terminal release). Optional: when absent, snapshots are
   * not broadcast — dispatch still works.
   */
  onQueueSnapshot?: (snapshot: EmployeeQueueSnapshot) => void;
}

export class TeamDispatcher {
  private readonly queue = new TeamTaskQueue();
  private readonly roundRobinCursors = new Map<string, number>();
  private readonly startedTeams = new Set<string>();
  /** Per-employee serial queue: one member thread per employee at a time. */
  private readonly employeeQueue = new EmployeeTaskQueue();
  /** workspaceId → threadId for every member thread this dispatcher spawned. */
  private readonly spawnedThreads = new Map<string, string>();
  /** runId → in-flight member threads awaiting terminal settlement. */
  private readonly trackedRuns = new Map<string, TrackedTeamRun>();
  /** threadId → runId, so a lifecycle event can find the owning run in O(1). */
  private readonly threadToRun = new Map<string, string>();

  constructor(private readonly deps: TeamDispatcherDeps) {}

  /** Tasks still queued for a team (diagnostics / tests). */
  pendingFor(teamId: string): QueuedTeamTask[] {
    return this.queue.pendingFor(teamId);
  }

  /** Validate a team exists, register it, and return its runtime snapshot. */
  startTeam({ teamId }: TeamIdPayload): TeamSnapshot {
    const { teams, workspaces } = this.deps.readTeams();
    const team = teams.find((candidate) => candidate.id === teamId);
    if (!team) {
      throw new Error(`Team not found: ${teamId}`);
    }
    this.register(team.id);
    return this.snapshot(team, workspaces);
  }

  /** Enqueue a task and immediately drain it: decide targets, spawn member threads. */
  async dispatchTeamTask(payload: DispatchTeamTaskPayload): Promise<DispatchTeamTaskResult> {
    const { teams, workspaces } = this.deps.readTeams();
    const team = teams.find((candidate) => candidate.id === payload.teamId);
    if (!team) {
      throw new Error(`Team not found: ${payload.teamId}`);
    }
    this.register(team.id);
    const task: QueuedTeamTask = {
      id: randomUUID(),
      teamId: team.id,
      prompt: payload.prompt,
      enqueuedAt: new Date().toISOString(),
      forwardCount: 0,
      ...(payload.deadline ? { deadline: payload.deadline } : {}),
    };
    this.queue.enqueue(task);
    // FIFO across teams: the head task is the one we just enqueued (dispatch is
    // synchronous-to-drain), but dequeue by identity so an older task for the
    // same queue can never be dropped.
    const next = this.queue.dequeue() ?? task;
    return this.dispatchTask(team, workspaces, next, payload);
  }

  private register(teamId: string): void {
    this.startedTeams.add(teamId);
    if (!this.roundRobinCursors.has(teamId)) {
      this.roundRobinCursors.set(teamId, 0);
    }
  }

  private snapshot(team: Team, workspaces: readonly Workspace[]): TeamSnapshot {
    const memberThreads: TeamMemberThreadSummary[] = [...this.spawnedThreads.entries()]
      .filter(([workspaceId]) => team.memberEmployeeIds.includes(workspaceId))
      .map(([workspaceId, threadId]) => ({
        workspaceId,
        threadId,
        ...(this.deps.readMemberThreadStatus
          ? { status: this.deps.readMemberThreadStatus(threadId) }
          : {}),
      }));
    return {
      team,
      memberCount: resolveMemberRoles(team, workspaces).length,
      pendingTaskCount: this.queue.pendingFor(team.id).length,
      memberThreads,
    };
  }

  private async dispatchTask(
    team: Team,
    workspaces: readonly Workspace[],
    task: QueuedTeamTask,
    base: TeamDispatchBase,
  ): Promise<DispatchTeamTaskResult> {
    // Forward-count guard: refuse to dispatch once the cap is exceeded. The
    // counter increments per drain; there is no automatic re-forwarding today.
    task.forwardCount += 1;
    if (task.forwardCount > MAX_TEAM_TASK_FORWARDS) {
      await this.recordRun(task, team, team.dispatchPolicy, [], "failed");
      throw new Error(`max forwards exceeded for task ${task.id}`);
    }
    const members = resolveMemberRoles(team, workspaces);
    const cursor = this.roundRobinCursors.get(team.id) ?? 0;
    const decision = selectDispatchTargets(team, members, cursor);
    // Advance the rotation only when the decision actually picked a single member
    // by round-robin — a plain round-robin task, or a manager-assigns task that
    // degraded because the manager role was unavailable.
    if (decision.targets.length === 1) {
      this.roundRobinCursors.set(team.id, cursor + 1);
    }
    const targetIds = decision.targets.map((target) => target.workspaceId);
    await this.recordRun(task, team, decision.policy, targetIds, "running");
    const workspaceById = new Map(
      workspaces.map((workspace) => [workspace.id, workspace] as const),
    );
    const targets: TeamDispatchTargetResult[] = [];
    for (const target of decision.targets) {
      const workspace = workspaceById.get(target.workspaceId);
      if (!workspace) {
        targets.push({
          workspaceId: target.workspaceId,
          status: "skipped",
          reason: `Workspace not found: ${target.workspaceId}`,
        });
        continue;
      }
      // Employee-level serialization: a busy employee does NOT take a second
      // concurrent task — the job parks on that employee's FIFO line and the
      // terminal watcher dispatches it when the running thread settles.
      if (this.employeeQueue.isBusy(target.workspaceId)) {
        this.employeeQueue.enqueue(target.workspaceId, {
          employeeId: target.workspaceId,
          teamId: team.id,
          prompt: base.prompt,
          projectLocation: base.projectLocation,
          config: base.config,
          initialSize: base.initialSize,
          enqueuedAt: task.enqueuedAt,
          ...(task.deadline ? { deadline: task.deadline } : {}),
        });
        this.emitQueueSnapshot();
        targets.push({
          workspaceId: target.workspaceId,
          status: "queued",
          reason: "employee busy — parked on its FIFO queue",
        });
        continue;
      }
      this.employeeQueue.markBusy(target.workspaceId, {
        employeeId: target.workspaceId,
        teamId: team.id,
        prompt: base.prompt,
        projectLocation: base.projectLocation,
        config: base.config,
        initialSize: base.initialSize,
        enqueuedAt: task.enqueuedAt,
        ...(task.deadline ? { deadline: task.deadline } : {}),
      });
      this.emitQueueSnapshot();
      try {
        const threadId = await this.deps.spawnMemberThread({
          member: target,
          workspace,
          base,
          task,
        });
        this.spawnedThreads.set(target.workspaceId, threadId);
        targets.push({ workspaceId: target.workspaceId, status: "spawned", threadId });
      } catch (error) {
        // A failed member thread degrades to a recorded failure — never crashes
        // the dispatch, and never blocks the other targets. The employee is freed
        // again so its parked line can proceed.
        this.employeeQueue.markIdle(target.workspaceId);
        this.emitQueueSnapshot();
        targets.push({
          workspaceId: target.workspaceId,
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Terminal bookkeeping: when no member thread actually came up, the run is
    // failed immediately. Live member threads keep the row "running" until the
    // terminal watcher observes their lifecycle and settles the run.
    const spawnedIds = targets
      .filter((target) => target.status === "spawned")
      .map((target) => target.threadId as string);
    if (spawnedIds.length === 0) {
      if (decision.targets.length > 0) {
        await this.recordRun(task, team, decision.policy, targetIds, "failed");
      }
    } else {
      const threadWorkspace = new Map<string, string>();
      for (const target of targets.filter((entry) => entry.status === "spawned")) {
        threadWorkspace.set(target.threadId as string, target.workspaceId);
      }
      this.trackedRuns.set(task.id, {
        teamId: team.id,
        prompt: task.prompt,
        policy: decision.policy,
        targetWorkspaceIds: targetIds,
        createdAt: task.enqueuedAt,
        threadIds: spawnedIds,
        threadWorkspace,
        freed: new Set(),
      });
      for (const threadId of spawnedIds) {
        this.threadToRun.set(threadId, task.id);
      }
    }
    return { taskId: task.id, policy: decision.policy, targets };
  }

  /**
   * Push-driven settlement hook: the supervisor forwards thread-lifecycle
   * events (turn/session/request) here as they stream through. Pull the live
   * statuses of the run's member threads via the injected status source; once
   * every member has reached a terminal state, flip the run row to
   * `completed` (all clean) or `failed` (any error) and forget it.
   *
   * Degrades silently when no status source is wired — the run simply stays
   * `running` until one appears.
   */
  observeThreadEvent(threadId: string): void {
    const runId = this.threadToRun.get(threadId);
    if (!runId) return;
    const run = this.trackedRuns.get(runId);
    if (!run || !this.deps.readMemberThreadStatus) return;
    let sawError = false;
    let allTerminal = true;
    for (const memberThreadId of run.threadIds) {
      const status = this.deps.readMemberThreadStatus(memberThreadId);
      // Unknown status → assume still in flight rather than guessing a terminal.
      if (status === undefined || ACTIVE_THREAD_STATUSES.has(status)) {
        allTerminal = false;
        continue;
      }
      if (status === "error") sawError = true;
      // Free the employee as soon as ITS thread settles (a free-for-all run may
      // still have other members working) and pop the next parked task.
      if (!run.freed.has(memberThreadId)) {
        run.freed.add(memberThreadId);
        const employeeId = run.threadWorkspace.get(memberThreadId);
        if (employeeId) {
          const next = this.employeeQueue.markIdle(employeeId);
          this.emitQueueSnapshot();
          if (next) void this.drainQueuedTask(next);
        }
      }
    }
    // Every member thread has reached a terminal state.
    if (allTerminal) {
      this.settleRun(runId, run, sawError ? "failed" : "completed");
    }
  }

  /** Spawn the next task parked on an employee's line (after its run settled). */
  private emitQueueSnapshot(): void {
    this.deps.onQueueSnapshot?.(this.employeeQueue.snapshot());
  }

  private async drainQueuedTask(entry: EmployeeQueuedTask): Promise<void> {
    const { teams, workspaces } = this.deps.readTeams();
    const team = teams.find((candidate) => candidate.id === entry.teamId);
    if (!team) return;
    const workspace = workspaces.find((candidate) => candidate.id === entry.employeeId);
    if (!workspace) return;
    this.employeeQueue.markBusy(entry.employeeId, entry);
    this.emitQueueSnapshot();
    const task: QueuedTeamTask = {
      id: randomUUID(),
      teamId: team.id,
      prompt: entry.prompt,
      enqueuedAt: entry.enqueuedAt,
      forwardCount: 0,
    };
    const member: TeamMember = {
      workspaceId: workspace.id,
      name: workspace.name ?? workspace.id,
      ...(workspace.agentKind ? { agentKind: workspace.agentKind } : {}),
      ...(workspace.defaultThreadConfig
        ? { defaultThreadConfig: workspace.defaultThreadConfig }
        : {}),
    };
    try {
      const threadId = await this.deps.spawnMemberThread({
        member,
        workspace,
        base: {
          projectLocation: entry.projectLocation,
          config: entry.config,
          initialSize: entry.initialSize,
          prompt: entry.prompt,
        },
        task,
      });
      this.spawnedThreads.set(workspace.id, threadId);
      this.trackedRuns.set(task.id, {
        teamId: team.id,
        prompt: task.prompt,
        policy: "round-robin",
        targetWorkspaceIds: [workspace.id],
        createdAt: task.enqueuedAt,
        threadIds: [threadId],
        threadWorkspace: new Map([[threadId, workspace.id]]),
        freed: new Set(),
      });
      this.threadToRun.set(threadId, task.id);
    } catch {
      // Spawn failure frees the employee again; the parked task line is done.
      this.employeeQueue.markIdle(workspace.id);
      this.emitQueueSnapshot();
    }
  }

  private settleRun(runId: string, run: TrackedTeamRun, status: TeamRunStatus): void {
    this.trackedRuns.delete(runId);
    for (const threadId of run.threadIds) {
      this.threadToRun.delete(threadId);
    }
    if (!this.deps.recordTeamRun) return;
    void this.deps.recordTeamRun({
      id: runId,
      teamId: run.teamId,
      prompt: run.prompt,
      policy: run.policy,
      targetWorkspaceIds: run.targetWorkspaceIds,
      status,
      createdAt: run.createdAt,
      finishedAt: new Date().toISOString(),
    });
  }

  private async recordRun(
    task: QueuedTeamTask,
    team: Team,
    policy: TeamDispatchPolicy,
    targetWorkspaceIds: string[],
    status: TeamRunStatus,
  ): Promise<void> {
    if (!this.deps.recordTeamRun) return;
    await this.deps.recordTeamRun({
      id: task.id,
      teamId: team.id,
      prompt: task.prompt,
      policy,
      targetWorkspaceIds,
      status,
      createdAt: task.enqueuedAt,
      ...(status === "running" ? {} : { finishedAt: new Date().toISOString() }),
    });
  }
}
