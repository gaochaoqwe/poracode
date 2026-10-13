import {
  assignTeamMemberPayloadSchema,
  dispatchTeamTaskPayloadSchema,
  recordTeamRunPayloadSchema,
  teamIdPayloadSchema,
  updateTeamRunStatusPayloadSchema,
  type AssignTeamMemberPayload,
  type DispatchTeamTaskPayload,
  type DispatchTeamTaskResult,
  type RecordTeamRunPayload,
  type Team,
  type TeamIdPayload,
  type TeamSnapshot,
  type UpdateTeamRunStatusPayload,
} from "../../contracts";
import { definePayloadProcedure } from "../core";

/**
 * Team (digital-employee orchestration) IPC procedures.
 *
 * - `startTeam` / `dispatchTeamTask` run on the **supervisor**: they read the
 *   live teams/workspaces from the shared-settings cache, drain the in-memory
 *   team task queue, and spawn member threads through the thread session manager.
 * - `assignTeamMember` / `recordTeamRun` / `updateTeamRunStatus` run
 *   **main-local**: settings-file and SQLite writes are owned by the main process.
 */
export const teamProcedures = {
  /** Validate a team exists and register it with the runtime queue system. */
  startTeam: definePayloadProcedure<TeamIdPayload, TeamSnapshot, "supervisor">(
    "startTeam",
    "supervisor",
    teamIdPayloadSchema,
  ),
  /** Enqueue a task and immediately drain it: decide targets, spawn member threads. */
  dispatchTeamTask: definePayloadProcedure<
    DispatchTeamTaskPayload,
    DispatchTeamTaskResult,
    "supervisor"
  >("dispatchTeamTask", "supervisor", dispatchTeamTaskPayloadSchema),
  /** Append an employee (workspace) id to a team; persists via main's settings write. */
  assignTeamMember: definePayloadProcedure<AssignTeamMemberPayload, Team, "main-local">(
    "assignTeamMember",
    "main-local",
    assignTeamMemberPayloadSchema,
  ),
  /** Insert one team-run row into SQLite (also proxied from the supervisor event). */
  recordTeamRun: definePayloadProcedure<RecordTeamRunPayload, void, "main-local">(
    "recordTeamRun",
    "main-local",
    recordTeamRunPayloadSchema,
  ),
  /** Flip a team-run row's lifecycle state. */
  updateTeamRunStatus: definePayloadProcedure<UpdateTeamRunStatusPayload, void, "main-local">(
    "updateTeamRunStatus",
    "main-local",
    updateTeamRunStatusPayloadSchema,
  ),
} as const;
