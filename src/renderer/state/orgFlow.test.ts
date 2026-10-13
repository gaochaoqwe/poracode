import { describe, expect, it } from "vitest";
import {
  buildOrgFlow,
  isBottleneckNode,
  orgFlowLegend,
  BOTTLENECK_THRESHOLD,
  phaseProgress,
  phaseStallMinutes,
  projectPhaseFromThreadItems,
  pipelineLanesFromThreadItems,
  type OrgFlowPhaseNode,
} from "./orgFlow";
import { ORG_CAPABILITIES } from "@/shared/orgCapabilities";

import type { Workspace } from "@/shared/contracts";

function ws(partial: {
  id: string;
  name: string;
  roleRank?: 1 | 2 | 3;
  parentWorkspaceId?: string;
  teamId?: string;
  hiddenInNav?: boolean;
  capabilityIds?: string[];
}): Workspace {
  return {
    agentKind: "openai",
    accentColor: "#ffffff",
    ...partial,
  } as unknown as Workspace;
}

describe("buildOrgFlow", () => {
  it("groups level-2 employees under their level-1 container", () => {
    const data = buildOrgFlow([
      ws({ id: "c-test", name: "Software testing" }),
      ws({
        id: "org-lead",
        name: "Dev lead",
        roleRank: 2,
        parentWorkspaceId: "c-test",
        capabilityIds: ["code-review"],
      }),
      ws({ id: "org-b", name: "Bob", roleRank: 2, parentWorkspaceId: "c-test" }),
    ]);
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]!.name).toBe("Software testing");
    expect(data.groups[0]!.directEmployees.map((e) => e.id)).toEqual(["org-lead", "org-b"]);
    expect(data.unranked).toEqual([]);
  });

  it("buckets employees into team sub-lanes under their container", () => {
    const teams = [
      { id: "t-mgmt", name: "Management team" },
      { id: "t-exec", name: "Test execution team" },
    ];
    const data = buildOrgFlow(
      [
        ws({ id: "c-test", name: "Software testing" }),
        ws({
          id: "org-mgr",
          name: "Test lead",
          roleRank: 2,
          parentWorkspaceId: "c-test",
          teamId: "t-mgmt",
        }),
        ws({
          id: "org-des",
          name: "Designer 1",
          roleRank: 1,
          parentWorkspaceId: "c-test",
          teamId: "t-exec",
        }),
      ],
      teams as never,
    );
    const group = data.groups[0]!;
    expect(group.teams.map((t) => t.name)).toEqual(["Management team", "Test execution team"]);
    expect(group.teams[0]!.employees.map((e) => e.id)).toEqual(["org-mgr"]);
    expect(group.teams[1]!.employees.map((e) => e.id)).toEqual(["org-des"]);
  });

  it("filters hidden employees and hidden teams", () => {
    const data = buildOrgFlow(
      [
        ws({ id: "c-test", name: "Software testing" }),
        ws({
          id: "org-a",
          name: "Ada",
          roleRank: 1,
          parentWorkspaceId: "c-test",
          hiddenInNav: true,
        }),
        ws({
          id: "org-b",
          name: "Bob",
          roleRank: 1,
          parentWorkspaceId: "c-test",
          teamId: "t-hidden",
        }),
        ws({ id: "org-c", name: "Cyd", roleRank: 1, parentWorkspaceId: "c-test" }),
      ],
      [{ id: "t-hidden", name: "Hidden team", hiddenInNav: true } as never],
    );
    expect(data.groups[0]!.directEmployees.map((e) => e.id)).toEqual(["org-c"]);
  });

  it("resolves configured+implemented capabilities as have", () => {
    const data = buildOrgFlow([
      ws({ id: "org-a", name: "Ada", roleRank: 1, capabilityIds: ["code-review"] }),
    ]);
    const node = data.unranked[0]!;
    const cap = node.capabilities.find((c) => c.id === "code-review")!;
    expect(cap.configured).toBe(true);
    expect(cap.implemented).toBe(true);
    expect(node.missingCount).toBe(0);
  });

  it("flags configured-but-unimplemented capabilities as missing", () => {
    const data = buildOrgFlow([
      ws({
        id: "org-a",
        name: "Ada",
        roleRank: 1,
        capabilityIds: ["cross-role-handoff", "site-replay-skill"],
      }),
    ]);
    const node = data.unranked[0]!;
    expect(node.missingCount).toBe(2);
    expect(node.missingIds.sort()).toEqual(["cross-role-handoff", "site-replay-skill"]);
  });

  it("treats unknown custom ids as missing-and-unknown", () => {
    const data = buildOrgFlow([
      ws({ id: "org-a", name: "Ada", roleRank: 1, capabilityIds: ["code.write", "custom.shrug"] }),
    ]);
    const node = data.unranked[0]!;
    const custom = node.capabilities.find((c) => c.id === "custom.shrug")!;
    expect(custom.configured).toBe(true);
    expect(custom.implemented).toBe(false);
    expect(custom.unknown).toBe(true);
    expect(node.missingIds).toContain("custom.shrug");
  });

  it("exposes every registry capability per node", () => {
    const data = buildOrgFlow([ws({ id: "org-a", name: "Ada", roleRank: 1 })]);
    expect(data.unranked[0]!.capabilities.length).toBeGreaterThanOrEqual(ORG_CAPABILITIES.length);
  });
});

describe("pipeline phases", () => {
  it("phaseProgress maps a stage to its index/total", () => {
    expect(phaseProgress("planning")).toEqual({ index: 0, total: 5 });
    expect(phaseProgress("dynamic")).toEqual({ index: 2, total: 5 });
    expect(phaseProgress("done")).toEqual({ index: 4, total: 5 });
  });

  it("phaseStallMinutes converts enteredAt to elapsed minutes", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(phaseStallMinutes(undefined, now)).toBeUndefined();
    expect(phaseStallMinutes("2026-10-11T11:48:00Z", now)).toBe(12);
  });

  it("projectPhaseFromThreadItems projects test_phase_advance calls", () => {
    const lane = projectPhaseFromThreadItems("org-a", {
      itemIds: ["i1", "i2"],
      items: {
        i1: { payload: { name: "Read", args: {}, result: {} } },
        i2: {
          payload: {
            name: "test_phase_advance",
            args: { projectId: "p1", projectName: "M100" },
            result: { phase: "dynamic", updatedAt: "2026-10-11T11:00:00Z" },
          },
        },
      },
    });
    expect(lane).toEqual({
      projectId: "p1",
      projectName: "M100",
      phase: "dynamic",
      ownerEmployeeId: "org-a",
      enteredAt: "2026-10-11T11:00:00Z",
    });
    expect(
      projectPhaseFromThreadItems("org-a", {
        itemIds: ["i1"],
        items: { i1: { payload: { name: "Read" } } },
      }),
    ).toBeUndefined();
  });

  it("buildOrgFlow keeps passed pipeline lanes", () => {
    const lanes: OrgFlowPhaseNode[] = [{ projectId: "p1", phase: "report" }];
    const data = buildOrgFlow([], [], lanes);
    expect(data.pipelineLanes).toHaveLength(1);
  });

  it("pipelineLanesFromThreadItems merges multi-employee projections, latest enteredAt wins", () => {
    const lanes = pipelineLanesFromThreadItems([
      {
        employeeId: "org-a",
        threads: [
          {
            itemIds: ["i1"],
            items: {
              i1: {
                payload: {
                  name: "test_phase_advance",
                  args: { projectId: "p1", projectName: "M100" },
                  result: { phase: "dynamic", updatedAt: "2026-10-11T10:00:00Z" },
                },
              },
            },
          },
        ],
      },
      {
        employeeId: "org-b",
        threads: [
          {
            itemIds: ["i2", "i3"],
            items: {
              i2: {
                payload: {
                  name: "test_phase_advance",
                  args: { projectId: "p1" },
                  result: { phase: "report", updatedAt: "2026-10-11T11:30:00Z" },
                },
              },
              i3: { payload: { name: "Read" } },
            },
          },
        ],
      },
      { employeeId: "org-c", threads: [{ itemIds: [], items: {} }] },
    ]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.phase).toBe("report");
    expect(lanes[0]!.ownerEmployeeId).toBe("org-b");
    expect(lanes[0]!.projectName).toBe("M100");
  });
});

describe("isBottleneckNode", () => {
  it("marks cards with ≥2 missing capabilities as bottlenecks", () => {
    expect(BOTTLENECK_THRESHOLD).toBe(2);
    expect(isBottleneckNode({ missingCount: 1 })).toBe(false);
    expect(isBottleneckNode({ missingCount: 2 })).toBe(true);
  });
});

describe("orgFlowLegend", () => {
  it("ships have / missing / unconfigured rows", () => {
    expect(orgFlowLegend().map((e) => e.id)).toEqual(["have", "missing", "unconfigured"]);
  });
});
