import {
  reorderTaskDraftsPayloadSchema,
  taskDraftIdPayloadSchema,
  taskDraftInputSchema,
  updateTaskDraftPayloadSchema,
  type ReorderTaskDraftsPayload,
  type TaskDraft,
  type TaskDraftIdPayload,
  type TaskDraftInput,
  type UpdateTaskDraftPayload,
} from "../../contracts";
import { defineNoArgProcedure, definePayloadProcedure } from "../core";

export const taskDraftProcedures = {
  getTaskDrafts: defineNoArgProcedure<TaskDraft[], "main-local">("getTaskDrafts", "main-local"),
  createTaskDraft: definePayloadProcedure<TaskDraftInput, TaskDraft, "main-local">(
    "createTaskDraft",
    "main-local",
    taskDraftInputSchema,
  ),
  updateTaskDraft: definePayloadProcedure<UpdateTaskDraftPayload, TaskDraft, "main-local">(
    "updateTaskDraft",
    "main-local",
    updateTaskDraftPayloadSchema,
  ),
  deleteTaskDraft: definePayloadProcedure<TaskDraftIdPayload, void, "main-local">(
    "deleteTaskDraft",
    "main-local",
    taskDraftIdPayloadSchema,
  ),
  /** Persist the draft-lane order for one project. Returns the refreshed list. */
  reorderTaskDrafts: definePayloadProcedure<ReorderTaskDraftsPayload, TaskDraft[], "main-local">(
    "reorderTaskDrafts",
    "main-local",
    reorderTaskDraftsPayloadSchema,
  ),
} as const;
