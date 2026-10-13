import { z } from "zod";
import { projectLocationSchema } from "./common";
import { threadConfigSchema } from "./config";
import { terminalSizeSchema } from "./thread";

/**
 * A team groups employee roles (workspaces) into an orchestrated unit. The
 * `dispatchPolicy` decides how a team task is handed to members; `managerEmployeeId`
 * optionally names a lead role whose agent routes work to members (used by the
 * "manager-assigns" policy via the existing cross-agent MCP).
 *
 * All member references are workspace ids — the same ids the P0 岗位 fields live
 * on — so a team is a pure grouping over existing employee entities, never a new
 * parallel entity.
 */
export const teamDispatchPolicySchema = z.enum(["round-robin", "free-for-all", "manager-assigns"]);
export type TeamDispatchPolicy = z.infer<typeof teamDispatchPolicySchema>;

export interface Team {
  id: string;
  name: string;
  /** Employee (workspace) ids that are members of this team. */
  memberEmployeeIds: string[];
  /** Optional workspace id that acts as the manager/lead role. */
  managerEmployeeId?: string | undefined;
  dispatchPolicy: TeamDispatchPolicy;
  createdAt: string;
  /** Hide this team (and its members) from the org-tree navigation by default. */
  hiddenInNav?: boolean | undefined;
}

const teamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // `.catch` (not `.default`) so a malformed value also degrades, not just a
  // missing one — a single bad team must never reject the whole teams list.
  // No `.optional()`: a missing field is itself a validation failure that
  // `.catch([])` turns into the empty member list.
  memberEmployeeIds: z.array(z.string()).catch([]),
  // `.catch` keeps a dangling/unknown manager id tolerant — it degrades to
  // "no manager" rather than rejecting the whole teams list on safeParse.
  managerEmployeeId: z.string().optional().catch(undefined),
  dispatchPolicy: teamDispatchPolicySchema.catch("round-robin"),
  createdAt: z.string().min(1),
  hiddenInNav: z.boolean().optional().catch(undefined),
});

/** Tolerant per-team parse; invalid entries degrade to absent. */
export const teamListSchema = z.array(teamSchema);
export type TeamList = z.infer<typeof teamListSchema>;

/** IPC payloads — strict (no `.catch`): an invalid caller payload must be rejected. */

/** `startTeam(teamId)` — validate + register a team with the runtime queue system. */
export const teamIdPayloadSchema = z.object({
  teamId: z.string().min(1),
});
export type TeamIdPayload = z.infer<typeof teamIdPayloadSchema>;

/**
 * `dispatchTeamTask(teamId, prompt, …)` — enqueue a task and drain it through the
 * team's dispatch policy. `projectLocation` / `config` / `initialSize` are the
 * launch context the caller (renderer composer) already has; member bindings on
 * the target workspaces fill `agentKind` / `agentInstanceId` and the workspace's
 * `defaultThreadConfig` (merged by the spawn pipeline).
 */
export const dispatchTeamTaskPayloadSchema = z.object({
  teamId: z.string().min(1),
  prompt: z.string().min(1),
  projectLocation: projectLocationSchema,
  config: threadConfigSchema,
  initialSize: terminalSizeSchema,
  /** Optional ISO deadline; parked tasks pop earlier-deadline first. */
  deadline: z.string().optional(),
});
export type DispatchTeamTaskPayload = z.infer<typeof dispatchTeamTaskPayloadSchema>;

/** `assignTeamMember(teamId, employeeId)` — main-local; main appends the id to the team. */
export const assignTeamMemberPayloadSchema = z.object({
  teamId: z.string().min(1),
  employeeId: z.string().min(1),
});
export type AssignTeamMemberPayload = z.infer<typeof assignTeamMemberPayloadSchema>;

/** Runtime-side view of a team returned by `startTeam` / `dispatchTeamTask`. */
export interface TeamSnapshot {
  team: Team;
  /** Resolved (existing-workspace) member count. */
  memberCount: number;
  /** Tasks still sitting in the team queue at read time. */
  pendingTaskCount: number;
  /**
   * Member threads this dispatcher has spawned so far, with their live status
   * when a status source is wired in. Empty (not "unknown") when no status
   * source is available — graceful degradation, provider-agnostic.
   */
  memberThreads: TeamMemberThreadSummary[];
}

/** One spawned member thread surfaced in a team snapshot. */
export interface TeamMemberThreadSummary {
  workspaceId: string;
  threadId: string;
  /** Thread runtime status, when the host supplied a status source. */
  status?: string | undefined;
}

/** Per-target outcome of one drained dispatch. */
export type TeamDispatchTargetStatus = "spawned" | "skipped" | "failed" | "queued";

export interface TeamDispatchTargetResult {
  workspaceId: string;
  status: TeamDispatchTargetStatus;
  /** Set when the member thread was spawned. */
  threadId?: string | undefined;
  /** Why the target was skipped/failed (member unbound, spawn error, …). */
  reason?: string | undefined;
}

export interface DispatchTeamTaskResult {
  taskId: string;
  /** The policy actually applied (manager-assigns may degrade to round-robin). */
  policy: TeamDispatchPolicy;
  targets: TeamDispatchTargetResult[];
}

/** Lifecycle states persisted for one team dispatch run. */
export const teamRunStatusSchema = z.enum(["running", "completed", "failed"]);
export type TeamRunStatus = z.infer<typeof teamRunStatusSchema>;

/**
 * `recordTeamRun` (main-local) — persist one team dispatch row. Called by the
 * bridge either directly from a client or proxied from the supervisor via the
 * `team-run-change` event; the row's `id` is the dispatcher task id, so a later
 * `updateTeamRunStatus` matches it.
 */
export const recordTeamRunPayloadSchema = z.object({
  taskId: z.string().min(1),
  teamId: z.string().min(1),
  prompt: z.string().min(1),
  policy: teamDispatchPolicySchema,
  targetWorkspaceIds: z.array(z.string().min(1)),
  status: teamRunStatusSchema,
});
export type RecordTeamRunPayload = z.infer<typeof recordTeamRunPayloadSchema>;

/** `updateTeamRunStatus` (main-local) — flip a run's lifecycle state. */
export const updateTeamRunStatusPayloadSchema = z.object({
  runId: z.string().min(1),
  status: teamRunStatusSchema,
  finishedAt: z.string().min(1).optional(),
});
export type UpdateTeamRunStatusPayload = z.infer<typeof updateTeamRunStatusPayloadSchema>;

/**
 * Supervisor → main persistence request for one team run (cross-process event).
 * When `finishedAt` is absent the row is inserted ("running"); once set it is
 * updated in place ("completed" / "failed").
 */
export interface TeamRunChange {
  id: string;
  teamId: string;
  prompt: string;
  policy: TeamDispatchPolicy;
  targetWorkspaceIds: string[];
  status: TeamRunStatus;
  createdAt: string;
  finishedAt?: string | undefined;
}

/**
 * Supervisor → main request to mutate shared settings (chief steward tools
 * define employees / create teams / set the steward id). The supervisor
 * process cannot write the settings file, so it ships a partial patch and
 * main applies + persists it. Arrays are wholesale replacements for the whole
 * `teams` / `workspaces` lists — callers always read-modify-write the full list.
 */
export const settingsWritePatchSchema = z
  .object({
    teams: z.array(z.unknown()).optional(),
    workspaces: z.array(z.unknown()).optional(),
    chiefStewardWorkspaceId: z.string().nullable().optional(),
  })
  .refine(
    (patch) =>
      patch.teams !== undefined ||
      patch.workspaces !== undefined ||
      patch.chiefStewardWorkspaceId !== undefined,
    { message: "settings write patch must carry at least one field" },
  );
export type SettingsWritePatch = z.infer<typeof settingsWritePatchSchema>;
