import {
  getTaskRunsPayloadSchema,
  reorderTasksPayloadSchema,
  setTaskStatusPayloadSchema,
  taskIdPayloadSchema,
  taskInputSchema,
  updateTaskPayloadSchema,
  type GetTaskRunsPayload,
  type GetTaskRunsResult,
  type ReorderTasksPayload,
  type SetTaskStatusPayload,
  type Task,
  type TaskIdPayload,
  type TaskInput,
  type UpdateTaskPayload,
} from "../../contracts";
import { defineNoArgProcedure, definePayloadProcedure } from "../core";

export const taskProcedures = {
  getTasks: defineNoArgProcedure<Task[], "main-local">("getTasks", "main-local"),
  createTask: definePayloadProcedure<TaskInput, Task, "main-local">(
    "createTask",
    "main-local",
    taskInputSchema,
  ),
  updateTask: definePayloadProcedure<UpdateTaskPayload, Task, "main-local">(
    "updateTask",
    "main-local",
    updateTaskPayloadSchema,
  ),
  deleteTask: definePayloadProcedure<TaskIdPayload, void, "main-local">(
    "deleteTask",
    "main-local",
    taskIdPayloadSchema,
  ),
  /** Manual run ("start") of a task, without touching its schedule. */
  startTask: definePayloadProcedure<TaskIdPayload, Task, "main-local">(
    "startTask",
    "main-local",
    taskIdPayloadSchema,
  ),
  /** Stop a live run; the card returns to Todo. */
  stopTask: definePayloadProcedure<TaskIdPayload, Task, "main-local">(
    "stopTask",
    "main-local",
    taskIdPayloadSchema,
  ),
  setTaskStatus: definePayloadProcedure<SetTaskStatusPayload, Task, "main-local">(
    "setTaskStatus",
    "main-local",
    setTaskStatusPayloadSchema,
  ),
  /** Persist the Todo-lane order for one project. Returns the refreshed board. */
  reorderTasks: definePayloadProcedure<ReorderTasksPayload, Task[], "main-local">(
    "reorderTasks",
    "main-local",
    reorderTasksPayloadSchema,
  ),
  getTaskRuns: definePayloadProcedure<GetTaskRunsPayload, GetTaskRunsResult, "main-local">(
    "getTaskRuns",
    "main-local",
    getTaskRunsPayloadSchema,
  ),
} as const;
