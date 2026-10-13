import type { Task, TaskInput, TaskStatus } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { openThread } from "@/renderer/actions/threadActions";
import { useAppStore } from "@/renderer/state/appStore";

export function createTask(input: TaskInput): Promise<Task> {
  return readBridge().createTask(input);
}

export function updateTask(id: string, input: TaskInput): Promise<Task> {
  return readBridge().updateTask({ id, task: input });
}

export function deleteTask(id: string): Promise<void> {
  return readBridge().deleteTask({ id });
}

export function startTask(id: string): Promise<Task> {
  return readBridge().startTask({ id });
}

export function stopTask(id: string): Promise<Task> {
  return readBridge().stopTask({ id });
}

export function setTaskStatus(id: string, status: TaskStatus): Promise<Task> {
  return readBridge().setTaskStatus({ id, status });
}

/** Persist the Todo-lane order for one project; returns the refreshed board. */
export function reorderTasks(projectId: string, orderedIds: string[]): Promise<Task[]> {
  return readBridge().reorderTasks({ projectId, orderedIds });
}

/**
 * Open the GUI thread a task's most recent run created. Returns false when the
 * thread is gone (deleted from the sidebar), so the caller can show an error
 * instead of navigating to a missing pane.
 */
export function openTaskSession(task: Task): boolean {
  if (!task.threadId) return false;
  const exists = useAppStore.getState().threads.some((thread) => thread.id === task.threadId);
  if (!exists) return false;
  openThread(task.threadId);
  return true;
}
