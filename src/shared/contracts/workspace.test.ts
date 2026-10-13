import { describe, expect, test } from "vitest";
import { HOME_PROJECT_ID } from "../homeScope";
import {
  isPreviousDefaultWorkspaces,
  isProjectInWorkspace,
  isThreadInWorkspace,
  nextWorkspaceIconId,
  workspaceListSchema,
  workspaceSchema,
} from "./workspace";

const KNOWN = new Set(["ws-work", "ws-side"]);

describe("workspaceSchema", () => {
  test("accepts a workspace and rejects a blank name", () => {
    expect(
      workspaceSchema.parse({ id: "ws-work", name: "Work", createdAt: "2026-01-01T00:00:00.000Z" }),
    ).toEqual({
      id: "ws-work",
      name: "Work",
      createdAt: "2026-01-01T00:00:00.000Z",
      icon: "briefcase",
    });
    expect(workspaceSchema.safeParse({ id: "ws-work", name: "", createdAt: "t" }).success).toBe(
      false,
    );
  });

  test("migrates legacy workspaces to distinct icons", () => {
    const workspaces = workspaceListSchema.parse([
      { id: "ws-work", name: "Work", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "ws-side", name: "Side Hustle", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    expect(workspaces.map((workspace) => workspace.icon)).toEqual(["briefcase", "rocket"]);
    expect(nextWorkspaceIconId(workspaces)).toBe("palette");
  });

  test("repairs duplicate saved icons", () => {
    const workspaces = workspaceListSchema.parse([
      {
        id: "ws-work",
        name: "Work",
        createdAt: "2026-01-01T00:00:00.000Z",
        icon: "rocket",
      },
      {
        id: "ws-side",
        name: "Side Hustle",
        createdAt: "2026-01-01T00:00:00.000Z",
        icon: "rocket",
      },
    ]);

    expect(workspaces.map((workspace) => workspace.icon)).toEqual(["rocket", "briefcase"]);
  });

  test("keeps the optional domain and default scenarios", () => {
    const [workspace] = workspaceListSchema.parse([
      {
        id: "ws-docs",
        name: "Docs",
        createdAt: "2026-01-01T00:00:00.000Z",
        category: "docs",
        defaultScenarioIds: ["generate-srs", "polish-text"],
      },
    ]);

    expect(workspace!.category).toBe("docs");
    expect(workspace!.defaultScenarioIds).toEqual(["generate-srs", "polish-text"]);
  });

  test("degrades an unknown domain instead of dropping the workspace", () => {
    const workspaces = workspaceListSchema.parse([
      {
        id: "ws-x",
        name: "X",
        createdAt: "2026-01-01T00:00:00.000Z",
        category: "not-a-domain",
        defaultScenarioIds: "not-an-array",
      },
    ]);

    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]!.category).toBeUndefined();
    expect(workspaces[0]!.defaultScenarioIds).toBeUndefined();
  });

  test("an old-shape workspace (no employee fields) parses with them undefined", () => {
    const [workspace] = workspaceListSchema.parse([
      {
        id: "ws-legacy",
        name: "Legacy",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    expect(workspace!.persona).toBeUndefined();
    expect(workspace!.responsibilities).toBeUndefined();
    expect(workspace!.skillIds).toBeUndefined();
    expect(workspace!.capabilityTags).toBeUndefined();
    expect(workspace!.agentKind).toBeUndefined();
    expect(workspace!.agentInstanceId).toBeUndefined();
    expect(workspace!.defaultThreadConfig).toBeUndefined();
    expect(workspace!.permissions).toBeUndefined();
  });

  test("keeps the employee (岗位) fields when present", () => {
    const [workspace] = workspaceListSchema.parse([
      {
        id: "ws-docs",
        name: "文档编写",
        createdAt: "2026-01-01T00:00:00.000Z",
        persona: "我是文档编写员工",
        responsibilities: ["需求文档", "设计文档"],
        skillIds: ["doc-writing", "srs"],
        capabilityTags: ["文档", "SRS"],
        agentKind: "codex",
        agentInstanceId: "my-codex",
        defaultThreadConfig: { model: "gpt-5" },
        permissions: { allowComputerUse: false, requireApproval: true },
      },
    ]);

    expect(workspace!.persona).toBe("我是文档编写员工");
    expect(workspace!.responsibilities).toEqual(["需求文档", "设计文档"]);
    expect(workspace!.skillIds).toEqual(["doc-writing", "srs"]);
    expect(workspace!.capabilityTags).toEqual(["文档", "SRS"]);
    expect(workspace!.agentKind).toBe("codex");
    expect(workspace!.agentInstanceId).toBe("my-codex");
    expect(workspace!.defaultThreadConfig).toEqual({ model: "gpt-5" });
    expect(workspace!.permissions).toEqual({
      allowComputerUse: false,
      requireApproval: true,
    });
  });

  test("degrades malformed employee fields instead of dropping the workspace", () => {
    const [workspace] = workspaceListSchema.parse([
      {
        id: "ws-bad",
        name: "Bad",
        createdAt: "2026-01-01T00:00:00.000Z",
        persona: 123,
        skillIds: "not-an-array",
        agentInstanceId: "",
        defaultThreadConfig: { model: 42 },
        permissions: { requireApproval: "yes" },
      },
    ]);

    expect(workspace!.persona).toBeUndefined();
    expect(workspace!.skillIds).toBeUndefined();
    expect(workspace!.agentInstanceId).toBeUndefined();
    expect(workspace!.defaultThreadConfig).toBeUndefined();
    expect(workspace!.permissions).toBeUndefined();
  });
});

describe("isPreviousDefaultWorkspaces", () => {
  const preRename = [
    { name: "通用任务" },
    { name: "文档编写" },
    { name: "软件编码" },
    { name: "软件测试" },
  ];

  test("true when names match the pre-rename default seed in order", () => {
    expect(isPreviousDefaultWorkspaces(preRename)).toBe(true);
  });

  test("false when the set differs in count or any name", () => {
    expect(isPreviousDefaultWorkspaces(preRename.slice(0, 3))).toBe(false);
    expect(
      isPreviousDefaultWorkspaces([
        { name: "通用任务" },
        { name: "自定义" },
        { name: "软件编码" },
        { name: "软件测试" },
      ]),
    ).toBe(false);
    expect(isPreviousDefaultWorkspaces([...preRename.slice(0, 3), { name: "工作区" }])).toBe(false);
  });
});

describe("isProjectInWorkspace", () => {
  test("matches only the active workspace", () => {
    expect(isProjectInWorkspace({ workspaceId: "ws-work" }, "ws-work", KNOWN)).toBe(true);
    expect(isProjectInWorkspace({ workspaceId: "ws-side" }, "ws-work", KNOWN)).toBe(false);
  });

  test("an unfiled project stays visible in every workspace", () => {
    expect(isProjectInWorkspace({}, "ws-work", KNOWN)).toBe(true);
    expect(isProjectInWorkspace({ workspaceId: undefined }, "ws-side", KNOWN)).toBe(true);
  });

  test("a dangling workspace id stays visible rather than hiding the project", () => {
    // The workspace was deleted on another device; hiding the project would make
    // it unreachable from the sidebar with no way to recover it.
    expect(isProjectInWorkspace({ workspaceId: "ws-deleted" }, "ws-work", KNOWN)).toBe(true);
  });

  test("no active workspace shows unfiled projects but not filed ones", () => {
    expect(isProjectInWorkspace({}, null, KNOWN)).toBe(true);
    expect(isProjectInWorkspace({ workspaceId: "ws-work" }, null, KNOWN)).toBe(false);
  });
});

describe("isThreadInWorkspace", () => {
  test("threads in real projects always pass — the project rule governs them", () => {
    expect(
      isThreadInWorkspace({ projectId: "proj-1", workspaceId: "ws-side" }, "ws-work", KNOWN),
    ).toBe(true);
    expect(isThreadInWorkspace({ projectId: "proj-1" }, "ws-work", KNOWN)).toBe(true);
  });

  test("a Home thread shows only in the workspace it is filed under", () => {
    expect(
      isThreadInWorkspace({ projectId: HOME_PROJECT_ID, workspaceId: "ws-work" }, "ws-work", KNOWN),
    ).toBe(true);
    expect(
      isThreadInWorkspace({ projectId: HOME_PROJECT_ID, workspaceId: "ws-side" }, "ws-work", KNOWN),
    ).toBe(false);
  });

  test("an untagged Home thread stays visible in every workspace", () => {
    expect(isThreadInWorkspace({ projectId: HOME_PROJECT_ID }, "ws-work", KNOWN)).toBe(true);
    expect(
      isThreadInWorkspace({ projectId: HOME_PROJECT_ID, workspaceId: undefined }, "ws-side", KNOWN),
    ).toBe(true);
  });

  test("a dangling workspace tag stays visible rather than hiding the thread", () => {
    expect(
      isThreadInWorkspace(
        { projectId: HOME_PROJECT_ID, workspaceId: "ws-deleted" },
        "ws-work",
        KNOWN,
      ),
    ).toBe(true);
  });

  test("no active workspace hides filed Home threads but keeps unfiled ones", () => {
    expect(isThreadInWorkspace({ projectId: HOME_PROJECT_ID }, null, KNOWN)).toBe(true);
    expect(
      isThreadInWorkspace({ projectId: HOME_PROJECT_ID, workspaceId: "ws-work" }, null, KNOWN),
    ).toBe(false);
  });

  test("a scope set covers workspaces beyond the active id itself", () => {
    // Selecting a primary 岗位 container covers its employees' workspaces, so a
    // project filed to an employee still shows in the post's view.
    const known = new Set(["ws-work", "ws-side", "ws-employee"]);
    const scope = new Set(["ws-work", "ws-employee"]);
    expect(isProjectInWorkspace({ workspaceId: "ws-employee" }, "ws-work", known, scope)).toBe(
      true,
    );
    expect(isProjectInWorkspace({ workspaceId: "ws-side" }, "ws-work", known, scope)).toBe(false);
    expect(
      isThreadInWorkspace(
        { projectId: HOME_PROJECT_ID, workspaceId: "ws-employee" },
        "ws-work",
        known,
        scope,
      ),
    ).toBe(true);
  });

  test("an empty scope set shows no filed work, only unfiled", () => {
    const scope = new Set<string>();
    expect(isProjectInWorkspace({}, "ws-work", KNOWN, scope)).toBe(true);
    expect(isProjectInWorkspace({ workspaceId: "ws-work" }, "ws-work", KNOWN, scope)).toBe(false);
  });
});
