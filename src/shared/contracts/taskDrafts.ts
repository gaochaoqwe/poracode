import { z } from "zod";
import { taskCategorySchema } from "./task";

/**
 * A rough idea that isn't ready to be a task yet: just a title and an optional
 * note. Kept as its own lightweight entity so recording one doesn't force the
 * agent/model/prompt decisions a real task needs.
 */
export const taskDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  note: z.string().max(20_000).nullable().optional(),
  /** The idea's category; `null`/omitted means uncategorized. */
  category: taskCategorySchema.nullable().optional(),
  /**
   * The employee the idea is intended for. Optional — a draft is a rough idea
   * and may not have an owner yet; the value carries over when the idea is
   * promoted into a task.
   */
  employeeId: z.string().min(1).nullable().optional(),
  /** Project the idea belongs to; `null`/omitted is untagged (Home scope). */
  projectId: z.string().nullable().optional(),
});
export type TaskDraftInput = z.infer<typeof taskDraftInputSchema>;

export const taskDraftSchema = taskDraftInputSchema.extend({
  id: z.string().uuid(),
  /**
   * Manual position in the draft lane (ascending). Meaningful only when the
   * board is filtered to the draft's project; assigned by the service.
   */
  sortOrder: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TaskDraft = z.infer<typeof taskDraftSchema>;

export const taskDraftIdPayloadSchema = z.object({ id: z.string().uuid() });
export type TaskDraftIdPayload = z.infer<typeof taskDraftIdPayloadSchema>;

export const updateTaskDraftPayloadSchema = z.object({
  id: z.string().uuid(),
  draft: taskDraftInputSchema,
});
export type UpdateTaskDraftPayload = z.infer<typeof updateTaskDraftPayloadSchema>;

/**
 * Persist the draft lane order for one project. `orderedIds` must list exactly
 * that project's drafts, so a board that changed underneath the drag is
 * rejected rather than silently mis-ordered.
 */
export const reorderTaskDraftsPayloadSchema = z.object({
  projectId: z.string().min(1),
  orderedIds: z.array(z.string().uuid()).min(1),
});
export type ReorderTaskDraftsPayload = z.infer<typeof reorderTaskDraftsPayloadSchema>;
