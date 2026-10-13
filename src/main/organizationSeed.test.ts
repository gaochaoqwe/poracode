import { describe, expect, it } from "vitest";
import {
  CHIEF_STEWARD_ROLE_ID,
  MANAGEMENT_TEAM,
  ORGANIZATION_ROLES,
  ORGANIZATION_SEED_VERSION,
  ORGANIZATION_TEAM,
  PRIMARY_CONTAINERS,
  ensureOrganizationSeed,
} from "./organizationSeed";
import type { SharedSettings } from "@/shared/settings";
import type { Workspace, WorkspaceIconId } from "@/shared/contracts";

const fixedClock = () => "2024-06-01T00:00:00.000Z";

function ws(partial: Partial<Workspace> & { id: string; name: string }): Workspace {
  return { createdAt: "2024-01-01T00:00:00.000Z", icon: "briefcase", ...partial } as Workspace;
}

const CONTAINER_ICONS: WorkspaceIconId[] = ["briefcase", "palette", "code", "sprout"];

/** Settings with no seed applied yet. */
function makeSettings(overrides: Partial<SharedSettings> = {}): SharedSettings {
  return {
    workspaces: [],
    teams: [],
    chiefStewardWorkspaceId: undefined,
    organizationSeedVersion: undefined,
    ...overrides,
  } as unknown as SharedSettings;
}

/** The 4 default top-level containers a fresh install already ships with. */
function defaultContainerWorkspaces(): Workspace[] {
  return PRIMARY_CONTAINERS.map((c, i) =>
    ws({ id: `bootstrap-${c.key}`, name: c.name, icon: CONTAINER_ICONS[i]! }),
  );
}

describe("ensureOrganizationSeed", () => {
  it("fresh install (containers already exist): reuses their ids and hangs 11 roles under them", () => {
    const before = makeSettings({ workspaces: defaultContainerWorkspaces() });
    const { changed, settings } = ensureOrganizationSeed(before, fixedClock);

    expect(changed).toBe(true);
    // 4 reused containers + 11 secondary roles, nothing else.
    expect(settings.workspaces).toHaveLength(4 + ORGANIZATION_ROLES.length);

    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));

    // Containers are reused (bootstrap ids kept) and carry no rank/parent.
    for (const c of PRIMARY_CONTAINERS) {
      const container = byId.get(`bootstrap-${c.key}`)!;
      expect(container.name).toBe(c.name);
      expect(container.roleRank).toBeUndefined();
      expect(container.parentWorkspaceId).toBeUndefined();
    }

    // Every secondary role has a valid rank and a parent pointing at a container.
    const containerIds = new Set(PRIMARY_CONTAINERS.map((c) => `bootstrap-${c.key}`));
    for (const role of ORGANIZATION_ROLES) {
      const seeded = byId.get(role.id)!;
      expect(seeded.roleRank).toBe(role.roleRank);
      expect(containerIds.has(seeded.parentWorkspaceId!)).toBe(true);
    }

    expect(settings.chiefStewardWorkspaceId).toBe(CHIEF_STEWARD_ROLE_ID);
    expect(settings.teams.map((t) => t.id)).toContain(ORGANIZATION_TEAM.id);
    expect(settings.organizationSeedVersion).toBe(ORGANIZATION_SEED_VERSION);
  });

  it("fresh install (no containers): creates the 4 fixed-id containers", () => {
    const { settings } = ensureOrganizationSeed(makeSettings(), fixedClock);
    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));

    for (const c of PRIMARY_CONTAINERS) {
      const container = byId.get(c.fixedId)!;
      expect(container.name).toBe(c.name);
      expect(container.roleRank).toBeUndefined();
    }
    // No stray containers beyond the 4.
    const containers = settings.workspaces.filter((w) => !w.id.startsWith("org-"));
    expect(containers).toHaveLength(4);
  });

  it("v1 flat seed: backfills rank/parent, preserves user fields, renames to new names", () => {
    // Simulate a v1 install: 11 flat org roles, no rank/parent, version=1, one
    // role already bound by the user (agentKind + custom persona). Roles carry
    // their v1 default names (which differ from the v3 names).
    const v1Workspaces: Workspace[] = ORGANIZATION_ROLES.map((role) =>
      ws({
        id: role.id,
        name: role.previousNames?.[0] ?? role.name,
        ...(role.id === "org-test-lead"
          ? { agentKind: "user-chosen-provider", persona: "用户自定义的测试主管人设" }
          : {}),
      }),
    );
    const before = makeSettings({
      workspaces: v1Workspaces,
      teams: [
        {
          id: ORGANIZATION_TEAM.id,
          name: "测试团队",
          memberEmployeeIds: [...ORGANIZATION_TEAM.memberEmployeeIds],
          dispatchPolicy: "round-robin",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      chiefStewardWorkspaceId: CHIEF_STEWARD_ROLE_ID,
      organizationSeedVersion: 1,
    });

    const { changed, settings } = ensureOrganizationSeed(before, fixedClock);
    expect(changed).toBe(true);

    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));

    // Backfilled rank/parent onto existing roles.
    const testLead = byId.get("org-test-lead")!;
    expect(testLead.roleRank).toBe(2);
    expect(testLead.parentWorkspaceId).toBe("primary-test");
    // User binding + custom persona preserved (not clobbered).
    expect(testLead.agentKind).toBe("user-chosen-provider");
    expect(testLead.persona).toBe("用户自定义的测试主管人设");

    // v1 default names are upgraded to the current names.
    expect(byId.get("org-oa")!.name).toBe("办公主管");
    expect(byId.get("org-test-project-lead")!.name).toBe("测试项目主管");
    expect(byId.get("org-test-project-lead")!.roleRank).toBe(3);
    expect(byId.get("org-test-designer-1")!.name).toBe("设计师（文档审查）");
    expect(byId.get("org-test-qa-1")!.name).toBe("质量审查（表单）");

    // Containers ensured (none existed in v1, so fixed ids are created).
    expect(byId.get("primary-test")?.name).toBe("软件测试岗");
    expect(byId.get("primary-docs")?.name).toBe("文档编写岗");

    // v1 chief steward binding kept.
    expect(settings.chiefStewardWorkspaceId).toBe(CHIEF_STEWARD_ROLE_ID);
    expect(settings.organizationSeedVersion).toBe(ORGANIZATION_SEED_VERSION);
  });

  it("v2 seed: renames default names and moves project-lead to rank 3", () => {
    // A v2 install: containers exist; org roles carry the v2 names and the v2
    // ranks (project-lead was rank 2). designer-2's name was customized by user.
    const v2Names: Record<string, string> = {
      "org-test-designer-1": "测试执行设计师1",
      "org-test-designer-2": "测试执行设计师2",
      "org-test-designer-3": "测试执行设计师3",
      "org-test-designer-4": "测试执行设计师4",
      "org-test-designer-5": "测试执行设计师5",
      "org-test-qa-1": "质量审查1",
      "org-test-qa-2": "质量审查2",
      "org-test-project-lead": "项目主管",
    };
    const v2Workspaces: Workspace[] = [
      ...defaultContainerWorkspaces(),
      ...ORGANIZATION_ROLES.map((role) =>
        ws({
          id: role.id,
          name:
            role.id === "org-test-designer-2" ? "我的静态分析岗" : (v2Names[role.id] ?? role.name),
          roleRank: role.id === "org-test-project-lead" ? 2 : role.roleRank,
          parentWorkspaceId: "primary-test",
        }),
      ),
    ];
    const before = makeSettings({ workspaces: v2Workspaces, organizationSeedVersion: 2 });

    const { changed, settings } = ensureOrganizationSeed(before, fixedClock);
    expect(changed).toBe(true);
    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));

    // Default v2 names upgraded to v3.
    expect(byId.get("org-test-designer-1")!.name).toBe("设计师（文档审查）");
    expect(byId.get("org-test-designer-3")!.name).toBe("设计师（代码审查）");
    expect(byId.get("org-test-designer-5")!.name).toBe("设计师（编写报告）");
    expect(byId.get("org-test-qa-1")!.name).toBe("质量审查（表单）");
    expect(byId.get("org-test-qa-2")!.name).toBe("质量审查（报告）");
    expect(byId.get("org-test-project-lead")!.name).toBe("测试项目主管");
    // project-lead carried the v2 default rank 2 → v10 moves it to execution rank 3.
    expect(byId.get("org-test-project-lead")!.roleRank).toBe(3);
    // User-customized name preserved.
    expect(byId.get("org-test-designer-2")!.name).toBe("我的静态分析岗");

    expect(settings.organizationSeedVersion).toBe(ORGANIZATION_SEED_VERSION);
  });

  it("v2 migration preserves a user-set project-lead rank", () => {
    const v2Workspaces: Workspace[] = [
      ...defaultContainerWorkspaces(),
      ...ORGANIZATION_ROLES.map((role) =>
        ws({
          id: role.id,
          name: role.id === "org-test-project-lead" ? "项目主管" : role.name,
          roleRank: role.id === "org-test-project-lead" ? 1 : role.roleRank, // user chose rank 1
          parentWorkspaceId: "primary-test",
        }),
      ),
    ];
    const before = makeSettings({ workspaces: v2Workspaces, organizationSeedVersion: 2 });
    const { settings } = ensureOrganizationSeed(before, fixedClock);

    // Not the v2 default (2), so the rank migration does not fire.
    expect(settings.workspaces.find((w) => w.id === "org-test-project-lead")?.roleRank).toBe(1);
  });

  it("v2 migration preserves a user-renamed org-oa", () => {
    const v1Workspaces: Workspace[] = ORGANIZATION_ROLES.map((role) =>
      ws({ id: role.id, name: role.id === "org-oa" ? "我的办公岗" : role.name }),
    );
    const before = makeSettings({ workspaces: v1Workspaces, organizationSeedVersion: 1 });
    const { settings } = ensureOrganizationSeed(before, fixedClock);

    expect(settings.workspaces.find((w) => w.id === "org-oa")?.name).toBe("我的办公岗");
  });

  it("is idempotent: an already-current settings runs zero changes", () => {
    const first = ensureOrganizationSeed(
      makeSettings({ workspaces: defaultContainerWorkspaces() }),
      fixedClock,
    ).settings;
    const second = ensureOrganizationSeed(first, fixedClock);

    expect(second.changed).toBe(false);
    expect(second.settings).toBe(first);
  });

  it("does not overwrite an already-configured chief steward id", () => {
    const before = makeSettings({
      workspaces: defaultContainerWorkspaces(),
      chiefStewardWorkspaceId: "bootstrap-general",
    });
    const { settings } = ensureOrganizationSeed(before, fixedClock);

    expect(settings.chiefStewardWorkspaceId).toBe("bootstrap-general");
  });

  it("has internally consistent role data", () => {
    const ids = ORGANIZATION_ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("org-"))).toBe(true);

    for (const role of ORGANIZATION_ROLES) {
      expect(role.name.trim().length).toBeGreaterThan(0);
      expect(role.persona.trim().length).toBeGreaterThan(0);
      expect(role.responsibilities.length).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(role.roleRank);
      expect(role.permissions.requireApproval).toBe(true);
      expect(role.permissions.allowComputerUse).toBe(false);
    }

    expect(ids).toContain(ORGANIZATION_TEAM.managerEmployeeId);
    for (const memberId of ORGANIZATION_TEAM.memberEmployeeIds) {
      expect(ids).toContain(memberId);
    }
    expect(ORGANIZATION_TEAM.memberEmployeeIds).toHaveLength(7);
    expect(ORGANIZATION_TEAM.dispatchPolicy).toBe("round-robin");

    // v7: every employee hangs under the 软件测试岗 container, grouped by team.
    const parentByRole = new Map(ORGANIZATION_ROLES.map((r) => [r.id, r.parentContainerKey]));
    for (const role of ORGANIZATION_ROLES) {
      expect(parentByRole.get(role.id)).toBe("test");
    }
    // Management team members vs test-execution team members.
    const mgmtMembers = new Set(MANAGEMENT_TEAM.memberEmployeeIds);
    expect(MANAGEMENT_TEAM.managerEmployeeId).toBe(CHIEF_STEWARD_ROLE_ID);
    for (const memberId of MANAGEMENT_TEAM.memberEmployeeIds) {
      expect(ids).toContain(memberId);
    }
    for (const memberId of ORGANIZATION_TEAM.memberEmployeeIds) {
      expect(mgmtMembers.has(memberId)).toBe(false);
    }
  });

  it("grounds key roles in the testing business vocabulary", () => {
    const byId = new Map(ORGANIZATION_ROLES.map((r) => [r.id, r]));

    const testLead = byId.get("org-test-lead")!;
    expect(testLead.persona).toContain("流水线");
    expect(testLead.persona).toContain("参考资料");
    expect(testLead.persona).toContain("P0~P14");
    expect(testLead.capabilityTags).toContain("测试策划");

    const oa = byId.get("org-oa")!;
    expect(oa.name).toBe("办公主管");
    expect(oa.persona).toContain("Word");
    expect(oa.persona).toContain("Excel");
    expect(oa.persona).toContain("PPT");
    expect(oa.persona).toContain(".zip");

    const designer4 = byId.get("org-test-designer-4")!;
    expect(designer4.persona).toContain("用例表");

    // v3 display names.
    const expectedNames: Record<string, string> = {
      "org-test-project-lead": "测试项目主管",
      "org-test-designer-1": "设计师（文档审查）",
      "org-test-designer-2": "设计师（静态分析）",
      "org-test-designer-3": "设计师（代码审查）",
      "org-test-designer-4": "设计师（动态测试）",
      "org-test-designer-5": "设计师（编写报告）",
      "org-test-qa-1": "质量审查（表单）",
      "org-test-qa-2": "质量审查（报告）",
    };
    for (const [id, name] of Object.entries(expectedNames)) {
      expect(byId.get(id)!.name).toBe(name);
    }
    // project-lead is a permanent management employee at execution rank 3.
    expect(byId.get("org-test-project-lead")!.roleRank).toBe(3);
  });

  it("seeds roles with no provider binding and approval required", () => {
    const { settings } = ensureOrganizationSeed(
      makeSettings({ workspaces: defaultContainerWorkspaces() }),
      fixedClock,
    );
    const seeded = settings.workspaces.filter((w) => w.id.startsWith("org-"));

    expect(seeded).toHaveLength(ORGANIZATION_ROLES.length);
    for (const w of seeded) {
      expect(w.agentKind).toBeUndefined();
      expect(w.agentInstanceId).toBeUndefined();
      expect(w.persona?.trim().length).toBeGreaterThan(0);
      expect(w.permissions?.requireApproval).toBe(true);
    }
  });

  it("fresh install seeds skillIds, and every employee carries file-operations", () => {
    const { settings } = ensureOrganizationSeed(
      makeSettings({ workspaces: defaultContainerWorkspaces() }),
      fixedClock,
    );
    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));

    expect(byId.get("org-test-lead")!.skillIds).toEqual(["pipeline-control", "file-operations"]);
    expect(byId.get("org-test-project-lead")!.skillIds).toEqual([
      "pipeline-control",
      "file-operations",
    ]);
    expect(byId.get("org-test-designer-4")!.skillIds).toEqual([
      "pipeline-control",
      "file-operations",
    ]);
    expect(byId.get("org-test-designer-5")!.skillIds).toEqual([
      "pipeline-control",
      "file-operations",
    ]);
    expect(byId.get("org-chief-steward")!.skillIds).toEqual([
      "oa-jprjcp-collect",
      "mxt-collect",
      "file-operations",
    ]);
    // Previously-undefined roles now carry just the mandatory baseline.
    expect(byId.get("org-oa")!.skillIds).toEqual(["file-operations"]);
    expect(byId.get("org-test-designer-1")!.skillIds).toEqual(["file-operations"]);

    // Every seeded employee must carry the mandatory baseline skill.
    for (const role of ORGANIZATION_ROLES) {
      expect(byId.get(role.id)!.skillIds).toContain("file-operations");
    }
  });

  it("v3→v5 migration: fills missing defaults, keeps user skills, ensures file-operations, idempotent", () => {
    // A v3 install: containers + the 11 roles, no skillIds. The user already
    // bound their own skill onto test-lead; designer-4 is untouched (undefined).
    const v3Workspaces: Workspace[] = [
      ...defaultContainerWorkspaces(),
      ...ORGANIZATION_ROLES.map((role) =>
        ws({
          id: role.id,
          name: role.name,
          roleRank: role.roleRank,
          parentWorkspaceId: "primary-test",
          ...(role.id === "org-test-lead" ? { skillIds: ["user-chosen-skill"] } : {}),
        }),
      ),
    ];
    const before = makeSettings({ workspaces: v3Workspaces, organizationSeedVersion: 3 });

    const { changed, settings } = ensureOrganizationSeed(before, fixedClock);
    expect(changed).toBe(true);
    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));

    // Empty/missing → default seeded set filled (now incl. file-operations).
    expect(byId.get("org-test-project-lead")!.skillIds).toEqual([
      "pipeline-control",
      "file-operations",
    ]);
    expect(byId.get("org-test-designer-4")!.skillIds).toEqual([
      "pipeline-control",
      "file-operations",
    ]);
    expect(byId.get("org-test-designer-5")!.skillIds).toEqual([
      "pipeline-control",
      "file-operations",
    ]);
    expect(byId.get("org-chief-steward")!.skillIds).toEqual([
      "oa-jprjcp-collect",
      "mxt-collect",
      "file-operations",
    ]);
    // User's own skill retained, mandatory baseline appended on top.
    expect(byId.get("org-test-lead")!.skillIds).toEqual(["user-chosen-skill", "file-operations"]);
    expect(settings.organizationSeedVersion).toBe(ORGANIZATION_SEED_VERSION);

    // Idempotent: a current settings re-run changes nothing.
    const second = ensureOrganizationSeed(settings, fixedClock);
    expect(second.changed).toBe(false);
    expect(second.settings).toBe(settings);
  });

  it("fresh install pre-seeds capabilityIds per role", () => {
    const { settings } = ensureOrganizationSeed(
      makeSettings({ workspaces: defaultContainerWorkspaces() }),
      fixedClock,
    );
    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));

    expect(byId.get("org-test-lead")!.capabilityIds).toEqual([
      "pipeline-control",
      "pipeline-phase",
      "test-workbook",
      "report-draft",
      "oa-submission",
      "file-operations",
      "approval-gate",
    ]);
    expect(byId.get("org-oa")!.capabilityIds).toEqual([
      "oa-submission",
      "oa-material-skeleton",
      "doc-generation",
      "file-operations",
      "approval-gate",
    ]);
    expect(byId.get("org-test-designer-1")!.capabilityIds).toEqual([
      "doc-form-review",
      "doc-generation",
      "file-operations",
    ]);
    // Every employee carries at least the mandatory baseline capability.
    for (const role of ORGANIZATION_ROLES) {
      expect(byId.get(role.id)!.capabilityIds).toContain("file-operations");
    }
  });

  it("v5→v6 migration: fills missing capabilityIds, preserves user selection, idempotent", () => {
    // A v5 install: roles carry skillIds but no capabilityIds; the user already
    // picked their own capabilityIds for test-lead.
    const v5Workspaces: Workspace[] = [
      ...defaultContainerWorkspaces(),
      ...ORGANIZATION_ROLES.map((role) =>
        ws({
          id: role.id,
          name: role.name,
          roleRank: role.roleRank,
          parentWorkspaceId: "primary-test",
          ...(role.id === "org-test-lead" ? { capabilityIds: ["user-chosen-cap"] } : {}),
        }),
      ),
    ];
    const before = makeSettings({ workspaces: v5Workspaces, organizationSeedVersion: 5 });

    const { changed, settings } = ensureOrganizationSeed(before, fixedClock);
    expect(changed).toBe(true);
    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));

    // Empty/missing → default pre-seeded set.
    expect(byId.get("org-oa")!.capabilityIds).toEqual([
      "oa-submission",
      "oa-material-skeleton",
      "doc-generation",
      "file-operations",
      "approval-gate",
    ]);
    expect(byId.get("org-test-designer-2")!.capabilityIds).toEqual([
      "static-analysis",
      "file-operations",
    ]);
    // User's own non-empty capabilityIds preserved (no mandatory merge).
    expect(byId.get("org-test-lead")!.capabilityIds).toEqual(["user-chosen-cap"]);
    expect(settings.organizationSeedVersion).toBe(ORGANIZATION_SEED_VERSION);

    // Idempotent.
    const second = ensureOrganizationSeed(settings, fixedClock);
    expect(second.changed).toBe(false);
    expect(second.settings).toBe(settings);
  });

  it("v7 fresh tree: leads in mgmt-team under test container, execution staff in org-test-team", () => {
    const { settings } = ensureOrganizationSeed(
      makeSettings({ workspaces: defaultContainerWorkspaces() }),
      fixedClock,
    );
    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));
    const testContainerId = "bootstrap-test";

    // Management team members: chief(R1)/test-lead/project-lead/dev-lead/oa(R2)
    // → test container + mgmt-team (project lead is a permanent employee).
    for (const id of [
      CHIEF_STEWARD_ROLE_ID,
      "org-test-lead",
      "org-test-project-lead",
      "org-dev-lead",
      "org-oa",
    ]) {
      const w = byId.get(id)!;
      expect(w.parentWorkspaceId).toBe(testContainerId);
      expect(w.teamId).toBe("mgmt-team");
    }
    expect(byId.get("org-test-project-lead")!.roleRank).toBe(3);
    expect(byId.get("org-dev-lead")!.name).toBe("开发主管");
    expect(byId.get("org-dev-lead")!.roleRank).toBe(2);

    // Execution staff → test container + org-test-team.
    for (const memberId of ORGANIZATION_TEAM.memberEmployeeIds) {
      const w = byId.get(memberId)!;
      expect(w.parentWorkspaceId).toBe(testContainerId);
      expect(w.teamId).toBe("org-test-team");
    }

    // Both team entities exist.
    const teamIds = settings.teams.map((t) => t.id);
    expect(teamIds).toContain("org-test-team");
    expect(teamIds).toContain("mgmt-team");
    const mgmt = settings.teams.find((t) => t.id === "mgmt-team")!;
    expect(mgmt.managerEmployeeId).toBe(CHIEF_STEWARD_ROLE_ID);
    expect(mgmt.memberEmployeeIds).toEqual([
      "org-test-lead",
      "org-test-project-lead",
      "org-dev-lead",
      "org-oa",
    ]);
  });

  it("v6→v7 migration: repoints leads/oa to test container, assigns teams, preserves user parent, idempotent", () => {
    // A v6 install: containers exist; chief hung under general, oa under docs,
    // no teamId anywhere. The user deliberately kept test-lead's parent as a
    // custom id — that must be preserved.
    const v6Workspaces: Workspace[] = [
      ...defaultContainerWorkspaces(),
      ...ORGANIZATION_ROLES.map((role) => {
        let parent = "primary-test";
        if (role.id === "org-chief-steward") parent = "bootstrap-general";
        if (role.id === "org-oa") parent = "bootstrap-docs";
        if (role.id === "org-test-lead") parent = "user-custom-parent";
        return ws({
          id: role.id,
          name: role.name,
          roleRank: role.roleRank,
          parentWorkspaceId: parent,
        });
      }),
    ];
    const before = makeSettings({ workspaces: v6Workspaces, organizationSeedVersion: 6 });

    const { changed, settings } = ensureOrganizationSeed(before, fixedClock);
    expect(changed).toBe(true);
    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));

    // Default legacy parents repointed to the test container.
    expect(byId.get("org-chief-steward")!.parentWorkspaceId).toBe("bootstrap-test");
    expect(byId.get("org-oa")!.parentWorkspaceId).toBe("bootstrap-test");
    // User-chosen parent preserved.
    expect(byId.get("org-test-lead")!.parentWorkspaceId).toBe("user-custom-parent");

    // teamId filled in for everyone (was undefined).
    expect(byId.get("org-chief-steward")!.teamId).toBe("mgmt-team");
    expect(byId.get("org-oa")!.teamId).toBe("mgmt-team");
    expect(byId.get("org-dev-lead")!.teamId).toBe("mgmt-team");
    expect(byId.get("org-test-designer-4")!.teamId).toBe("org-test-team");

    // mgmt-team entity appended.
    expect(settings.teams.map((t) => t.id)).toContain("mgmt-team");
    expect(settings.organizationSeedVersion).toBe(ORGANIZATION_SEED_VERSION);

    // Idempotent.
    const second = ensureOrganizationSeed(settings, fixedClock);
    expect(second.changed).toBe(false);
    expect(second.settings).toBe(settings);
  });

  it("v8 fresh: responsibility text and dev-lead capabilityIds are updated", () => {
    const { settings } = ensureOrganizationSeed(
      makeSettings({ workspaces: defaultContainerWorkspaces() }),
      fixedClock,
    );
    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));

    // dev-lead is a 台账 role: task-panel first sentence, ledger capability set.
    const devLead = byId.get("org-dev-lead")!;
    expect(devLead.persona).toContain("任务面板台账负责人");
    expect(devLead.capabilityIds).toEqual(["task-inbox", "doc-generation", "file-operations"]);

    // project-lead runs the P1 admission review (file-system flow).
    expect(byId.get("org-test-project-lead")!.responsibilities![0]).toContain("准入审查");

    // designer-4 = case authoring + requirements analysis.
    expect(byId.get("org-test-designer-4")!.responsibilities).toEqual([
      "编写动态测试用例（测试用例单）",
      "生成需求分析表",
      "记录动态测试问题到问题报告单 sheet",
    ]);

    // QA narrowed.
    expect(byId.get("org-test-qa-1")!.responsibilities).toContain("审查测试用例单");
    expect(byId.get("org-test-qa-2")!.responsibilities![0]).toBe("只审查流水线产出的测试报告");

    // chief routes part of work to dev-lead.
    expect(byId.get("org-chief-steward")!.persona).toContain("转派开发主管");
  });

  it("v7→v8 migration: updates default text, preserves user persona, fills missing capabilityIds, idempotent", () => {
    // A v7 install: roles carry the v7 default persona/responsibilities; chief
    // has a user-edited persona (must be preserved); test-lead keeps its own
    // capabilityIds.
    const v7Workspaces: Workspace[] = [
      ...defaultContainerWorkspaces(),
      ...ORGANIZATION_ROLES.map((role) =>
        ws({
          id: role.id,
          name: role.name,
          roleRank: role.roleRank,
          parentWorkspaceId: "bootstrap-test",
          teamId: role.teamId,
          persona:
            role.id === "org-chief-steward"
              ? "用户自己改过的总管家人设"
              : (role.previousPersona ?? role.persona),
          responsibilities: role.previousResponsibilities
            ? [...role.previousResponsibilities]
            : [...role.responsibilities],
          ...(role.id === "org-test-lead" ? { capabilityIds: ["user-cap"] } : {}),
        }),
      ),
    ];
    const before = makeSettings({ workspaces: v7Workspaces, organizationSeedVersion: 7 });

    const { changed, settings } = ensureOrganizationSeed(before, fixedClock);
    expect(changed).toBe(true);
    const byId = new Map(settings.workspaces.map((w) => [w.id, w]));

    // dev-lead still on its v7 default persona → upgraded to v8.
    expect(byId.get("org-dev-lead")!.persona).toContain("任务面板台账负责人");
    // dev-lead had no capabilityIds in the fixture → default set filled.
    expect(byId.get("org-dev-lead")!.capabilityIds).toEqual([
      "task-inbox",
      "doc-generation",
      "file-operations",
    ]);
    // chief's persona was user-edited → preserved untouched.
    expect(byId.get("org-chief-steward")!.persona).toBe("用户自己改过的总管家人设");
    // test-lead's user capabilityIds preserved.
    expect(byId.get("org-test-lead")!.capabilityIds).toEqual(["user-cap"]);
    expect(settings.organizationSeedVersion).toBe(ORGANIZATION_SEED_VERSION);

    // Idempotent.
    const second = ensureOrganizationSeed(settings, fixedClock);
    expect(second.changed).toBe(false);
    expect(second.settings).toBe(settings);
  });
});
