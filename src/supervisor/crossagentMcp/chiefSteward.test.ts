import { describe, expect, it } from "vitest";
import type {
  DispatchTeamTaskResult,
  SettingsWritePatch,
  Team,
  Workspace,
} from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";
import {
  dispatchChiefStewardTool,
  isKnownChiefStewardToolName,
  isPathInsideAnyRoot,
  type ChiefStewardDeps,
} from "./chiefSteward";

const DOC = {
  id: "w-doc",
  name: "文档编写岗",
  createdAt: "2026-01-01T00:00:00.000Z",
  icon: "palette" as const,
  permissions: { workspacePaths: ["C:\\work\\docs"] },
};

const CODE: Workspace = {
  id: "w-code",
  name: "软件编码岗",
  createdAt: "2026-01-01T00:00:00.000Z",
  icon: "code",
  // no authorized paths — unrestricted dispatch location
};

const TEAM: Team = {
  id: "team-1",
  name: "核心组",
  memberEmployeeIds: ["w-code"],
  dispatchPolicy: "free-for-all",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function settings(overrides: Partial<SharedSettings> = {}): SharedSettings {
  return {
    workspaces: [DOC, CODE],
    teams: [TEAM],
    ...overrides,
  } as SharedSettings;
}

interface Fixture {
  deps: ChiefStewardDeps;
  patches: SettingsWritePatch[];
  dispatched: { teamId: string; prompt: string }[];
}

function makeFixture(overrides: Partial<SharedSettings> = {}): Fixture {
  let current = settings(overrides);
  const patches: SettingsWritePatch[] = [];
  const dispatched: { teamId: string; prompt: string }[] = [];
  const deps: ChiefStewardDeps = {
    readSettings: () => current,
    emitSettingsWrite: (patch) => {
      patches.push(patch);
      current = settings({
        ...overrides,
        ...(patch.teams ? { teams: patch.teams as Team[] } : {}),
        ...(patch.workspaces ? { workspaces: patch.workspaces as Workspace[] } : {}),
      });
    },
    dispatchTeamTask: async (payload) => {
      dispatched.push({ teamId: payload.teamId, prompt: payload.prompt });
      return {
        taskId: "run-1",
        policy: payload.teamId === TEAM.id ? "free-for-all" : "round-robin",
        targets: [],
      } as DispatchTeamTaskResult;
    },
    stewardIdentity: () => ({ agentKind: "codex", model: "gpt-5" }),
    requestTaskCreate: () => {},
  };
  return { deps, patches, dispatched };
}

describe("isPathInsideAnyRoot", () => {
  it("matches nested paths and rejects siblings outside", () => {
    expect(isPathInsideAnyRoot("C:\\work\\docs\\a.md", ["C:\\work\\docs"])).toBe(true);
    expect(isPathInsideAnyRoot("C:\\work\\other\\a.md", ["C:\\work\\docs"])).toBe(false);
    expect(isPathInsideAnyRoot("C:\\work\\docs-secret\\a.md", ["C:\\work\\docs"])).toBe(false);
  });
});

describe("chief steward — read tools", () => {
  it("list_workspaces surfaces authorized paths", async () => {
    const { deps } = makeFixture();
    const result = await dispatchChiefStewardTool("list_workspaces", {}, deps);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text) as Array<{
      id: string;
      authorizedPaths: string[];
    }>;
    expect(parsed.find((w) => w.id === "w-doc")?.authorizedPaths).toEqual(["C:\\work\\docs"]);
  });

  it("get_workspace returns one role or errors", async () => {
    const { deps } = makeFixture();
    expect(
      (await dispatchChiefStewardTool("get_workspace", { id: "w-code" }, deps)).isError,
    ).toBeUndefined();
    expect((await dispatchChiefStewardTool("get_workspace", { id: "nope" }, deps)).isError).toBe(
      true,
    );
  });
});

describe("chief steward — write tools emit settings patches", () => {
  it("define_employee updates persona and authorized paths", async () => {
    const { deps, patches } = makeFixture();
    const result = await dispatchChiefStewardTool(
      "define_employee",
      { workspaceId: "w-code", persona: "我是编码岗", workspacePaths: ["C:\\code\\repo"] },
      deps,
    );
    expect(result.isError).toBeUndefined();
    expect(patches).toHaveLength(1);
    expect(patches[0]?.workspaces?.length).toBe(2);
  });

  it("create_team appends a team via patch", async () => {
    const { deps, patches } = makeFixture();
    const result = await dispatchChiefStewardTool(
      "create_team",
      { name: "新组", memberEmployeeIds: ["w-code"], dispatchPolicy: "round-robin" },
      deps,
    );
    expect(result.isError).toBeUndefined();
    expect(patches[0]?.teams).toHaveLength(2);
  });

  it("assign_team_member appends an employee", async () => {
    const { deps, patches } = makeFixture();
    await dispatchChiefStewardTool(
      "assign_team_member",
      { teamId: "team-1", employeeId: "w-doc" },
      deps,
    );
    const patched = patches[0]?.teams as Team[];
    expect(patched[0]?.memberEmployeeIds).toEqual(["w-code", "w-doc"]);
  });

  it("set_steward_settings patches the steward id (null clears)", async () => {
    const { deps, patches } = makeFixture();
    await dispatchChiefStewardTool(
      "set_steward_settings",
      { chiefStewardWorkspaceId: "w-doc" },
      deps,
    );
    expect(patches[0]?.chiefStewardWorkspaceId).toBe("w-doc");
    await dispatchChiefStewardTool("set_steward_settings", { chiefStewardWorkspaceId: null }, deps);
    expect(patches[1]?.chiefStewardWorkspaceId).toBeNull();
  });
});

describe("chief steward — dispatch authorization", () => {
  const payload = {
    teamId: "team-1",
    prompt: "写文档",
    projectLocation: { kind: "windows" as const, path: "C:\\work\\docs\\out" },
    model: "gpt-5",
  };

  it("allows dispatch inside an authorized root", async () => {
    const constrainedTeam: Team = { ...TEAM, memberEmployeeIds: ["w-doc", "w-code"] };
    const { deps, dispatched } = makeFixture({ teams: [constrainedTeam] });
    const result = await dispatchChiefStewardTool("dispatch_team_task", payload, deps);
    expect(result.isError).toBeUndefined();
    expect(dispatched).toHaveLength(1);
  });

  it("rejects dispatch outside any constrained member's authorized root", async () => {
    const constrainedTeam: Team = { ...TEAM, memberEmployeeIds: ["w-doc", "w-code"] };
    const { deps, dispatched } = makeFixture({ teams: [constrainedTeam] });
    const result = await dispatchChiefStewardTool(
      "dispatch_team_task",
      { ...payload, projectLocation: { kind: "windows", path: "C:\\elsewhere\\x" } },
      deps,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("授权工作区");
    expect(dispatched).toHaveLength(0);
  });
});

describe("chief steward — capability boundary", () => {
  it("rejects unknown tool names with an out-of-scope message", async () => {
    const { deps } = makeFixture();
    expect(isKnownChiefStewardToolName("spawn_agent")).toBe(false);
    const result = await dispatchChiefStewardTool("spawn_agent", {}, deps);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("超出总管家能力范围");
  });

  it("list_tasks degrades clearly when no read bridge is wired", async () => {
    const { deps } = makeFixture();
    expect((await dispatchChiefStewardTool("list_tasks", {}, deps)).isError).toBe(true);
  });

  it("create_task ships a task-create request carrying the steward identity", async () => {
    const created: Array<{ title: string; agentKind: string; model: string }> = [];
    const depsWithCreate: ChiefStewardDeps = {
      ...makeFixture().deps,
      requestTaskCreate: (payload) => created.push(payload),
    };
    const result = await dispatchChiefStewardTool(
      "create_task",
      { title: "写报告", prompt: "写季度报告" },
      depsWithCreate,
    );
    expect(result.isError).toBeUndefined();
    expect(created).toEqual([
      { title: "写报告", prompt: "写季度报告", agentKind: "codex", model: "gpt-5" },
    ]);
  });

  it("create_task errors when the steward identity is incomplete", async () => {
    const depsNoIdentity: ChiefStewardDeps = {
      ...makeFixture().deps,
      stewardIdentity: () => ({ agentKind: "", model: "" }),
    };
    const result = await dispatchChiefStewardTool("create_task", { title: "t" }, depsNoIdentity);
    expect(result.isError).toBe(true);
  });
});
