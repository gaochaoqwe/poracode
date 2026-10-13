import { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import {
  assignTeamMemberPayloadSchema,
  dispatchTeamTaskPayloadSchema,
  recordTeamRunPayloadSchema,
  teamIdPayloadSchema,
  updateTeamRunStatusPayloadSchema,
} from "../../contracts";
import { teamProcedures } from "./teams";

const validBase = {
  projectLocation: { kind: "windows" as const, path: "C:\\repo" },
  config: { model: "gpt-5" },
  initialSize: { cols: 120, rows: 30 },
};

describe("team IPC payload schemas", () => {
  it("startTeam accepts a valid teamId (parseArgs round-trip)", () => {
    expect(teamProcedures.startTeam.parseArgs({ teamId: "team-1" })).toEqual({ teamId: "team-1" });
  });

  it("startTeam rejects empty / missing teamId", () => {
    expect(() => teamIdPayloadSchema.parse({ teamId: "" })).toThrow(ZodError);
    expect(() => teamIdPayloadSchema.parse({})).toThrow(ZodError);
  });

  it("dispatchTeamTask accepts a full valid payload (parseArgs round-trip)", () => {
    const payload = teamProcedures.dispatchTeamTask.parseArgs({
      teamId: "team-1",
      prompt: "do the thing",
      ...validBase,
    });
    expect(payload.teamId).toBe("team-1");
    expect(payload.prompt).toBe("do the thing");
  });

  it("dispatchTeamTask rejects invalid payloads", () => {
    // Empty teamId
    expect(() =>
      dispatchTeamTaskPayloadSchema.parse({ teamId: "", prompt: "p", ...validBase }),
    ).toThrow(ZodError);
    // Empty prompt
    expect(() =>
      dispatchTeamTaskPayloadSchema.parse({ teamId: "t", prompt: "", ...validBase }),
    ).toThrow(ZodError);
    // Missing projectLocation
    expect(() =>
      dispatchTeamTaskPayloadSchema.parse({
        teamId: "t",
        prompt: "p",
        ...validBase,
        projectLocation: undefined,
      }),
    ).toThrow(ZodError);
    // Config without a model must be rejected (threadConfigSchema requires model)
    expect(() =>
      dispatchTeamTaskPayloadSchema.parse({
        teamId: "t",
        prompt: "p",
        ...validBase,
        config: {},
      }),
    ).toThrow(ZodError);
    // Out-of-range terminal size
    expect(() =>
      dispatchTeamTaskPayloadSchema.parse({
        teamId: "t",
        prompt: "p",
        ...validBase,
        initialSize: { cols: 1, rows: 1 },
      }),
    ).toThrow(ZodError);
  });

  it("assignTeamMember accepts valid ids (parseArgs round-trip)", () => {
    expect(teamProcedures.assignTeamMember.parseArgs({ teamId: "t", employeeId: "w-1" })).toEqual({
      teamId: "t",
      employeeId: "w-1",
    });
  });

  it("assignTeamMember rejects empty ids", () => {
    expect(() => assignTeamMemberPayloadSchema.parse({ teamId: "t", employeeId: "" })).toThrow(
      ZodError,
    );
    expect(() => assignTeamMemberPayloadSchema.parse({ teamId: "", employeeId: "w-1" })).toThrow(
      ZodError,
    );
  });

  it("recordTeamRun accepts a valid row payload (parseArgs round-trip)", () => {
    const payload = teamProcedures.recordTeamRun.parseArgs({
      taskId: "task-1",
      teamId: "t",
      prompt: "p",
      policy: "round-robin",
      targetWorkspaceIds: ["w-1", "w-2"],
      status: "running",
    });
    expect(payload.status).toBe("running");
  });

  it("recordTeamRun rejects invalid payloads", () => {
    // Unknown policy
    expect(() =>
      recordTeamRunPayloadSchema.parse({
        taskId: "task-1",
        teamId: "t",
        prompt: "p",
        policy: "free-for-allzz",
        targetWorkspaceIds: [],
        status: "running",
      }),
    ).toThrow(ZodError);
    // Unknown status
    expect(() =>
      recordTeamRunPayloadSchema.parse({
        taskId: "task-1",
        teamId: "t",
        prompt: "p",
        policy: "round-robin",
        targetWorkspaceIds: [],
        status: "pending",
      }),
    ).toThrow(ZodError);
    // Empty taskId
    expect(() =>
      recordTeamRunPayloadSchema.parse({
        taskId: "",
        teamId: "t",
        prompt: "p",
        policy: "round-robin",
        targetWorkspaceIds: [],
        status: "running",
      }),
    ).toThrow(ZodError);
  });

  it("updateTeamRunStatus accepts a status flip with optional finishedAt", () => {
    expect(
      teamProcedures.updateTeamRunStatus.parseArgs({ runId: "task-1", status: "completed" }),
    ).toMatchObject({ runId: "task-1", status: "completed" });
    expect(
      teamProcedures.updateTeamRunStatus.parseArgs({
        runId: "task-1",
        status: "failed",
        finishedAt: "2026-10-10T00:00:00.000Z",
      }).finishedAt,
    ).toBeTruthy();
  });

  it("updateTeamRunStatus rejects unknown statuses / empty runId", () => {
    expect(() =>
      updateTeamRunStatusPayloadSchema.parse({ runId: "task-1", status: "queued" }),
    ).toThrow(ZodError);
    expect(() =>
      updateTeamRunStatusPayloadSchema.parse({ runId: "", status: "completed" }),
    ).toThrow(ZodError);
  });
});
