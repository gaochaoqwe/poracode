import { z } from "zod";
import { agentKindSchema } from "./common";

const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);

/**
 * When a task runs again on its own: a one-off planned start, an hourly slot, or
 * a set of weekly slots. A plain manual task carries `recurrence: null`.
 *
 * Structurally identical to the device scheduler's recurrence so the shared
 * `nextScheduleRunAt` math applies unchanged.
 */
export const taskRecurrenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hourly"),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({
    kind: z.literal("weekly"),
    days: z.array(z.number().int().min(0).max(6)).min(1),
    time: localTimeSchema,
  }),
  z.object({
    kind: z.literal("once"),
    runAt: z.iso.datetime(),
  }),
]);
export type TaskRecurrence = z.infer<typeof taskRecurrenceSchema>;

/**
 * Where a task's agent runs. `worktree` provisions its own git worktree (and
 * branch) so unattended work can't disturb the project checkout; `project` runs
 * directly in the project directory. Only a git project can host a worktree.
 */
export const taskIsolationSchema = z.enum(["worktree", "project"]);
export type TaskIsolation = z.infer<typeof taskIsolationSchema>;

/**
 * The task's board status. Persisted as-is; the three board lanes are derived
 * from it through {@link taskColumn} so no view branches on the raw value.
 */
export const taskStatusSchema = z.enum([
  "todo",
  "in_progress",
  /**
   * The run is live but parked on the user — the agent asked for permission or
   * an answer and is waiting. Flipped by the run coordinator from the thread's
   * `needs_approval`/`needs_reply` state, and back once it resumes.
   */
  "awaiting_input",
  "done",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** The board lanes. */
export const taskColumnSchema = z.enum(["todo", "inProgress", "attention", "done"]);
export type TaskColumn = z.infer<typeof taskColumnSchema>;

/**
 * Board status → lane. "Needs you" collects everything that wants the user's
 * eyes: a run parked on their input, and a terminal failure. A user stop is not
 * "done", so it returns to Todo where it stays restartable. The single source of
 * truth for the board.
 */
export function taskColumn(status: TaskStatus): TaskColumn {
  switch (status) {
    case "todo":
    case "cancelled":
      return "todo";
    case "in_progress":
      return "inProgress";
    case "awaiting_input":
    case "failed":
      return "attention";
    case "done":
      return "done";
  }
}

/**
 * Outcome of a single run, tracked per {@link taskRunSchema}. Distinct from the
 * board status above; also the value stored in a task's `lastStatus` (which
 * additionally has a `never` sentinel).
 */
export const taskRunStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "interrupted",
  "cancelled",
]);
export type TaskRunStatus = z.infer<typeof taskRunStatusSchema>;

/** A task's quick-glance last-run outcome: `never` until it has run once. */
export const taskLastStatusSchema = z.enum([
  "never",
  "running",
  "succeeded",
  "failed",
  "interrupted",
  "cancelled",
]);
export type TaskLastStatus = z.infer<typeof taskLastStatusSchema>;

export const taskConfigSchema = z.object({
  model: z.string().min(1),
  effort: z.string().optional(),
  fast: z.boolean().optional(),
});
export type TaskConfig = z.infer<typeof taskConfigSchema>;

/**
 * A free-form user classification for a task, e.g. "Billing" or "Docs". It is
 * a plain label rather than a separate entity: the board collects the distinct
 * values in use and offers them back as suggestions, so a category exists as
 * soon as a task carries it. `null` is the explicit "uncategorized" bucket — no
 * task is ever filed under an empty-looking category.
 *
 * Deliberately allows a blank string through the schema so the services can
 * canonicalize it to `null` via {@link normalizeTaskCategory}; a blank is a
 * "clear the category" request, not a validation error. The length cap still
 * bites at the boundary.
 */
export const MAX_TASK_CATEGORY_LENGTH = 40;
export const taskCategorySchema = z.string().trim().max(MAX_TASK_CATEGORY_LENGTH);

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(50_000),
  /**
   * The digital employee (workspace) this task is handed to. The employee owns
   * the provider + model binding, so the task itself no longer asks the user to
   * pick an agent. Optional at the contract level so tasks created before
   * employees existed (and agent-authored tasks that name a provider directly)
   * still parse; the task editor enforces a choice for new work, and
   * {@link import("../../main/tasks/TaskRunCoordinator").TaskRunCoordinator}
   * resolves the runtime provider from the employee when one is set.
   */
  employeeId: z.string().min(1).nullable().optional(),
  agentKind: agentKindSchema,
  config: taskConfigSchema,
  /** The task's category; `null`/omitted means uncategorized. */
  category: taskCategorySchema.nullable().optional(),
  /**
   * Project the run's GUI thread is created in. `null`/omitted means the
   * built-in "Home" scope; a value must reference an existing project row at
   * run time or the run fails.
   */
  projectId: z.string().nullable().optional(),
  isolation: taskIsolationSchema,
  /** `null`/omitted = a plain manual task with no schedule. */
  recurrence: taskRecurrenceSchema.nullable().optional(),
  scheduleEnabled: z.boolean(),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskSchema = taskInputSchema.extend({
  id: z.string().uuid(),
  status: taskStatusSchema,
  worktreePath: z.string().nullable(),
  worktreeBranch: z.string().nullable(),
  /**
   * Manual position in the task's project Todo lane (ascending). Meaningful
   * only when the board is filtered to that project; the "all projects" board
   * falls back to freshest-first. Assigned by the service, never by the client.
   */
  sortOrder: z.number().int(),
  /** The active / most-recent run's GUI thread; null until first started. */
  threadId: z.string().nullable(),
  nextRunAt: z.iso.datetime().nullable(),
  lastRunAt: z.iso.datetime().nullable(),
  lastCompletedAt: z.iso.datetime().nullable(),
  lastStatus: taskLastStatusSchema,
  lastResult: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Task = z.infer<typeof taskSchema>;

export const updateTaskPayloadSchema = z.object({
  id: z.string().uuid(),
  task: taskInputSchema,
});
export type UpdateTaskPayload = z.infer<typeof updateTaskPayloadSchema>;

export const taskIdPayloadSchema = z.object({ id: z.string().uuid() });
export type TaskIdPayload = z.infer<typeof taskIdPayloadSchema>;

/** Manual lane move / reopen of a task on the board. */
export const setTaskStatusPayloadSchema = z.object({
  id: z.string().uuid(),
  status: taskStatusSchema,
});
export type SetTaskStatusPayload = z.infer<typeof setTaskStatusPayloadSchema>;

/**
 * Persist the Todo lane order for one project. `orderedIds` must list exactly
 * the project's Todo tasks (see `TasksService.reorder`), so a board that
 * changed underneath the drag is rejected rather than silently mis-ordered.
 */
export const reorderTasksPayloadSchema = z.object({
  projectId: z.string().min(1),
  orderedIds: z.array(z.string().uuid()).min(1),
});
export type ReorderTasksPayload = z.infer<typeof reorderTasksPayloadSchema>;

/**
 * One execution of a task, linked to the real GUI thread it created. A task
 * keeps a bounded history of these (newest first) alongside its quick-glance
 * `lastStatus` summary.
 */
export const taskRunSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  threadId: z.string().uuid(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  status: taskRunStatusSchema,
  summary: z.string().nullable(),
  error: z.string().nullable(),
});
export type TaskRun = z.infer<typeof taskRunSchema>;

export const getTaskRunsPayloadSchema = z.object({ id: z.string().uuid() });
export type GetTaskRunsPayload = z.infer<typeof getTaskRunsPayloadSchema>;

/** Run history for one task, newest first (capped). */
export type GetTaskRunsResult = TaskRun[];
