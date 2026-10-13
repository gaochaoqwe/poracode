import { randomUUID } from "node:crypto";
import type {
  AgentStatusesResponse,
  GitAddWorktreePayload,
  GitAddWorktreeResult,
  Project,
  ProjectLocation,
  RemoteThreadCommand,
  StartThreadPayload,
  Task,
  TaskRun,
  Thread,
  ThreadConfig,
  ThreadStatus,
} from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";
import { DEFAULT_TERMINAL_SIZE, resolveMcpLaunchSnapshot } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import { buildWorktreeLocation, resolveWorktreePlacement } from "@/shared/worktree";
import type { TaskRunPatch } from "../db/taskRuns";
import { resolveUnrestrictedThreadPermissions } from "../threads/threadLaunchConfig";

/**
 * A `thread-state` transition ends the run only once the turn fully settles.
 * `needs_approval`/`needs_reply` are mid-turn pauses (they can resume under
 * auto-approval), so they are NOT terminal; that avoids settling a run while its
 * thread keeps working.
 */
const TERMINAL_STATUSES: ReadonlySet<ThreadStatus> = new Set<ThreadStatus>([
  "idle",
  "finished",
  "inactive",
  "error",
]);

/** Outcome of one run, projected by the service onto the task's board status. */
export interface TaskRunOutcome {
  threadId: string;
  status: "succeeded" | "failed" | "cancelled";
  error: string | null;
}

/**
 * The slice of a digital employee (workspace) a task run needs: which provider
 * and model to launch, and the auth instance to run as. Mirrors the workspace
 * fields `WorkspaceEmployeeEditor` writes, so a task never has to carry its own
 * agent binding while still being able to name a provider directly (legacy and
 * agent-authored tasks).
 */
export interface EmployeeBinding {
  id: string;
  /** Human-readable employee name, used for the thread title fallback. */
  name: string;
  agentKind?: string | undefined;
  agentInstanceId?: string | undefined;
  model?: string | undefined;
  effort?: string | undefined;
  fast?: boolean | undefined;
}

export interface TaskRunCoordinatorDeps {
  /** Launch the child session in the supervisor (main → supervisor request). */
  startThread(payload: StartThreadPayload): Promise<unknown>;
  /** Interrupt a live thread (main → supervisor request). */
  interruptThread(threadId: string): Promise<unknown>;
  /** Cached agent detection for the given WSL distros (supervisor request). */
  getAgentStatuses(wslDistros: string[]): Promise<AgentStatusesResponse>;
  /** Create/reuse a git worktree (supervisor request). */
  addWorktree(payload: GitAddWorktreePayload): Promise<GitAddWorktreeResult>;
  /** Mirror a thread command to the renderer store; false when no window is up. */
  sendThreadCommand(command: RemoteThreadCommand): boolean;
  /** Resolve (creating if absent) the persisted home-scope project row. */
  ensureHomeProject(): Project;
  /** Resolve a persisted project row by id, or null when it no longer exists. */
  getProject(projectId: string): Project | null;
  /** Current global settings (worktree placement + MCP launch snapshot). */
  getSharedSettings(): SharedSettings;
  /**
   * Resolve a digital employee (workspace) by id, or null when it was deleted.
   * A task's provider/model binding lives on its employee, so the run resolves
   * the employee first and only falls back to the task's own stored
   * `agentKind`/`config` when the task carries no employee.
   */
  getEmployee(employeeId: string): EmployeeBinding | null;
  upsertThread(thread: Thread, sortOrder: number): void;
  deleteThread(threadId: string): void;
  threadExists(threadId: string): boolean;
  /** Persist updated task fields (worktree path/branch, thread link) mid-run. */
  upsertTask(task: Task): void;
  /**
   * Flip a live run between `in_progress` and `awaiting_input` — the agent
   * parked on the user's permission/answer, or resumed. Drives the board's
   * "Needs you" lane.
   */
  setTaskAwaiting(taskId: string, awaiting: boolean): void;
  insertRun(run: TaskRun): void;
  updateRun(id: string, patch: TaskRunPatch): void;
  now?: () => number;
  newId?: () => string;
}

interface PendingRun {
  taskId: string;
  runId: string;
  sawActive: boolean;
  resolve: (outcome: TaskRunOutcome) => void;
}

/**
 * Runs a task as a REAL GUI thread (persisted, sidebar-visible) — optionally
 * inside its own git worktree — and records a run-history row linked to that
 * thread. Derived from the device scheduler's coordinator.
 *
 * Unlike the scheduler's, the returned promise never rejects: launch-level
 * errors resolve to a `failed` outcome so the service can uniformly project the
 * result onto the board.
 */
export class TaskRunCoordinator {
  private readonly pending = new Map<string, PendingRun>();

  constructor(private readonly deps: TaskRunCoordinatorDeps) {}

  /** Wire into the supervisor event tap (main.ts `onEvent`). */
  observeSupervisorEvent(event: SupervisorEvent): void {
    if (event.type !== "thread-state") return;
    const run = this.pending.get(event.threadId);
    if (!run) return;

    if (event.status === "launching" || event.status === "working") {
      run.sawActive = true;
      // Resumed after a pause, or started: the run isn't waiting on anyone.
      this.deps.setTaskAwaiting(run.taskId, false);
      return;
    }
    if (event.status === "needs_approval" || event.status === "needs_reply") {
      // Mid-turn pause — the turn is still active, but the agent is blocked on
      // the user, so the card moves to "Needs you" until it resumes.
      this.deps.setTaskAwaiting(run.taskId, true);
      return;
    }
    if (!TERMINAL_STATUSES.has(event.status)) return;
    // "inactive" before the run ever became active is a stale pre-launch echo.
    if (event.status === "inactive" && !run.sawActive) return;

    this.pending.delete(event.threadId);
    const completedAt = this.nowIso();
    if (event.status === "error") {
      const error = event.errorMessage ?? "Task run failed.";
      this.deps.updateRun(run.runId, { completedAt, status: "failed", error });
      run.resolve({ threadId: event.threadId, status: "failed", error });
      return;
    }
    this.deps.updateRun(run.runId, { completedAt, status: "succeeded" });
    // Final assistant text is not captured in main without heavy runtime-event
    // plumbing, so the summary stays null.
    run.resolve({ threadId: event.threadId, status: "succeeded", error: null });
  }

  async runTaskAsThread(task: Task): Promise<TaskRunOutcome> {
    let project: Project;
    try {
      project = this.resolveProject(task);
    } catch (error) {
      return this.failed(error);
    }

    // The employee owns the provider/model binding. Resolve it first so the run
    // launches as that employee's agent and the created thread is filed under
    // the employee — falling back to the task's own stored binding when the
    // task has no employee (legacy rows, agent-authored tasks) rather than
    // reverting to some unrelated provider.
    const employee = task.employeeId ? this.deps.getEmployee(task.employeeId) : null;
    if (task.employeeId && !employee) {
      return this.failed(new Error("The employee this task is assigned to no longer exists."));
    }
    const agentKind = employee?.agentKind ?? task.agentKind;
    if (!agentKind) {
      return this.failed(
        new Error("This task's employee has no agent configured; set one on the employee first."),
      );
    }
    const model = employee?.model ?? task.config.model;
    const modelConfig = {
      model,
      ...(employee?.effort !== undefined
        ? { effort: employee.effort }
        : task.config.effort !== undefined
          ? { effort: task.config.effort }
          : {}),
      ...(employee?.fast !== undefined
        ? { fast: employee.fast }
        : task.config.fast !== undefined
          ? { fast: task.config.fast }
          : {}),
    };

    let worktreePath = task.worktreePath;
    let worktreeBranch = task.worktreeBranch;
    if (task.isolation === "worktree" && !worktreePath) {
      try {
        const provisioned = await this.provisionWorktree(task, project);
        worktreePath = provisioned.path;
        worktreeBranch = provisioned.branch;
        this.deps.upsertTask({
          ...task,
          worktreePath,
          worktreeBranch,
          updatedAt: this.nowIso(),
        });
      } catch (error) {
        return this.failed(error);
      }
    }

    const location: ProjectLocation = worktreePath
      ? buildWorktreeLocation(project.location, worktreePath)
      : project.location;
    const threadId = (this.deps.newId ?? randomUUID)();
    const nowIso = this.nowIso();

    const config = await this.buildThreadConfig(agentKind, modelConfig, location);
    const thread: Thread = {
      id: threadId,
      projectId: project.id,
      title: task.title,
      agentKind,
      config,
      status: "launching",
      attention: "none",
      canResumeWithConfig: false,
      archived: false,
      done: false,
      starred: false,
      presentationMode: "gui",
      threadStatusSource: "server",
      ...(employee ? { workspaceId: employee.id } : {}),
      ...(worktreePath ? { worktreePath } : {}),
      ...(worktreeBranch ? { worktreeBranch } : {}),
      createdAt: nowIso,
      updatedAt: nowIso,
      activeTurnStartedAt: nowIso,
    };

    const existed = this.deps.threadExists(threadId);
    // New rows sort to the top via a descending timestamp (same convention as
    // the orchestrator bridge and the remote-access server).
    this.deps.upsertThread(thread, -Date.now());
    // Persist the binding that actually ran, so a legacy task without an
    // employee still records the provider it resolved to.
    this.deps.upsertTask({
      ...task,
      agentKind,
      config: modelConfig,
      threadId,
      worktreePath,
      worktreeBranch,
      updatedAt: nowIso,
    });

    // Mirror to the renderer; a forwarded title is authoritative and disables
    // AI title generation. `false` from sendThreadCommand (no window) is
    // expected and must not fail the run.
    this.deps.sendThreadCommand({
      kind: "start",
      threadId,
      projectId: project.id,
      agentKind,
      config,
      prompt: task.prompt,
      title: task.title,
      presentationMode: "gui",
      launchRuntime: false,
      focus: false,
      ...(employee ? { workspaceId: employee.id } : {}),
    });

    const run: TaskRun = {
      id: (this.deps.newId ?? randomUUID)(),
      taskId: task.id,
      threadId,
      startedAt: nowIso,
      completedAt: null,
      status: "running",
      summary: null,
      error: null,
    };
    this.deps.insertRun(run);

    const settled = new Promise<TaskRunOutcome>((resolve) => {
      this.pending.set(threadId, { taskId: task.id, runId: run.id, sawActive: false, resolve });
    });

    const startPayload: StartThreadPayload = {
      threadId,
      projectLocation: location,
      agentKind,
      config,
      prompt: task.prompt,
      initialSize: DEFAULT_TERMINAL_SIZE,
      presentationMode: "gui",
      ...(employee ? { workspaceId: employee.id } : {}),
      ...resolveMcpLaunchSnapshot(this.deps.getSharedSettings(), project.mcpServers ?? []),
    };

    try {
      await this.deps.startThread(startPayload);
    } catch (error) {
      this.pending.delete(threadId);
      const message = error instanceof Error ? error.message : String(error);
      this.deps.updateRun(run.id, {
        completedAt: this.nowIso(),
        status: "failed",
        error: message,
      });
      // Roll back the fresh row (follow the orchestrator bridge): drop it from
      // the DB and tell the renderer to forget it, but keep a pre-existing row.
      if (!existed) {
        this.deps.deleteThread(threadId);
        this.deps.sendThreadCommand({ kind: "delete", threadId });
      }
      return { threadId, status: "failed", error: message };
    }

    return settled;
  }

  /**
   * Detach a task's live run and interrupt its thread. Returns true when a
   * pending run was detached (so the caller knows the run-history row was
   * closed as cancelled).
   */
  async cancelRun(taskId: string): Promise<boolean> {
    let entry: PendingRun | undefined;
    let threadId: string | undefined;
    for (const [id, run] of this.pending) {
      if (run.taskId === taskId) {
        entry = run;
        threadId = id;
        break;
      }
    }
    if (!entry || threadId === undefined) return false;

    // Remove first: the interrupt's subsequent `thread-state idle` must not
    // re-settle a run we are closing by hand.
    this.pending.delete(threadId);
    this.deps.updateRun(entry.runId, { completedAt: this.nowIso(), status: "cancelled" });
    entry.resolve({ threadId, status: "cancelled", error: null });
    await this.deps.interruptThread(threadId).catch(() => undefined);
    return true;
  }

  private async provisionWorktree(
    task: Task,
    project: Project,
  ): Promise<{ path: string; branch: string }> {
    const branch = `agentemployee/task-${task.id.slice(0, 8)}`;
    const placement = resolveWorktreePlacement(
      this.deps.getSharedSettings(),
      project.worktreeLocation,
      project.location,
    );
    const copyIgnoredPatterns = project.scripts?.worktreeCopyPatterns;
    const result = await this.deps.addWorktree({
      projectLocation: project.location,
      branch,
      createBranch: true,
      ...(placement.root ? { worktreeRoot: placement.root } : {}),
      ...(placement.omitRepoDir ? { worktreeOmitRepoDir: true } : {}),
      ...(copyIgnoredPatterns?.length ? { copyIgnoredPatterns } : {}),
      transferUncommitted: false,
      keepChangesInSource: false,
    });
    return { path: result.path, branch };
  }

  /**
   * Resolve the project the run's thread lives in. A null/absent `projectId`
   * uses the built-in Home scope; a set id must still reference an existing
   * project row — if the user deleted it, fail the run with a clear message.
   */
  private resolveProject(task: Task): Project {
    if (task.projectId == null) return this.deps.ensureHomeProject();
    const project = this.deps.getProject(task.projectId);
    if (!project) throw new Error("Project no longer exists.");
    return project;
  }

  private async buildThreadConfig(
    agentKind: string,
    modelConfig: ThreadConfig,
    location: ProjectLocation,
  ): Promise<ThreadConfig> {
    return {
      ...modelConfig,
      ...(await resolveUnrestrictedThreadPermissions(
        this.deps.getAgentStatuses,
        agentKind,
        location,
      )),
    };
  }

  private failed(error: unknown): TaskRunOutcome {
    return {
      threadId: "",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  private nowIso(): string {
    return new Date((this.deps.now ?? Date.now)()).toISOString();
  }
}
