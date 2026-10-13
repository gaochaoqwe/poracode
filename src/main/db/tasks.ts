import { taskConfigSchema, taskRecurrenceSchema, taskSchema, type Task } from "@/shared/contracts";
import { getSqlite } from "./connection";

interface TaskRow {
  id: string;
  title: string;
  prompt: string;
  employee_id: string | null;
  agent_kind: string;
  config: string;
  category: string | null;
  project_id: string | null;
  isolation: string;
  worktree_path: string | null;
  worktree_branch: string | null;
  thread_id: string | null;
  recurrence: string | null;
  schedule_enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_completed_at: string | null;
  last_status: string;
  last_result: string | null;
  last_error: string | null;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function fromRow(row: TaskRow): Task {
  return taskSchema.parse({
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    employeeId: row.employee_id,
    agentKind: row.agent_kind,
    config: taskConfigSchema.parse(JSON.parse(row.config)),
    category: row.category,
    projectId: row.project_id,
    isolation: row.isolation,
    worktreePath: row.worktree_path,
    worktreeBranch: row.worktree_branch,
    threadId: row.thread_id,
    recurrence:
      row.recurrence == null ? null : taskRecurrenceSchema.parse(JSON.parse(row.recurrence)),
    scheduleEnabled: row.schedule_enabled === 1,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastCompletedAt: row.last_completed_at,
    lastStatus: row.last_status,
    lastResult: row.last_result,
    lastError: row.last_error,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function dbGetTasks(): Task[] {
  const rows = getSqlite()
    .prepare("SELECT * FROM tasks ORDER BY sort_order ASC, created_at ASC")
    .all() as TaskRow[];
  return rows.map(fromRow);
}

export function dbGetTask(id: string): Task | null {
  const row = getSqlite().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  return row ? fromRow(row) : null;
}

export function dbUpsertTask(task: Task): void {
  const parsed = taskSchema.parse(task);
  getSqlite()
    .prepare(
      `INSERT INTO tasks (
        id, title, prompt, employee_id, agent_kind, config, category, project_id, isolation,
        worktree_path, worktree_branch, thread_id,
        recurrence, schedule_enabled, next_run_at, last_run_at, last_completed_at,
        last_status, last_result, last_error, status, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        prompt = excluded.prompt,
        employee_id = excluded.employee_id,
        agent_kind = excluded.agent_kind,
        config = excluded.config,
        category = excluded.category,
        project_id = excluded.project_id,
        isolation = excluded.isolation,
        worktree_path = excluded.worktree_path,
        worktree_branch = excluded.worktree_branch,
        thread_id = excluded.thread_id,
        recurrence = excluded.recurrence,
        schedule_enabled = excluded.schedule_enabled,
        next_run_at = excluded.next_run_at,
        last_run_at = excluded.last_run_at,
        last_completed_at = excluded.last_completed_at,
        last_status = excluded.last_status,
        last_result = excluded.last_result,
        last_error = excluded.last_error,
        status = excluded.status,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at`,
    )
    .run(
      parsed.id,
      parsed.title,
      parsed.prompt,
      parsed.employeeId ?? null,
      parsed.agentKind,
      JSON.stringify(parsed.config),
      parsed.category ?? null,
      parsed.projectId ?? null,
      parsed.isolation,
      parsed.worktreePath,
      parsed.worktreeBranch,
      parsed.threadId,
      parsed.recurrence == null ? null : JSON.stringify(parsed.recurrence),
      parsed.scheduleEnabled ? 1 : 0,
      parsed.nextRunAt,
      parsed.lastRunAt,
      parsed.lastCompletedAt,
      parsed.lastStatus,
      parsed.lastResult,
      parsed.lastError,
      parsed.status,
      parsed.sortOrder,
      parsed.createdAt,
      parsed.updatedAt,
    );
}

export function dbDeleteTask(id: string): void {
  getSqlite().prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

/**
 * Flip a live run between `in_progress` and `awaiting_input` (the agent parked
 * on the user's permission/answer). Guarded to the two live statuses so a run
 * that already settled — done, failed, stopped — can't be resurrected by a late
 * event.
 */
export function dbSetTaskAwaiting(id: string, awaiting: boolean, updatedAt: string): void {
  getSqlite()
    .prepare(
      "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status IN ('in_progress', 'awaiting_input')",
    )
    .run(awaiting ? "awaiting_input" : "in_progress", updatedAt, id);
}

/**
 * Rewrite the manual order of a set of tasks in one transaction. Deliberately
 * does not touch `updatedAt`: a reorder is not activity, and bumping it would
 * reshuffle the freshest-first lanes.
 */
export function dbSetTaskSortOrders(entries: readonly { id: string; sortOrder: number }[]): void {
  if (entries.length === 0) return;
  const sqlite = getSqlite();
  const update = sqlite.prepare("UPDATE tasks SET sort_order = ? WHERE id = ?");
  sqlite.transaction(() => {
    for (const entry of entries) update.run(entry.sortOrder, entry.id);
  })();
}
