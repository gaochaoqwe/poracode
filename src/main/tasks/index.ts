import { dbDeleteTask, dbGetTask, dbGetTasks, dbSetTaskSortOrders, dbUpsertTask } from "../db";
import type { Task } from "@/shared/contracts";
import { TasksService } from "./TasksService";
import type { TaskRunOutcome } from "./TaskRunCoordinator";

export interface DeviceTaskServiceOptions {
  /** Executes one run of a task and resolves with its outcome. */
  runTask: (task: Task) => Promise<TaskRunOutcome>;
  /** Detaches and interrupts a task's live run. */
  cancelRun: (taskId: string) => Promise<void>;
  /** Marks a task's dangling run rows interrupted after a restart. */
  onStartupInterrupted?: (taskId: string) => void;
}

export function createDeviceTaskService(options: DeviceTaskServiceOptions): TasksService {
  return new TasksService({
    store: {
      list: dbGetTasks,
      get: dbGetTask,
      upsert: dbUpsertTask,
      delete: dbDeleteTask,
      setSortOrders: dbSetTaskSortOrders,
    },
    runTask: options.runTask,
    cancelRun: options.cancelRun,
    ...(options.onStartupInterrupted ? { onStartupInterrupted: options.onStartupInterrupted } : {}),
  });
}

export { TasksService, type TaskStore } from "./TasksService";
export {
  TaskRunCoordinator,
  type TaskRunCoordinatorDeps,
  type TaskRunOutcome,
} from "./TaskRunCoordinator";
export { ensureHomeProjectRow, homeScopeLocation } from "./homeProject";
