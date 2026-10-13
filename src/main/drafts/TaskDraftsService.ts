import { randomUUID } from "node:crypto";
import {
  normalizeTaskCategory,
  taskDraftInputSchema,
  type TaskDraft,
  type TaskDraftInput,
} from "@/shared/contracts";

export interface TaskDraftStore {
  list(): TaskDraft[];
  get(id: string): TaskDraft | null;
  upsert(draft: TaskDraft): void;
  delete(id: string): void;
  setSortOrders(entries: readonly { id: string; sortOrder: number }[]): void;
}

export interface TaskDraftsServiceOptions {
  store: TaskDraftStore;
  now?: () => number;
}

/**
 * Owns the board's draft lane: lightweight ideas (title + note) that aren't
 * tasks yet. No runs, no worktrees, no scheduling — so this stays a plain CRUD
 * service with a manual order, unlike {@link TasksService}.
 */
export class TaskDraftsService {
  constructor(private readonly options: TaskDraftsServiceOptions) {}

  list(): TaskDraft[] {
    return this.options.store.list();
  }

  get(id: string): TaskDraft | null {
    return this.options.store.get(id);
  }

  create(input: TaskDraftInput): TaskDraft {
    const parsed = taskDraftInputSchema.parse(input);
    const now = this.nowIso();
    const draft: TaskDraft = {
      id: randomUUID(),
      title: parsed.title,
      note: parsed.note ?? null,
      category: normalizeTaskCategory(parsed.category ?? null),
      employeeId: parsed.employeeId?.trim() ? parsed.employeeId.trim() : null,
      projectId: parsed.projectId ?? null,
      sortOrder: this.nextSortOrder(parsed.projectId ?? null),
      createdAt: now,
      updatedAt: now,
    };
    this.options.store.upsert(draft);
    return draft;
  }

  update(id: string, input: TaskDraftInput): TaskDraft {
    const current = this.requireDraft(id);
    const parsed = taskDraftInputSchema.parse(input);
    const next: TaskDraft = {
      ...current,
      title: parsed.title,
      note: parsed.note ?? null,
      category: normalizeTaskCategory(parsed.category ?? null),
      employeeId: parsed.employeeId?.trim() ? parsed.employeeId.trim() : null,
      projectId: parsed.projectId ?? null,
      updatedAt: this.nowIso(),
    };
    this.options.store.upsert(next);
    return next;
  }

  delete(id: string): void {
    this.options.store.delete(id);
  }

  /**
   * Persist the draft-lane order for one project. `orderedIds` must be exactly
   * that project's drafts — a board that changed under the drag is rejected so a
   * stale order can't silently scramble the lane. Ids are normalized to a dense
   * 0..n-1 range.
   */
  reorder(projectId: string, orderedIds: readonly string[]): TaskDraft[] {
    const projectDrafts = this.options.store
      .list()
      .filter((draft) => (draft.projectId ?? null) === projectId);
    const expected = new Set(projectDrafts.map((draft) => draft.id));
    const seen = new Set<string>();
    for (const id of orderedIds) {
      if (!expected.has(id) || seen.has(id)) {
        throw new Error("The draft board changed; refresh and try again.");
      }
      seen.add(id);
    }
    if (seen.size !== expected.size) {
      throw new Error("The draft board changed; refresh and try again.");
    }
    this.options.store.setSortOrders(orderedIds.map((id, index) => ({ id, sortOrder: index })));
    return this.list();
  }

  /**
   * A new draft lands at the TOP of its project's lane (`min - 1`), matching the
   * freshest-first order of the task lanes. Empty scope starts at 0.
   */
  private nextSortOrder(projectId: string | null): number {
    const orders = this.options.store
      .list()
      .filter((draft) => (draft.projectId ?? null) === projectId)
      .map((draft) => draft.sortOrder);
    return orders.length === 0 ? 0 : Math.min(...orders) - 1;
  }

  private requireDraft(id: string): TaskDraft {
    const draft = this.options.store.get(id);
    if (!draft) throw new Error("Draft not found.");
    return draft;
  }

  private nowIso(): string {
    return new Date((this.options.now ?? Date.now)()).toISOString();
  }
}
