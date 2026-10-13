import { z } from "zod";
import { isHomeProjectId } from "@/shared/homeScope";
import {
  agentKindSchema,
  taskCategorySchema,
  taskIsolationSchema,
  taskRecurrenceSchema,
  type Task,
  type TaskInput,
} from "@/shared/contracts";
import type { AppControlsToolContext, ToolDomain } from "./types";

const createArgsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(50_000),
  employeeId: z.string().min(1).nullable().optional(),
  isolation: taskIsolationSchema.optional(),
  recurrence: taskRecurrenceSchema.nullable().optional(),
  scheduleEnabled: z.boolean().optional(),
  agentKind: agentKindSchema.optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  category: taskCategorySchema.nullable().optional(),
});

const updateArgsSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(1).max(50_000).optional(),
  employeeId: z.string().min(1).nullable().optional(),
  isolation: taskIsolationSchema.optional(),
  recurrence: taskRecurrenceSchema.nullable().optional(),
  scheduleEnabled: z.boolean().optional(),
  agentKind: agentKindSchema.optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).nullable().optional(),
  category: taskCategorySchema.nullable().optional(),
});

const idArgsSchema = z.object({ id: z.string().uuid() });

export const taskTools: ToolDomain = {
  specs: [
    {
      name: "list_tasks",
      description: "List the user's AgentEmployee tasks on the task board with their status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "create_task",
      description:
        "Create a task on the board and hand it to a digital employee. The employee carries " +
        "the agent and model, so pass employeeId (call list_employees to discover them). It " +
        "runs unattended in an isolated git worktree by default (or directly in the project " +
        "when isolation is 'project'). Omit recurrence for a one-off manual task.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["title", "prompt"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 120 },
          prompt: { type: "string", minLength: 1, maxLength: 50000 },
          employeeId: {
            type: ["string", "null"],
            minLength: 1,
            description:
              "Id of the digital employee that runs this task. The employee supplies the " +
              "agent and model; omit to fall back to the calling thread's agent.",
          },
          isolation: { type: "string", enum: ["worktree", "project"] },
          recurrence: recurrenceJsonSchema(),
          scheduleEnabled: { type: "boolean" },
          agentKind: { type: "string", minLength: 1 },
          model: { type: "string", minLength: 1 },
          effort: { type: "string", minLength: 1 },
          category: {
            type: ["string", "null"],
            minLength: 1,
            description: "Free-form category label; omit or null for uncategorized.",
          },
        },
      },
    },
    {
      name: "update_task",
      description: "Update selected fields on an existing AgentEmployee task.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string", minLength: 1, maxLength: 120 },
          prompt: { type: "string", minLength: 1, maxLength: 50000 },
          employeeId: {
            type: ["string", "null"],
            minLength: 1,
            description: "Reassign the task to a different employee; null clears the assignment.",
          },
          isolation: { type: "string", enum: ["worktree", "project"] },
          recurrence: recurrenceJsonSchema(),
          scheduleEnabled: { type: "boolean" },
          agentKind: { type: "string", minLength: 1 },
          model: { type: "string", minLength: 1 },
          effort: { type: ["string", "null"], minLength: 1 },
          category: {
            type: ["string", "null"],
            minLength: 1,
            description: "Free-form category label; null clears it.",
          },
        },
      },
    },
    {
      name: "start_task",
      description: "Run a task now, without changing any schedule it carries.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "stop_task",
      description: "Stop a task's running agent; the card returns to the Todo column.",
      inputSchema: idJsonSchema(),
    },
    {
      name: "delete_task",
      description:
        "Delete a task from the board. Its worktree and branch are kept; the user removes " +
        "those from the task's detail drawer.",
      inputSchema: idJsonSchema(),
    },
  ],
  handlers: {
    list_tasks: (_args, ctx) => ctx.taskService.list(),
    create_task: (args, ctx) => {
      const parsed = createArgsSchema.parse(args);
      const sourceThread = ctx.identity.threadId ? ctx.getThread(ctx.identity.threadId) : null;
      // An assigned employee owns the provider + model binding; only fall back to the
      // calling thread's own agent when the caller did not name an employee.
      const employeeId = parsed.employeeId ?? null;
      const agentKind = parsed.agentKind ?? sourceThread?.agentKind;
      const model = parsed.model ?? sourceThread?.config.model;
      if (!employeeId && (!agentKind || !model)) {
        throw new Error(
          "Pass employeeId, or agentKind and model when the calling thread is unavailable.",
        );
      }
      const projectId =
        sourceThread && !isHomeProjectId(sourceThread.projectId) ? sourceThread.projectId : null;
      const recurrence = parsed.recurrence ?? null;
      const input: TaskInput = {
        title: parsed.title,
        prompt: parsed.prompt,
        employeeId,
        // The employee resolves the runtime agent, so this is only a fallback for
        // employee-less tasks and for the board's agent badge.
        agentKind: agentKind ?? "claude",
        ...(projectId ? { projectId } : {}),
        // Home scope has no git repo, so a worktree is impossible there.
        isolation: parsed.isolation ?? (projectId ? "worktree" : "project"),
        category: parsed.category ?? null,
        recurrence,
        scheduleEnabled: parsed.scheduleEnabled ?? recurrence != null,
        config: {
          model: model ?? "",
          ...((parsed.effort ?? sourceThread?.config.effort)
            ? { effort: parsed.effort ?? sourceThread?.config.effort }
            : {}),
          ...(sourceThread?.config.fast !== undefined ? { fast: sourceThread.config.fast } : {}),
        },
      };
      return ctx.taskService.create(input);
    },
    update_task: (args, ctx) => {
      const parsed = updateArgsSchema.parse(args);
      const current = requireTask(ctx, parsed.id);
      return ctx.taskService.update(parsed.id, {
        title: parsed.title ?? current.title,
        prompt: parsed.prompt ?? current.prompt,
        employeeId:
          parsed.employeeId === undefined ? (current.employeeId ?? null) : parsed.employeeId,
        agentKind: parsed.agentKind ?? current.agentKind,
        projectId: current.projectId ?? null,
        isolation: parsed.isolation ?? current.isolation,
        category: parsed.category === undefined ? (current.category ?? null) : parsed.category,
        recurrence:
          parsed.recurrence === undefined ? (current.recurrence ?? null) : parsed.recurrence,
        scheduleEnabled: parsed.scheduleEnabled ?? current.scheduleEnabled,
        config: {
          model: parsed.model ?? current.config.model,
          ...(parsed.effort === null
            ? {}
            : parsed.effort !== undefined
              ? { effort: parsed.effort }
              : current.config.effort
                ? { effort: current.config.effort }
                : {}),
          ...(current.config.fast !== undefined ? { fast: current.config.fast } : {}),
        },
      });
    },
    start_task: (args, ctx) => ctx.taskService.runNow(idArgsSchema.parse(args).id),
    stop_task: (args, ctx) => ctx.taskService.stop(idArgsSchema.parse(args).id),
    delete_task: (args, ctx) => {
      const { id } = idArgsSchema.parse(args);
      requireTask(ctx, id);
      ctx.taskService.delete(id);
      return { deleted: true, id };
    },
  },
};

function requireTask(ctx: AppControlsToolContext, id: string): Task {
  const task = ctx.taskService.get(id);
  if (!task) throw new Error("Task not found.");
  return task;
}

function idJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  };
}

function recurrenceJsonSchema(): Record<string, unknown> {
  return {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "minute"],
        properties: {
          kind: { const: "hourly" },
          minute: { type: "integer", minimum: 0, maximum: 59 },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "days", "time"],
        properties: {
          kind: { const: "weekly" },
          days: {
            type: "array",
            minItems: 1,
            items: { type: "integer", minimum: 0, maximum: 6 },
          },
          time: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "runAt"],
        properties: {
          kind: { const: "once" },
          runAt: { type: "string", format: "date-time" },
        },
      },
    ],
  };
}
