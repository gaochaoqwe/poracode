import { taskDraftSchema, type TaskDraft } from "@/shared/contracts";
import { getSqlite } from "./connection";

interface TaskDraftRow {
  id: string;
  title: string;
  note: string | null;
  category: string | null;
  employee_id: string | null;
  project_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function fromRow(row: TaskDraftRow): TaskDraft {
  return taskDraftSchema.parse({
    id: row.id,
    title: row.title,
    note: row.note,
    category: row.category,
    employeeId: row.employee_id,
    projectId: row.project_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function dbGetTaskDrafts(): TaskDraft[] {
  const rows = getSqlite()
    .prepare("SELECT * FROM task_drafts ORDER BY sort_order ASC, created_at ASC")
    .all() as TaskDraftRow[];
  return rows.map(fromRow);
}

export function dbGetTaskDraft(id: string): TaskDraft | null {
  const row = getSqlite().prepare("SELECT * FROM task_drafts WHERE id = ?").get(id) as
    | TaskDraftRow
    | undefined;
  return row ? fromRow(row) : null;
}

export function dbUpsertTaskDraft(draft: TaskDraft): void {
  const parsed = taskDraftSchema.parse(draft);
  getSqlite()
    .prepare(
      `INSERT INTO task_drafts (
        id, title, note, category, employee_id, project_id, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        note = excluded.note,
        category = excluded.category,
        employee_id = excluded.employee_id,
        project_id = excluded.project_id,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at`,
    )
    .run(
      parsed.id,
      parsed.title,
      parsed.note ?? null,
      parsed.category ?? null,
      parsed.employeeId ?? null,
      parsed.projectId ?? null,
      parsed.sortOrder,
      parsed.createdAt,
      parsed.updatedAt,
    );
}

export function dbDeleteTaskDraft(id: string): void {
  getSqlite().prepare("DELETE FROM task_drafts WHERE id = ?").run(id);
}

/**
 * Rewrite the manual order of a set of drafts in one transaction. Deliberately
 * does not touch `updatedAt`: a reorder is not activity.
 */
export function dbSetTaskDraftSortOrders(
  entries: readonly { id: string; sortOrder: number }[],
): void {
  if (entries.length === 0) return;
  const sqlite = getSqlite();
  const update = sqlite.prepare("UPDATE task_drafts SET sort_order = ? WHERE id = ?");
  sqlite.transaction(() => {
    for (const entry of entries) update.run(entry.sortOrder, entry.id);
  })();
}
