import { describe, expect, it } from "vitest";
import {
  isProjectInWorkspace,
  type Team,
  type Workspace,
  type WorkspaceIconId,
} from "@/shared/contracts";
import {
  primaryWorkspaces,
  primaryContainerOf,
  secondaryEmployees,
  secondaryEmployeeCount,
  isPrimaryWorkspace,
  roleRankLabel,
  assignableWorkspaces,
  teamWorkspaces,
  visibleTeams,
  visibleEmployees,
  workspaceScopeIds,
} from "./workspaceHierarchy";

function team(id: string, name: string, extra: Partial<Team> = {}): Team {
  return {
    id,
    name,
    memberEmployeeIds: [],
    dispatchPolicy: "round-robin",
    createdAt: "2026-10-11T00:00:00.000Z",
    ...extra,
  };
}

function workspace(id: string, name: string, extra: Partial<Workspace> = {}): Workspace {
  return {
    id,
    name,
    icon: "briefcase" as WorkspaceIconId,
    createdAt: "2026-10-11T00:00:00.000Z",
    ...extra,
  };
}

const workspaces: Workspace[] = [
  // The four primary containers (no rank / no parent), in stored order.
  workspace("p-general", "通用任务岗"),
  workspace("p-docs", "文档编写岗"),
  workspace("p-code", "软件编码岗"),
  workspace("p-test", "软件测试岗"),
  // Secondary employees hanging under primaries.
  workspace("org-a", "编码 Lead", { parentWorkspaceId: "p-code", roleRank: 1 }),
  workspace("org-b", "编码工程师", { parentWorkspaceId: "p-code", roleRank: 2 }),
  workspace("org-c", "编码助手", { parentWorkspaceId: "p-code", roleRank: 3 }),
  workspace("org-d", "文档 Lead", { parentWorkspaceId: "p-docs", roleRank: 1 }),
  workspace("org-e", "测试工程师", { parentWorkspaceId: "p-test", roleRank: 3 }),
  // Orphan secondary (parent removed) — still attributes by parent, just not
  // listed under any live primary.
  workspace("org-f", "Orphan", { parentWorkspaceId: "p-gone", roleRank: 2 }),
];

describe("workspaceHierarchy", () => {
  it("primaryWorkspaces keeps only rank-less containers in stored order", () => {
    const primaries = primaryWorkspaces(workspaces);
    expect(primaries.map((w) => w.id)).toEqual(["p-general", "p-docs", "p-code", "p-test"]);
  });

  it("isPrimaryWorkspace keys off roleRank absence", () => {
    expect(isPrimaryWorkspace(workspaces[0]!)).toBe(true);
    expect(isPrimaryWorkspace(workspaces[4]!)).toBe(false);
  });

  it("primaryContainerOf resolves a primary container to itself", () => {
    expect(primaryContainerOf(workspaces, "p-code")?.id).toBe("p-code");
    expect(primaryContainerOf(workspaces, "p-general")?.id).toBe("p-general");
  });

  it("primaryContainerOf climbs a secondary employee to its owning container", () => {
    expect(primaryContainerOf(workspaces, "org-b")?.id).toBe("p-code");
    expect(primaryContainerOf(workspaces, "org-e")?.id).toBe("p-test");
  });

  it("primaryContainerOf falls back for an unknown id / orphan parent", () => {
    // Unknown id → first primary.
    expect(primaryContainerOf(workspaces, "nope")?.id).toBe("p-general");
    // Orphan employee whose parent no longer exists → first primary.
    expect(primaryContainerOf(workspaces, "org-f")?.id).toBe("p-general");
  });

  it("secondaryEmployees groups children by rank 1/2/3, preserving within-rank order", () => {
    const groups = secondaryEmployees(workspaces, "p-code");
    expect(groups.map((g) => g.rank)).toEqual([1, 2, 3]);
    expect(groups[0]!.employees.map((e) => e.id)).toEqual(["org-a"]);
    expect(groups[1]!.employees.map((e) => e.id)).toEqual(["org-b"]);
    expect(groups[2]!.employees.map((e) => e.id)).toEqual(["org-c"]);
  });

  it("omits empty ranks and only returns children of the requested primary", () => {
    const docs = secondaryEmployees(workspaces, "p-docs");
    expect(docs.map((g) => g.rank)).toEqual([1]);
    expect(docs[0]!.employees.map((e) => e.id)).toEqual(["org-d"]);

    const general = secondaryEmployees(workspaces, "p-general");
    expect(general).toEqual([]);
  });

  it("secondaryEmployeeCount sums across ranks", () => {
    expect(secondaryEmployeeCount(workspaces, "p-code")).toBe(3);
    expect(secondaryEmployeeCount(workspaces, "p-general")).toBe(0);
    // Orphans whose parent isn't a live primary never double-count anywhere.
    expect(secondaryEmployeeCount(workspaces, "p-gone")).toBe(1);
  });

  it("roleRankLabel returns a descriptor per rank", () => {
    expect(roleRankLabel(1).id).toBeDefined();
    expect(roleRankLabel(2).id).toBeDefined();
    expect(roleRankLabel(3).id).toBeDefined();
  });

  it("assignableWorkspaces shows only secondary employees once ranked, else falls back to flat", () => {
    // Hierarchical data: primaries drop out of the dock.
    expect(assignableWorkspaces(workspaces).map((w) => w.id)).toEqual([
      "org-a",
      "org-b",
      "org-c",
      "org-d",
      "org-e",
      "org-f",
    ]);

    // Legacy flat data (no ranks anywhere) keeps every workspace.
    const flat = [workspace("a", "A"), workspace("b", "B")];
    expect(assignableWorkspaces(flat).map((w) => w.id)).toEqual(["a", "b"]);
  });

  it("assignableWorkspaces drops hidden employees", () => {
    const withHidden = [
      ...workspaces,
      workspace("org-hidden", "Hidden Dev", {
        parentWorkspaceId: "p-code",
        roleRank: 2,
        hiddenInNav: true,
      }),
    ];
    const ids = assignableWorkspaces(withHidden).map((w) => w.id);
    expect(ids).not.toContain("org-hidden");
    expect(ids).toContain("org-a");
  });
});

describe("teamWorkspaces — team layer + visibility", () => {
  const teams = [
    team("mgmt-team", "管理团队"),
    team("test-team", "测试执行团队"),
    team("hidden-team", "隐藏团队", { hiddenInNav: true }),
  ];

  const ws: Workspace[] = [
    workspace("p-test", "软件测试岗"),
    // Management team (4 主管) under 软件测试岗.
    workspace("lead-1", "主管一", {
      parentWorkspaceId: "p-test",
      roleRank: 1,
      teamId: "mgmt-team",
    }),
    workspace("lead-2", "主管二", {
      parentWorkspaceId: "p-test",
      roleRank: 1,
      teamId: "mgmt-team",
    }),
    // Test execution team (R3).
    workspace("tester-1", "执行一", {
      parentWorkspaceId: "p-test",
      roleRank: 3,
      teamId: "test-team",
    }),
    workspace("tester-2", "审查一", {
      parentWorkspaceId: "p-test",
      roleRank: 3,
      teamId: "test-team",
    }),
    // Belongs to a hidden team → must not surface.
    workspace("ghost", "隐藏成员", {
      parentWorkspaceId: "p-test",
      roleRank: 2,
      teamId: "hidden-team",
    }),
    // No teamId → ungrouped fallback bucket.
    workspace("floater", "无团队员工", { parentWorkspaceId: "p-test", roleRank: 2 }),
    // A hidden individual employee → dropped even though its team is visible.
    workspace("hidden-individual", "隐藏个人", {
      parentWorkspaceId: "p-test",
      roleRank: 2,
      teamId: "mgmt-team",
      hiddenInNav: true,
    }),
  ];

  it("buckets employees by team, then by rank within each team", () => {
    const { teams: out } = teamWorkspaces(ws, teams, "p-test");
    expect(out.map((g) => g.team.id)).toEqual(["mgmt-team", "test-team"]);

    const mgmt = out[0]!;
    expect(mgmt.ranks.map((r) => r.rank)).toEqual([1]);
    expect(mgmt.ranks[0]!.employees.map((e) => e.id)).toEqual(["lead-1", "lead-2"]);

    const test = out[1]!;
    expect(test.ranks.map((r) => r.rank)).toEqual([3]);
    expect(test.ranks[0]!.employees.map((e) => e.id)).toEqual(["tester-1", "tester-2"]);
  });

  it("drops hidden teams (and their members) and hidden individuals", () => {
    const { teams: out } = teamWorkspaces(ws, teams, "p-test");
    // hidden-team never appears; its member "ghost" never appears anywhere.
    expect(out.map((g) => g.team.id)).not.toContain("hidden-team");
    const allIds = out.flatMap((g) => g.ranks.flatMap((r) => r.employees.map((e) => e.id)));
    expect(allIds).not.toContain("ghost");
    // Hidden individual still belongs to mgmt-team but is filtered out.
    expect(allIds).not.toContain("hidden-individual");
  });

  it("employees with no teamId land in the ungrouped fallback", () => {
    const { ungrouped } = teamWorkspaces(ws, teams, "p-test");
    expect(ungrouped.map((r) => r.rank)).toEqual([2]);
    expect(ungrouped[0]!.employees.map((e) => e.id)).toEqual(["floater"]);
  });

  it("returns empty buckets for a primary with no members", () => {
    const result = teamWorkspaces(ws, teams, "p-general");
    expect(result.teams).toEqual([]);
    expect(result.ungrouped).toEqual([]);
  });

  it("visibleTeams / visibleEmployees respect the flags", () => {
    expect(visibleTeams(teams).map((t) => t.id)).toEqual(["mgmt-team", "test-team"]);
    expect(visibleEmployees(ws).map((w) => w.id)).not.toContain("hidden-individual");
  });
});

describe("workspaceScopeIds", () => {
  const org: Workspace[] = [
    workspace("p-code", "软件编码岗"),
    workspace("p-docs", "文档编写岗"),
    workspace("org-a", "编码 Lead", { parentWorkspaceId: "p-code", roleRank: 1 }),
    workspace("org-b", "编码工程师", { parentWorkspaceId: "p-code", roleRank: 2 }),
    workspace("org-c", "文档 Lead", { parentWorkspaceId: "p-docs", roleRank: 1 }),
    workspace("orphan", "Orphan", { parentWorkspaceId: "p-gone", roleRank: 2 }),
  ];

  it("covers a container together with every employee under it", () => {
    expect([...workspaceScopeIds(org, "p-code")].sort()).toEqual(["org-a", "org-b", "p-code"]);
  });

  it("covers only the employee itself when a secondary is active", () => {
    expect([...workspaceScopeIds(org, "org-a")]).toEqual(["org-a"]);
  });

  it("returns an empty set for a null or unknown id", () => {
    expect(workspaceScopeIds(org, null).size).toBe(0);
    expect(workspaceScopeIds(org, "deleted").size).toBe(0);
  });

  it("never pulls in employees of a dangling parent", () => {
    // `orphan` hangs off a container that no longer exists, so no live selection
    // can claim it by accident.
    expect([...workspaceScopeIds(org, "p-docs")].sort()).toEqual(["org-c", "p-docs"]);
  });

  it("walks more than one level down", () => {
    const nested = [
      workspace("p-top", "Top"),
      workspace("mid", "Mid", { parentWorkspaceId: "p-top", roleRank: 1 }),
      workspace("leaf", "Leaf", { parentWorkspaceId: "mid", roleRank: 2 }),
    ];
    expect([...workspaceScopeIds(nested, "p-top")].sort()).toEqual(["leaf", "mid", "p-top"]);
  });

  it("feeds the membership rule so a post shows its employees' projects", () => {
    const known = new Set(org.map((w) => w.id));
    const scope = workspaceScopeIds(org, "p-code");
    // 编码工程师's project is visible while 软件编码岗 itself is selected…
    expect(isProjectInWorkspace({ workspaceId: "org-b" }, "p-code", known, scope)).toBe(true);
    // …but a sibling post's project is not.
    expect(isProjectInWorkspace({ workspaceId: "org-c" }, "p-code", known, scope)).toBe(false);
  });
});
