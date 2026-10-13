import { randomUUID } from "node:crypto";
import {
  normalizeTaskCategory,
  taskColumn,
  taskInputSchema,
  type Task,
  type TaskInput,
  type TaskRecurrence,
  type TaskRunStatus,
  type TaskStatus,
} from "@/shared/contracts";
import { nextScheduleRunAt } from "@/shared/schedules";
import type { TaskRunOutcome } from "./TaskRunCoordinator";

export interface TaskStore {
  list(): Task[];
  get(id: string): Task | null;
  upsert(task: Task): void;
  delete(id: string): void;
  setSortOrders(entries: readonly { id: string; sortOrder: number }[]): void;
}

export interface TasksServiceOptions {
  store: TaskStore;
  /** Executes one run of a task; resolves with the run's outcome. */
  runTask(task: Task): Promise<TaskRunOutcome>;
  /** Stop a task's live run: detach it and interrupt its thread. */
  cancelRun(taskId: string): Promise<void>;
  /**
   * Called during post-startup normalization for each task left in a running
   * state by a previous process, so the run-history layer can mark its dangling
   * run rows "interrupted".
   */
  onStartupInterrupted?(taskId: string): void;
  now?: () => number;
  tickIntervalMs?: number;
}

/**
 * Owns the task board's data: CRUD, the scheduled due-check tick, manual
 * start/stop, and post-startup normalization. Runs are delegated to the
 * {@link TaskRunCoordinator}; this service only projects their outcome back onto
 * the task's board status.
 */
export class TasksService {
  private readonly runningIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(private readonly options: TasksServiceOptions) {}

  start(): void {
    if (this.timer || this.disposed) return;
    this.normalizeAfterStartup();
    this.timer = setInterval(() => this.tick(), this.options.tickIntervalMs ?? 15_000);
    this.timer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list(): Task[] {
    return this.options.store.list();
  }

  get(id: string): Task | null {
    return this.options.store.get(id);
  }

  create(input: TaskInput): Task {
    const parsed = this.normalizeInput(input);
    const now = this.now();
    const { scheduleEnabled, nextRunAt } = this.resolveEnablement(
      parsed.recurrence ?? null,
      parsed.scheduleEnabled,
      now,
    );
    const task: Task = {
      id: randomUUID(),
      ...parsed,
      status: "todo",
      worktreePath: null,
      worktreeBranch: null,
      threadId: null,
      sortOrder: this.nextSortOrder(parsed.projectId ?? null),
      scheduleEnabled,
      nextRunAt,
      lastRunAt: null,
      lastCompletedAt: null,
      lastStatus: "never",
      lastResult: null,
      lastError: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
    this.options.store.upsert(task);
    return task;
  }

  update(id: string, input: TaskInput): Task {
    const current = this.requireTask(id);
    const parsed = this.normalizeInput(input);
    const now = this.now();
    const { scheduleEnabled, nextRunAt } = this.resolveEnablement(
      parsed.recurrence ?? null,
      parsed.scheduleEnabled,
      now,
    );
    const task: Task = {
      ...current,
      ...parsed,
      scheduleEnabled,
      nextRunAt,
      updatedAt: new Date(now).toISOString(),
    };
    this.options.store.upsert(task);
    return task;
  }

  delete(id: string): void {
    this.options.store.delete(id);
  }

  /**
   * Persist the Todo-lane order for one project. `orderedIds` must be exactly
   * that project's Todo tasks — a board that changed under the drag (a run
   * started, a task moved) is rejected so a stale order can't silently scramble
   * the lane. Ids are normalized to a dense 0..n-1 range.
   */
  reorder(projectId: string, orderedIds: readonly string[]): Task[] {
    const projectTodo = this.options.store
      .list()
      .filter(
        (task) => (task.projectId ?? null) === projectId && taskColumn(task.status) === "todo",
      );
    const expected = new Set(projectTodo.map((task) => task.id));
    const seen = new Set<string>();
    for (const id of orderedIds) {
      if (!expected.has(id) || seen.has(id)) {
        throw new Error("The task board changed; refresh and try again.");
      }
      seen.add(id);
    }
    if (seen.size !== expected.size) {
      throw new Error("The task board changed; refresh and try again.");
    }
    this.options.store.setSortOrders(orderedIds.map((id, index) => ({ id, sortOrder: index })));
    return this.list();
  }

  /** Manual lane move / reopen from the board. */
  setStatus(id: string, status: TaskStatus): Task {
    const current = this.requireTask(id);
    const task: Task = { ...current, status, updatedAt: this.nowIso() };
    this.options.store.upsert(task);
    return task;
  }

  /** Run a task now, without touching its schedule (a manual "start"). */
  runNow(id: string): Task {
    return this.startRun(this.requireTask(id), false);
  }

  /** Stop a live run: detach it, interrupt its thread, return the card to Todo. */
  async stop(id: string): Promise<Task> {
    const task = this.requireTask(id);
    await this.options.cancelRun(id);
    this.runningIds.delete(id);
    if (this.disposed) return this.requireTask(id);
    const current = this.options.store.get(id) ?? task;
    const now = this.nowIso();
    const stopped: Task = {
      ...current,
      status: "cancelled",
      lastCompletedAt: now,
      lastStatus: "cancelled",
      lastResult: null,
      lastError: null,
      updatedAt: now,
    };
    this.options.store.upsert(stopped);
    return stopped;
  }

  tick(): void {
    if (this.disposed) return;
    const now = this.now();
    for (const task of this.options.store.list()) {
      if (!task.recurrence || !task.scheduleEnabled || !task.nextRunAt) continue;
      if (Date.parse(task.nextRunAt) > now) continue;
      this.startRun(task, true);
    }
  }

  private startRun(task: Task, advanceSchedule: boolean): Task {
    if (this.runningIds.has(task.id)) return this.requireTask(task.id);

    const now = this.now();
    const recurs = advanceSchedule && task.recurrence != null;
    const nextRunAt = recurs ? nextScheduleRunAt(task.recurrence!, now) : task.nextRunAt;
    const running: Task = {
      ...task,
      ...(recurs ? { scheduleEnabled: task.scheduleEnabled && nextRunAt !== null, nextRunAt } : {}),
      status: "in_progress",
      lastRunAt: new Date(now).toISOString(),
      lastCompletedAt: null,
      lastStatus: "running",
      lastResult: null,
      lastError: null,
      updatedAt: new Date(now).toISOString(),
    };
    this.runningIds.add(task.id);
    this.options.store.upsert(running);

    void this.options
      .runTask(running)
      .then((outcome) => this.settle(task.id, outcome))
      .catch((error: unknown) =>
        this.settle(task.id, {
          threadId: "",
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return running;
  }

  private settle(id: string, outcome: TaskRunOutcome): void {
    this.runningIds.delete(id);
    if (this.disposed) return;
    const current = this.options.store.get(id);
    if (!current) return;
    const now = this.now();
    this.options.store.upsert({
      ...current,
      status: this.boardStatusAfterRun(current, outcome, now),
      lastCompletedAt: new Date(now).toISOString(),
      lastStatus: outcome.status satisfies TaskRunStatus,
      lastResult: outcome.status === "succeeded" ? "" : null,
      lastError: outcome.error,
      updatedAt: new Date(now).toISOString(),
    });
  }

  /**
   * Project a finished run onto the board. A once-task (or a one-off manual run
   * of a task with no recurrence) settles terminally; a recurring task returns
   * to Todo so its next occurrence stays actionable. A user stop is not "done",
   * so it goes back to Todo too.
   */
  private boardStatusAfterRun(task: Task, outcome: TaskRunOutcome, now: number): TaskStatus {
    if (outcome.status === "cancelled") return "cancelled";
    const recurring =
      task.recurrence != null &&
      task.scheduleEnabled &&
      task.nextRunAt != null &&
      Date.parse(task.nextRunAt) > now;
    if (outcome.status === "succeeded") return recurring ? "todo" : "done";
    return recurring ? "todo" : "failed";
  }

  private normalizeAfterStartup(): void {
    const now = this.now();
    for (const task of this.options.store.list()) {
      const { scheduleEnabled, nextRunAt } = this.resolveEnablement(
        task.recurrence ?? null,
        task.scheduleEnabled,
        now,
      );
      const wasRunning =
        task.lastStatus === "running" ||
        task.status === "in_progress" ||
        task.status === "awaiting_input";
      if (wasRunning) this.options.onStartupInterrupted?.(task.id);
      this.options.store.upsert({
        ...task,
        scheduleEnabled,
        nextRunAt,
        ...(wasRunning
          ? {
              status: "todo" as const,
              lastCompletedAt: new Date(now).toISOString(),
              lastStatus: "interrupted" as const,
              lastError: null,
            }
          : {}),
        updatedAt: new Date(now).toISOString(),
      });
    }
  }

  private normalizeInput(input: TaskInput): TaskInput {
    const parsed = taskInputSchema.parse(input);
    const recurrence = parsed.recurrence ?? null;
    const category = normalizeTaskCategory(parsed.category ?? null);
    // An empty employee id is a "no owner" request, not a validation error, so
    // it canonicalizes to null exactly like a cleared category.
    const employeeId = parsed.employeeId?.trim() ? parsed.employeeId.trim() : null;
    if (recurrence?.kind !== "weekly") {
      return { ...parsed, employeeId, category, recurrence };
    }
    return {
      ...parsed,
      employeeId,
      category,
      recurrence: {
        ...recurrence,
        days: [...new Set(recurrence.days)].sort((left, right) => left - right),
      },
    };
  }

  /**
   * A task is only scheduled when it has a recurrence AND a future run to fire,
   * so enablement and `nextRunAt` are always resolved together. A manual task
   * (no recurrence) is never scheduled.
   */
  private resolveEnablement(
    recurrence: TaskRecurrence | null,
    enabled: boolean,
    now: number,
  ): { scheduleEnabled: boolean; nextRunAt: string | null } {
    if (!recurrence) return { scheduleEnabled: false, nextRunAt: null };
    const nextRunAt = enabled ? nextScheduleRunAt(recurrence, now) : null;
    return { scheduleEnabled: enabled && nextRunAt !== null, nextRunAt };
  }

  private requireTask(id: string): Task {
    const task = this.options.store.get(id);
    if (!task) throw new Error("Task not found.");
    return task;
  }

  /**
   * A new task lands at the TOP of its project's Todo lane (`min - 1`), matching
   * the freshest-first order of the other lanes. Empty scope starts at 0.
   */
  private nextSortOrder(projectId: string | null): number {
    const orders = this.options.store
      .list()
      .filter((task) => (task.projectId ?? null) === projectId)
      .map((task) => task.sortOrder);
    return orders.length === 0 ? 0 : Math.min(...orders) - 1;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }
}
