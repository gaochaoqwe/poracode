import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_ICONS,
  DEFAULT_WORKSPACE_NAMES,
  type Workspace,
} from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import {
  DEFAULT_SCENARIO_IDS_BY_CATEGORY,
  DEFAULT_WORKSPACE_CATEGORIES,
} from "@/renderer/scenarios/catalog";
import { useAppStore } from "./appStore";
import { useSharedSettings } from "./sharedSettingsStore";
import {
  bootstrapWorkspaces,
  getLastWorkspaceProjectId,
  rememberWorkspaceProject,
  resolveActiveWorkspaceId,
  useWorkspaceStore,
} from "./workspaceStore";

function addProject(name: string) {
  return useAppStore.getState().addProject({ kind: "posix", path: `/repos/${name}` }, name);
}

describe("resolveActiveWorkspaceId", () => {
  it("keeps a stored id that still resolves", () => {
    expect(resolveActiveWorkspaceId([{ id: "a" }, { id: "b" }], "b")).toBe("b");
  });

  it("falls back to the first workspace when the stored id is stale", () => {
    // A workspace deleted on another device must not blank the sidebar.
    expect(resolveActiveWorkspaceId([{ id: "a" }, { id: "b" }], "gone")).toBe("a");
  });

  it("prefers the default workspace when nothing is stored", () => {
    expect(resolveActiveWorkspaceId([{ id: "a" }, { id: "b" }], null, "b")).toBe("b");
  });

  it("ignores a dangling default and falls back to the first workspace", () => {
    expect(resolveActiveWorkspaceId([{ id: "a" }, { id: "b" }], null, "gone")).toBe("a");
  });

  it("returns null when there are no workspaces at all", () => {
    expect(resolveActiveWorkspaceId([], "a")).toBeNull();
  });
});

describe("last project per workspace", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({
      workspaces: [
        { id: "w1", name: "Work", createdAt: "2026-07-29T00:00:00.000Z", icon: "briefcase" },
        { id: "w2", name: "Side", createdAt: "2026-07-29T00:00:00.000Z", icon: "rocket" },
      ],
    });
    useWorkspaceStore.setState({ activeWorkspaceId: "w1", lastProjectIdByWorkspace: {} });
  });

  it("keeps a pick per workspace", () => {
    rememberWorkspaceProject("p1");
    useWorkspaceStore.setState({ activeWorkspaceId: "w2" });
    rememberWorkspaceProject("p2");

    expect(getLastWorkspaceProjectId()).toBe("p2");
    useWorkspaceStore.setState({ activeWorkspaceId: "w1" });
    expect(getLastWorkspaceProjectId()).toBe("p1");
  });

  it("reads nothing for a workspace with no pick yet", () => {
    expect(getLastWorkspaceProjectId()).toBeUndefined();
  });

  it("rehydrates a payload written before the field existed", async () => {
    // Regression for the released v1 shape: `lastProjectIdByWorkspace` is
    // additive, so the stored active workspace must survive rather than reset.
    localStorage.setItem(
      "agentemployee-active-workspace",
      JSON.stringify({ state: { activeWorkspaceId: "w2" }, version: 1 }),
    );

    await useWorkspaceStore.persist.rehydrate();

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("w2");
    expect(useWorkspaceStore.getState().lastProjectIdByWorkspace).toEqual({});
    expect(typeof useWorkspaceStore.getState().rememberProjectForWorkspace).toBe("function");
  });
});

describe("bootstrapWorkspaces", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({ workspaces: [], defaultWorkspaceId: null });
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    useAppStore.setState((state) => ({ ...state, projects: [], threads: [] }));
  });

  it("seeds the default workspaces in a single settings write", async () => {
    const writes: number[] = [];
    const unsubscribe = useSharedSettings.subscribe((state) =>
      writes.push(state.workspaces.length),
    );

    await bootstrapWorkspaces();
    unsubscribe();

    // One write, not one per default name — each would serialize all settings.
    expect(writes).toEqual([DEFAULT_WORKSPACE_NAMES.length]);

    const names = useSharedSettings.getState().workspaces.map((w) => w.name);
    expect(names).toEqual([...DEFAULT_WORKSPACE_NAMES]);
    expect(useSharedSettings.getState().workspaces.map((w) => w.icon)).toEqual([
      ...DEFAULT_WORKSPACE_ICONS,
    ]);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(
      useSharedSettings.getState().workspaces[0]!.id,
    );
  });

  it("seeds a domain and default scenarios on the matching workspaces", async () => {
    await bootstrapWorkspaces();

    const workspaces = useSharedSettings.getState().workspaces;
    expect(workspaces.map((w) => w.category)).toEqual([...DEFAULT_WORKSPACE_CATEGORIES]);

    const docs = workspaces.find((w) => w.category === "docs");
    expect(docs?.defaultScenarioIds).toEqual([...DEFAULT_SCENARIO_IDS_BY_CATEGORY.docs]);

    // Every category carries scenarios today, so every default workspace seeds
    // its own list — the general one included.
    const general = workspaces.find((w) => w.category === "general");
    expect(general?.defaultScenarioIds).toEqual([...DEFAULT_SCENARIO_IDS_BY_CATEGORY.general]);
  });

  it("backfills domain and default scenarios for an untouched pre-feature seed", async () => {
    // An install seeded before workspaces carried a domain / scenario list:
    // the names and order match the defaults, but both fields are missing.
    useSharedSettings.setState({
      workspaces: DEFAULT_WORKSPACE_NAMES.map((name, index) => ({
        id: `w${index}`,
        name,
        createdAt: "2026-01-01T00:00:00.000Z",
        icon: DEFAULT_WORKSPACE_ICONS[index]!,
      })),
    });

    await bootstrapWorkspaces();

    const workspaces = useSharedSettings.getState().workspaces;
    expect(workspaces.map((w) => w.category)).toEqual([...DEFAULT_WORKSPACE_CATEGORIES]);
    expect(
      workspaces.find((w) => w.name === DEFAULT_WORKSPACE_NAMES[1])?.defaultScenarioIds,
    ).toEqual([...DEFAULT_SCENARIO_IDS_BY_CATEGORY.docs]);
    expect(workspaces.find((w) => w.category === "general")?.defaultScenarioIds).toEqual([
      ...DEFAULT_SCENARIO_IDS_BY_CATEGORY.general,
    ]);
  });

  it("does not re-scope a default-named workspace the user already customized", async () => {
    const workspaces: Workspace[] = DEFAULT_WORKSPACE_NAMES.map((name, index) => ({
      id: `w${index}`,
      name,
      createdAt: "2026-01-01T00:00:00.000Z",
      icon: DEFAULT_WORKSPACE_ICONS[index]!,
    }));
    workspaces[1] = { ...workspaces[1]!, category: "code", defaultScenarioIds: ["fix-bug"] };
    useSharedSettings.setState({ workspaces });

    await bootstrapWorkspaces();

    const docs = useSharedSettings.getState().workspaces[1]!;
    expect(docs.category).toBe("code");
    expect(docs.defaultScenarioIds).toEqual(["fix-bug"]);
  });

  it("appends a newly-added default scenario id to an unmodified default-category workspace", async () => {
    // A test workspace seeded before 代码审查（回归） existed: category unchanged
    // (still the default "test"), scenario list missing the regression id.
    const workspaces: Workspace[] = DEFAULT_WORKSPACE_NAMES.map((name, index) => ({
      id: `w${index}`,
      name,
      createdAt: "2026-01-01T00:00:00.000Z",
      icon: DEFAULT_WORKSPACE_ICONS[index]!,
      ...(DEFAULT_WORKSPACE_CATEGORIES[index] === "test"
        ? { category: "test", defaultScenarioIds: ["review-document", "static-analysis", "code-review"] }
        : {}),
    }));
    useSharedSettings.setState({ workspaces });

    await bootstrapWorkspaces();

    const testWs = useSharedSettings.getState().workspaces.find((w) => w.category === "test")!;
    expect(testWs.defaultScenarioIds).toContain("code-review-regression");
    expect(testWs.defaultScenarioIds).toEqual([
      ...DEFAULT_SCENARIO_IDS_BY_CATEGORY.test,
    ]);
  });

  it("renames an untouched pre-rename default set to the role names in place", async () => {
    // An install seeded before the "岗位" rename: names are 通用任务 / 文档编写 / …,
    // but ids and icons are the ones the user's install already had.
    const before = useSharedSettings.getState().workspaces;
    const preRename = DEFAULT_WORKSPACE_NAMES.map((_, index) => {
      const oldName = ["通用任务", "文档编写", "软件编码", "软件测试"][index]!;
      return {
        id: `w${index}`,
        name: oldName,
        createdAt: "2026-01-01T00:00:00.000Z",
        icon: DEFAULT_WORKSPACE_ICONS[index]!,
      } satisfies Workspace;
    });
    useSharedSettings.setState({ workspaces: preRename });

    await bootstrapWorkspaces();

    const after = useSharedSettings.getState().workspaces;
    // Names now carry the "岗" suffix; ids/icons/projects are preserved.
    expect(after.map((w) => w.name)).toEqual([...DEFAULT_WORKSPACE_NAMES]);
    expect(after.map((w) => w.id)).toEqual(preRename.map((w) => w.id));
    expect(after.map((w) => w.icon)).toEqual(preRename.map((w) => w.icon));
    expect(after).not.toBe(before);
  });

  it("refreshes a seeded persona that still embeds the old role name", async () => {
    const preRename = DEFAULT_WORKSPACE_NAMES.map((_, index) => {
      const oldName = ["通用任务", "文档编写", "软件编码", "软件测试"][index]!;
      return {
        id: `w${index}`,
        name: oldName,
        createdAt: "2026-01-01T00:00:00.000Z",
        icon: DEFAULT_WORKSPACE_ICONS[index]!,
        persona: `我是「${oldName}」岗位员工。`,
      } satisfies Workspace;
    });
    useSharedSettings.setState({ workspaces: preRename });

    await bootstrapWorkspaces();

    const docs = useSharedSettings.getState().workspaces[1]!;
    expect(docs.persona).toContain("「文档编写岗」");
  });

  it("leaves the whole set untouched when any workspace was customized", async () => {
    const preRename: Workspace[] = DEFAULT_WORKSPACE_NAMES.map((_, index) => {
      const oldName = ["通用任务", "文档编写", "软件编码", "软件测试"][index]!;
      return {
        id: `w${index}`,
        name: oldName,
        createdAt: "2026-01-01T00:00:00.000Z",
        icon: DEFAULT_WORKSPACE_ICONS[index]!,
      };
    });
    preRename[0] = { ...preRename[0]!, name: "我的项目", persona: "自定义人设" };
    useSharedSettings.setState({ workspaces: preRename });

    await bootstrapWorkspaces();

    const workspaces = useSharedSettings.getState().workspaces;
    // A customized list is never migrated as a whole: the custom name is kept
    // and the untouched siblings stay on their pre-rename names.
    expect(workspaces[0]!.name).toBe("我的项目");
    expect(workspaces[0]!.persona).toBe("自定义人设");
    expect(workspaces[1]!.name).toBe("文档编写");
  });

  it("seeds an employee persona and capability tags on the default workspaces", async () => {
    await bootstrapWorkspaces();

    const workspaces = useSharedSettings.getState().workspaces;
    // Every default workspace carries a non-empty persona + capability tags.
    for (const workspace of workspaces) {
      expect(workspace.persona?.length).toBeGreaterThan(0);
      expect(workspace.capabilityTags?.length).toBeGreaterThan(0);
    }
    // The docs (文档编写) workspace's tags reflect its job.
    const docs = workspaces.find((w) => w.category === "docs");
    expect(docs?.capabilityTags).toContain("需求文档");
  });

  it("backfills an employee persona onto an untouched pre-persona seed", async () => {
    useSharedSettings.setState({
      workspaces: DEFAULT_WORKSPACE_NAMES.map((name, index) => ({
        id: `w${index}`,
        name,
        createdAt: "2026-01-01T00:00:00.000Z",
        icon: DEFAULT_WORKSPACE_ICONS[index]!,
      })),
    });

    await bootstrapWorkspaces();

    const workspaces = useSharedSettings.getState().workspaces;
    for (const workspace of workspaces) {
      expect(workspace.persona?.length).toBeGreaterThan(0);
      expect(workspace.capabilityTags?.length).toBeGreaterThan(0);
    }
  });

  it("does not overwrite a persona the user already customized on a default workspace", async () => {
    const workspaces: Workspace[] = DEFAULT_WORKSPACE_NAMES.map((name, index) => ({
      id: `w${index}`,
      name,
      createdAt: "2026-01-01T00:00:00.000Z",
      icon: DEFAULT_WORKSPACE_ICONS[index]!,
    }));
    workspaces[1] = { ...workspaces[1]!, persona: "我的自定义人设" };
    useSharedSettings.setState({ workspaces });

    await bootstrapWorkspaces();

    const docs = useSharedSettings.getState().workspaces[1]!;
    expect(docs.persona).toBe("我的自定义人设");
  });

  it("files pre-existing projects into the first workspace", async () => {
    const alpha = addProject("alpha");
    const beta = addProject("beta");

    await bootstrapWorkspaces();

    const workId = useSharedSettings.getState().workspaces[0]!.id;
    const projects = useAppStore.getState().projects;
    expect(projects.find((p) => p.id === alpha.id)?.workspaceId).toBe(workId);
    expect(projects.find((p) => p.id === beta.id)?.workspaceId).toBe(workId);
  });

  it("leaves the synthetic Home project unfiled", async () => {
    useAppStore.getState().ensureHomeProject({ kind: "posix", path: "/Users/me" });

    await bootstrapWorkspaces();

    const home = useAppStore.getState().projects.find((p) => p.id === HOME_PROJECT_ID);
    expect(home?.workspaceId).toBeUndefined();
  });

  it("is idempotent once workspaces exist", async () => {
    await bootstrapWorkspaces();
    const before = useSharedSettings.getState().workspaces;

    await bootstrapWorkspaces();

    expect(useSharedSettings.getState().workspaces).toEqual(before);
  });

  it("repairs a stale active id instead of reseeding", async () => {
    await bootstrapWorkspaces();
    const [work, side] = useSharedSettings.getState().workspaces;
    useWorkspaceStore.setState({ activeWorkspaceId: "gone" });

    await bootstrapWorkspaces();

    expect(useSharedSettings.getState().workspaces).toHaveLength(DEFAULT_WORKSPACE_NAMES.length);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(work!.id);
    expect(side).toBeDefined();
  });

  it("falls back to the configured default when the stored id is stale", async () => {
    await bootstrapWorkspaces();
    const workspaces = useSharedSettings.getState().workspaces;
    const target = workspaces[2]!;
    useSharedSettings.setState({ defaultWorkspaceId: target.id });
    useWorkspaceStore.setState({ activeWorkspaceId: "gone" });

    await bootstrapWorkspaces();

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(target.id);
  });

  it("migrates an untouched legacy default set to the current defaults", async () => {
    // The exact pre-rename seed: two workspaces still named Work / Side Hustle.
    useSharedSettings.setState({
      workspaces: [
        { id: "old-work", name: "Work", createdAt: "2026-01-01T00:00:00.000Z", icon: "briefcase" },
        {
          id: "old-side",
          name: "Side Hustle",
          createdAt: "2026-01-01T00:00:00.000Z",
          icon: "rocket",
        },
      ],
    });
    useWorkspaceStore.setState({
      activeWorkspaceId: "old-side",
      lastProjectIdByWorkspace: { "old-work": "p-work" },
    });
    const alpha = addProject("alpha");
    const beta = addProject("beta");
    useAppStore.getState().setProjectWorkspace(alpha.id, "old-work");
    useAppStore.getState().setProjectWorkspace(beta.id, "old-side");

    await bootstrapWorkspaces();

    const workspaces = useSharedSettings.getState().workspaces;
    expect(workspaces.map((w) => w.name)).toEqual([...DEFAULT_WORKSPACE_NAMES]);
    expect(workspaces.map((w) => w.icon)).toEqual([...DEFAULT_WORKSPACE_ICONS]);

    // Projects follow the old workspace at the same index; the pick memory and
    // active workspace remap to the matching replacement too.
    const byId = new Map(useAppStore.getState().projects.map((p) => [p.id, p]));
    expect(byId.get(alpha.id)?.workspaceId).toBe(workspaces[0]!.id);
    expect(byId.get(beta.id)?.workspaceId).toBe(workspaces[1]!.id);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(workspaces[1]!.id);
    expect(useWorkspaceStore.getState().lastProjectIdByWorkspace).toEqual({
      [workspaces[0]!.id]: "p-work",
    });
  });

  it("leaves a customized workspace list alone", async () => {
    const custom = [
      { id: "a", name: "工作", createdAt: "2026-01-01T00:00:00.000Z", icon: "briefcase" as const },
      {
        id: "b",
        name: "Side Hustle",
        createdAt: "2026-01-01T00:00:00.000Z",
        icon: "rocket" as const,
      },
    ];
    useSharedSettings.setState({ workspaces: custom });

    await bootstrapWorkspaces();

    expect(useSharedSettings.getState().workspaces).toEqual(custom);
  });
});
