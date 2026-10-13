import type { TaskDraft, TaskDraftInput } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";

export function createTaskDraft(input: TaskDraftInput): Promise<TaskDraft> {
  return readBridge().createTaskDraft(input);
}

export function updateTaskDraft(id: string, draft: TaskDraftInput): Promise<TaskDraft> {
  return readBridge().updateTaskDraft({ id, draft });
}

export function deleteTaskDraft(id: string): Promise<void> {
  return readBridge().deleteTaskDraft({ id });
}

/** Persist the draft-lane order for one project; returns the refreshed lane. */
export function reorderTaskDrafts(projectId: string, orderedIds: string[]): Promise<TaskDraft[]> {
  return readBridge().reorderTaskDrafts({ projectId, orderedIds });
}
