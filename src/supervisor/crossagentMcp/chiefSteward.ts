import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  DispatchTeamTaskPayload,
  DispatchTeamTaskResult,
  ProjectLocation,
  SettingsWritePatch,
  Task,
  Team,
  TeamDispatchPolicy,
  Workspace,
} from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";
import { errorResult, jsonResult } from "./toolResult";
import type { McpToolResult, ToolSpec } from "./types";
import { DOMAIN_TOOLS, DOMAIN_TOOL_NAMES, dispatchDomainTool } from "./domainTools";
import { routeTaskBySource } from "./taskRouting";

/**
 * P2-08 — the chief steward (总管家) tool set: the single chat entry point
 * that can inspect workspaces/employees, define employee roles, form teams,
 * and dispatch tasks into them.
 *
 * Boundary rules (provider-agnostic, no provider names / kind branches):
 * - The steward only sees this tool set. Anything else is rejected with an
 *   explicit out-of-scope message rather than silently dispatched elsewhere.
 * - Writes go out as a `settings-write-request` patch to main (the supervisor
 *   process cannot touch the settings file).
 * - Every dispatched member thread is constrained to the role's authorized
 *   directory scope (`permissions.workspacePaths`); the approval leash
 *   (full-bypass → on-request) stays in the supervisorRuntime spawn closure.
 */

export const CHIEF_STEWARD_TOOL_NAMES = new Set([
  "list_workspaces",
  "get_workspace",
  "define_employee",
  "list_teams",
  "create_team",
  "assign_team_member",
  "dispatch_team_task",
  "list_tasks",
  "create_task",
  "get_steward_settings",
  "set_steward_settings",
  "route_inbox_task",
  ...DOMAIN_TOOL_NAMES,
]);

export function isKnownChiefStewardToolName(name: string): boolean {
  return CHIEF_STEWARD_TOOL_NAMES.has(name);
}

export const CHIEF_STEWARD_TOOLS: ToolSpec[] = [
  {
    name: "list_workspaces",
    description:
      "List all employee roles (workspaces) with their persona, responsibilities, and bindings.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_workspace",
    description: "Read one employee role's full record by id.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "define_employee",
    description:
      "Create or update an employee role: persona framing, responsibilities, provider binding, and authorized directory scope.",
    inputSchema: {
      type: "object",
      required: ["workspaceId"],
      properties: {
        workspaceId: { type: "string" },
        persona: { type: "string" },
        responsibilities: { type: "array", items: { type: "string" } },
        agentKind: { type: "string" },
        agentInstanceId: { type: "string" },
        workspacePaths: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "list_teams",
    description: "List all orchestrated teams with members and dispatch policy.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_team",
    description: "Form a new team from existing employee role ids.",
    inputSchema: {
      type: "object",
      required: ["name", "memberEmployeeIds", "dispatchPolicy"],
      properties: {
        name: { type: "string" },
        memberEmployeeIds: { type: "array", items: { type: "string" } },
        dispatchPolicy: {
          type: "string",
          enum: ["round-robin", "free-for-all", "manager-assigns"],
        },
        managerEmployeeId: { type: "string" },
      },
    },
  },
  {
    name: "assign_team_member",
    description: "Append an employee role to an existing team.",
    inputSchema: {
      type: "object",
      required: ["teamId", "employeeId"],
      properties: {
        teamId: { type: "string" },
        employeeId: { type: "string" },
      },
    },
  },
  {
    name: "dispatch_team_task",
    description:
      "Dispatch one task into a team: targets are chosen by the team's policy and member threads are spawned. The project location must lie inside every constrained member's authorized workspacePaths; constrained roles otherwise refuse the dispatch.",
    inputSchema: {
      type: "object",
      required: ["teamId", "prompt", "projectLocation", "model"],
      properties: {
        teamId: { type: "string" },
        prompt: { type: "string" },
        projectLocation: {
          type: "object",
          required: ["kind", "path"],
          properties: {
            kind: { type: "string", enum: ["windows", "wsl"] },
            path: { type: "string" },
          },
        },
        model: { type: "string" },
        deadline: { type: "string", description: "可选 ISO 截止时间；排队任务按截止早优先派发" },
      },
    },
  },
  {
    name: "list_tasks",
    description: "List the task board (real persisted tasks).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_task",
    description: "Create one task-board entry.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        projectId: { type: "string" },
      },
    },
  },
  {
    name: "get_steward_settings",
    description: "Read the chief steward assignment and team/workspace counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_steward_settings",
    description: "Assign (or clear with null) the chief steward workspace id.",
    inputSchema: {
      type: "object",
      required: ["chiefStewardWorkspaceId"],
      properties: {
        chiefStewardWorkspaceId: { type: ["string", "null"] },
      },
    },
  },
  ...DOMAIN_TOOLS,
  {
    name: "route_inbox_task",
    description:
      "任务来源分流建议：读入一条收到的任务文本，按来源语义给出建议的目标岗位（org-test-lead 测试主管 / org-oa 办公主管）与命中关键词；含糊时提示总管家追问。只做建议，不直接派发——派发由总管家确认后调 dispatch_team_task。",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "收到的任务原文" },
        source: { type: "string", description: "可选来源标注：oa / jprjcp / mxt / boss" },
      },
    },
  },
];

export interface ChiefStewardDeps {
  readSettings: () => SharedSettings;
  /** Ship a settings patch to main (fire-and-forget persistence request). */
  emitSettingsWrite: (patch: SettingsWritePatch) => void;
  /** Delegate dispatch to the live TeamDispatcher. */
  dispatchTeamTask: (payload: DispatchTeamTaskPayload) => Promise<DispatchTeamTaskResult>;
  /** The steward thread's own identity — new tasks run as the steward. */
  stewardIdentity: () => { agentKind: string; model: string };
  /** Fire-and-forget task-board create (main owns the SQLite write). */
  requestTaskCreate: (payload: {
    title: string;
    prompt: string;
    agentKind: string;
    model: string;
    projectId?: string;
  }) => void;
  /** Task board read bridge; absent → list_tasks reports itself unavailable. */
  listTasks?: () => Promise<Task[]>;
}

/**
 * True when `target` lives inside (or equals) at least one authorized root.
 * Pure path math — no provider concept.
 */
export function isPathInsideAnyRoot(target: string, roots: readonly string[]): boolean {
  const normalizedTarget = resolve(target);
  return roots.some((root) => {
    const rel = relative(resolve(root), normalizedTarget);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

function constrainedMembers(
  settings: SharedSettings,
  team: Team,
): Array<{ workspace: Workspace; roots: string[] }> {
  return team.memberEmployeeIds
    .map((id) => settings.workspaces.find((workspace) => workspace.id === id))
    .filter((workspace): workspace is Workspace => workspace !== undefined)
    .map((workspace) => ({
      workspace,
      roots: workspace.permissions?.workspacePaths ?? [],
    }))
    .filter((entry) => entry.roots.length > 0);
}

/**
 * Dispatch a tool call in the chief-steward lane. Never throws — unknown or
 * out-of-capability names return an explicit isError result.
 */
export async function dispatchChiefStewardTool(
  name: string,
  args: Record<string, unknown>,
  deps: ChiefStewardDeps,
): Promise<McpToolResult> {
  if (!isKnownChiefStewardToolName(name)) {
    return errorResult(`超出总管家能力范围：未知或未授权工具 ${name}`);
  }
  const settings = deps.readSettings();
  try {
    switch (name) {
      case "list_workspaces":
        return jsonResult(
          settings.workspaces.map((workspace) => ({
            id: workspace.id,
            name: workspace.name,
            persona: workspace.persona,
            responsibilities: workspace.responsibilities,
            agentKind: workspace.agentKind,
            authorizedPaths: workspace.permissions?.workspacePaths ?? [],
          })),
        );

      case "get_workspace": {
        const id = typeof args.id === "string" ? args.id : "";
        if (!id) return errorResult("id is required");
        const workspace = settings.workspaces.find((candidate) => candidate.id === id);
        return workspace ? jsonResult(workspace) : errorResult(`Unknown workspace: ${id}`);
      }

      case "define_employee": {
        const workspaceId = typeof args.workspaceId === "string" ? args.workspaceId : "";
        if (!workspaceId) return errorResult("workspaceId is required");
        const existing = settings.workspaces.find((candidate) => candidate.id === workspaceId);
        if (!existing) return errorResult(`Unknown workspace: ${workspaceId}`);
        const updated: Workspace = {
          ...existing,
          ...(typeof args.persona === "string" && args.persona ? { persona: args.persona } : {}),
          ...(Array.isArray(args.responsibilities)
            ? {
                responsibilities: args.responsibilities.filter(
                  (item): item is string => typeof item === "string",
                ),
              }
            : {}),
          ...(typeof args.agentKind === "string" && args.agentKind
            ? { agentKind: args.agentKind }
            : {}),
          ...(typeof args.agentInstanceId === "string" && args.agentInstanceId
            ? { agentInstanceId: args.agentInstanceId }
            : {}),
          ...(Array.isArray(args.workspacePaths)
            ? {
                permissions: {
                  ...existing.permissions,
                  workspacePaths: args.workspacePaths.filter(
                    (item): item is string => typeof item === "string",
                  ),
                },
              }
            : {}),
        };
        deps.emitSettingsWrite({
          workspaces: settings.workspaces.map((workspace) =>
            workspace.id === workspaceId ? updated : workspace,
          ),
        });
        return jsonResult({ status: "saved", workspace: updated });
      }

      case "list_teams":
        return jsonResult(settings.teams);

      case "create_team": {
        const teamName = typeof args.name === "string" ? args.name : "";
        if (!teamName.trim()) return errorResult("name is required");
        const memberEmployeeIds = Array.isArray(args.memberEmployeeIds)
          ? args.memberEmployeeIds.filter((id): id is string => typeof id === "string")
          : [];
        const dispatchPolicy = args.dispatchPolicy as TeamDispatchPolicy;
        const team: Team = {
          id: randomUUID(),
          name: teamName,
          memberEmployeeIds,
          ...(typeof args.managerEmployeeId === "string" && args.managerEmployeeId
            ? { managerEmployeeId: args.managerEmployeeId }
            : {}),
          dispatchPolicy,
          createdAt: new Date().toISOString(),
        };
        deps.emitSettingsWrite({ teams: [...settings.teams, team] });
        return jsonResult({ status: "created", team });
      }

      case "assign_team_member": {
        const teamId = typeof args.teamId === "string" ? args.teamId : "";
        const employeeId = typeof args.employeeId === "string" ? args.employeeId : "";
        if (!teamId || !employeeId) return errorResult("teamId and employeeId are required");
        const team = settings.teams.find((candidate) => candidate.id === teamId);
        if (!team) return errorResult(`Unknown team: ${teamId}`);
        if (team.memberEmployeeIds.includes(employeeId)) {
          return jsonResult({ status: "already-member", team });
        }
        const next: Team = { ...team, memberEmployeeIds: [...team.memberEmployeeIds, employeeId] };
        deps.emitSettingsWrite({
          teams: settings.teams.map((entry) => (entry.id === teamId ? next : entry)),
        });
        return jsonResult({ status: "added", team: next });
      }

      case "dispatch_team_task": {
        const teamId = typeof args.teamId === "string" ? args.teamId : "";
        const prompt = typeof args.prompt === "string" ? args.prompt : "";
        if (!teamId || !prompt.trim()) return errorResult("teamId and prompt are required");
        const projectLocation = args.projectLocation as ProjectLocation;
        if (
          !projectLocation ||
          typeof projectLocation !== "object" ||
          !("path" in projectLocation)
        ) {
          return errorResult("projectLocation { kind, path } is required");
        }
        const team = settings.teams.find((candidate) => candidate.id === teamId);
        if (!team) return errorResult(`Unknown team: ${teamId}`);
        // Authorization gate: constrained members may only operate inside their
        // authorized roots. Reject the whole dispatch up front instead of letting
        // one member escape its scope.
        const constrained = constrainedMembers(settings, team);
        if (constrained.length > 0) {
          const violations = constrained.filter(
            ({ roots }) => !isPathInsideAnyRoot(projectLocation.path, roots),
          );
          if (violations.length > 0) {
            return errorResult(
              `该岗位只能操作其授权工作区：${violations
                .map(({ workspace, roots }) => `${workspace.id} → ${roots.join(" / ")}`)
                .join("; ")}`,
            );
          }
        }
        const model = typeof args.model === "string" ? args.model : "";
        if (!model) return errorResult("model is required");
        const deadline = typeof args.deadline === "string" ? args.deadline : undefined;
        const payload: DispatchTeamTaskPayload = {
          teamId,
          prompt,
          projectLocation,
          config: { model },
          initialSize: { cols: 120, rows: 30 },
          ...(deadline ? { deadline } : {}),
        };
        return jsonResult(await deps.dispatchTeamTask(payload));
      }

      case "list_tasks": {
        if (!deps.listTasks) return errorResult("任务板当前不可用（supervisor 未接入）");
        return jsonResult(await deps.listTasks());
      }

      case "create_task": {
        const title = typeof args.title === "string" ? args.title : "";
        if (!title.trim()) return errorResult("title is required");
        const { agentKind, model } = deps.stewardIdentity();
        if (!agentKind || !model) {
          return errorResult("总管家身份不完整：未绑定 agentKind 或 model");
        }
        deps.requestTaskCreate({
          title,
          prompt: typeof args.prompt === "string" && args.prompt.trim() ? args.prompt : title,
          agentKind,
          model,
          ...(typeof args.projectId === "string" && args.projectId
            ? { projectId: args.projectId }
            : {}),
        });
        return jsonResult({ status: "queued", title });
      }

      case "get_steward_settings":
        return jsonResult({
          chiefStewardWorkspaceId: settings.chiefStewardWorkspaceId,
          teamCount: settings.teams.length,
          workspaceCount: settings.workspaces.length,
        });

      case "set_steward_settings": {
        const value = args.chiefStewardWorkspaceId;
        if (value !== null && typeof value !== "string") {
          return errorResult("chiefStewardWorkspaceId must be a string or null");
        }
        deps.emitSettingsWrite({ chiefStewardWorkspaceId: value });
        return jsonResult({ status: "saved", chiefStewardWorkspaceId: value });
      }

      case "route_inbox_task": {
        const text = typeof args.text === "string" ? args.text : "";
        const route = routeTaskBySource(text);
        if (route.needsClarification) {
          return jsonResult({
            suggestion: null,
            matchedKeywords: [],
            prompt: "未识别出任务来源语义——请向提出者追问：这是测试项目事项还是 OA 机关材料事项？",
          });
        }
        return jsonResult({
          suggestion: route.targetWorkspaceId,
          matchedKeywords: route.matchedKeywords,
          prompt:
            route.targetWorkspaceId === "org-test-lead"
              ? "建议派给测试主管；确认后调 dispatch_team_task。"
              : "建议派给办公主管；确认后调 dispatch_team_task。",
        });
      }

      default:
        // Business-domain tools (测试主管/执行设计师/OA) ride the same steward
        // lane — delegate to the pure domain dispatcher.
        return await dispatchDomainTool(name, args);
    }
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
