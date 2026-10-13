import { taskRunSchema, type TaskRun } from "@/shared/contracts";
import { getSqlite } from "./connection";

/** Keep at most this many run rows per task; older rows are pruned on insert. */
const MAX_RUNS_PER_TASK = 20;

interface TaskRunRow {
  id: string;
  task_id: string;
  thread_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  summary: string | null;
  error: string | null;
}

function fromRow(row: TaskRunRow): TaskRun {
  return taskRunSchema.parse({
    id: row.id,
    taskId: row.task_id,
    threadId: row.thread_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    summary: row.summary,
    error: row.error,
  });
}

export function dbInsertTaskRun(run: TaskRun): void {
  const parsed = taskRunSchema.parse(run);
  getSqlite()
    .prepare(
      `INSERT INTO task_runs (
        id, task_id, thread_id, started_at, completed_at, status, summary, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      parsed.id,
      parsed.taskId,
      parsed.threadId,
      parsed.startedAt,
      parsed.completedAt,
      parsed.status,
      parsed.summary,
      parsed.error,
    );
  pruneTaskRuns(parsed.taskId);
}

export interface TaskRunPatch {
  completedAt?: string | null;
  status?: TaskRun["status"];
  summary?: string | null;
  error?: string | null;
}

export function dbUpdateTaskRun(id: string, patch: TaskRunPatch): void {
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if ("completedAt" in patch) {
    sets.push("completed_at = ?");
    values.push(patch.completedAt ?? null);
  }
  if ("status" in patch && patch.status !== undefined) {
    sets.push("status = ?");
    values.push(patch.status);
  }
  if ("summary" in patch) {
    sets.push("summary = ?");
    values.push(patch.summary ?? null);
  }
  if ("error" in patch) {
    sets.push("error = ?");
    values.push(patch.error ?? null);
  }
  if (sets.length === 0) return;
  values.push(id);
  getSqlite()
    .prepare(`UPDATE task_runs SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);
}

export function dbListTaskRuns(taskId: string, limit = MAX_RUNS_PER_TASK): TaskRun[] {
  const rows = getSqlite()
    .prepare(
      `SELECT * FROM task_runs
       WHERE task_id = ?
       ORDER BY started_at DESC, rowid DESC
       LIMIT ?`,
    )
    .all(taskId, limit) as TaskRunRow[];
  return rows.map(fromRow);
}

export function dbDeleteTaskRuns(taskId: string): void {
  getSqlite().prepare("DELETE FROM task_runs WHERE task_id = ?").run(taskId);
}

/**
 * Force-fail dangling `running` rows for a task on startup (their host process
 * is gone, so the run can never settle). Used by the task service's post-startup
 * normalization.
 */
export function dbInterruptTaskRuns(taskId: string, completedAt: string): void {
  getSqlite()
    .prepare(
      "UPDATE task_runs SET status = 'interrupted', completed_at = ? WHERE task_id = ? AND status = 'running'",
    )
    .run(completedAt, taskId);
}

function pruneTaskRuns(taskId: string): void {
  getSqlite()
    .prepare(
      `DELETE FROM task_runs
       WHERE task_id = ?
         AND id NOT IN (
           SELECT id FROM task_runs
           WHERE task_id = ?
           ORDER BY started_at DESC, rowid DESC
           LIMIT ?
         )`,
    )
    .run(taskId, taskId, MAX_RUNS_PER_TASK);
}
