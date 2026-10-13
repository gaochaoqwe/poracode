import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import type { Workspace } from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";
import {
  buildNodePrompt,
  collectWakeups,
  discoverInProgressProjects,
  planProject,
  type FlowDriverDeps,
  FlowDriver,
} from "./flowDriver";
import { TEST_FLOW_NODE_BY_ID } from "@/shared/digitalEmployee/flowTypes";
import type { ListDir } from "@/shared/digitalEmployee/flowEngine";

/** 内存文件系统：dir → entries。 */
type FakeFs = Map<string, Set<string>>;

function addEntry(fs: FakeFs, dir: string, name: string): void {
  // 自动创建整条父目录链（与 join 的 Windows 分隔符保持一致），
  // 并让每一级父目录登记其子目录条目，模拟真实文件系统。
  const segments = dir.split(/[\\/]+/).filter(Boolean);
  let current = segments[0]!;
  if (!fs.has(current)) fs.set(current, new Set());
  for (let i = 1; i < segments.length; i++) {
    const child = `${current}\\${segments[i]}`;
    if (!fs.has(child)) fs.set(child, new Set());
    fs.get(current)!.add(segments[i]!);
    current = child;
  }
  if (!fs.has(dir)) fs.set(dir, new Set());
  fs.get(dir)!.add(name);
}

function fakeListDir(fs: FakeFs): ListDir {
  return (dir: string) => {
    const entries = fs.get(dir);
    if (!entries) throw new Error(`ENOENT: ${dir}`);
    return [...entries];
  };
}

const FS_ROOT = "E:\\fs";
const PROJECT = join(FS_ROOT, "测试项目", "2026", "进行中", "一类", "1光雷", "示例项目");

/** 在内存 fs 中搭一个标准的「进行中」测试项目（P0 已完成，其余未开始）。 */
function seedProjectWithP0Done(fs: FakeFs): void {
  addEntry(fs, PROJECT, "[P0-测试申请文件-已完成]");
  addEntry(fs, PROJECT, "P1-准入审查");
  addEntry(fs, PROJECT, "P2-测试策划");
  addEntry(fs, PROJECT, "P3-文档审查");
}

function settingsWithWorkspaces(workspaces: Workspace[]): SharedSettings {
  return { workspaces, teams: [], chiefStewardWorkspaceId: undefined } as unknown as SharedSettings;
}

function workspace(id: string, agentKind?: string): Workspace {
  return {
    id,
    name: id,
    ...(agentKind ? { agentKind } : {}),
    permissions: { workspacePaths: [FS_ROOT], requireApproval: true, allowComputerUse: false },
  } as Workspace;
}

describe("discoverInProgressProjects", () => {
  it("fsRoot 不存在（或测试项目目录不存在）时返回空数组", () => {
    const fs: FakeFs = new Map();
    expect(discoverInProgressProjects(FS_ROOT, fakeListDir(fs))).toEqual([]);
  });

  it("只发现「进行中」的项目，排除已完成/未开展", () => {
    const fs: FakeFs = new Map();
    // 进行中项目（含子类两层）
    seedProjectWithP0Done(fs);
    // 直接位于软件类型下的进行中项目（无子类）
    const flatProject = join(FS_ROOT, "测试项目", "2026", "进行中", "九外部测试", "外测项目");
    addEntry(fs, flatProject, "[P0-测试申请文件-进行中]");
    // 已完成项目（不应出现）
    const doneProject = join(FS_ROOT, "测试项目", "2026", "已完成", "一类", "1光雷", "旧项目");
    addEntry(fs, doneProject, "[P14-最终报告-已完成]");
    // 未开展项目（不应出现）
    const todoProject = join(FS_ROOT, "测试项目", "2026", "未开展", "二类", "2吊舱", "新项目");
    addEntry(fs, todoProject, "P0-测试申请文件");
    // 开发项目（不应出现）
    addEntry(fs, join(FS_ROOT, "开发项目", "2026", "AI软件测评-web版"), "README.md");

    const found = discoverInProgressProjects(FS_ROOT, fakeListDir(fs));
    expect(found).toContain(PROJECT);
    expect(found).toContain(flatProject);
    expect(found).not.toContain(doneProject);
    expect(found).not.toContain(todoProject);
    expect(found).toHaveLength(2);
  });
});

describe("planProject", () => {
  it("项目从未开始：只有 P0 推导为 start（首个节点），其余全 not-started 无动作", () => {
    const fs: FakeFs = new Map();
    addEntry(fs, PROJECT, "P0-测试申请文件"); // 只有骨架目录 = 未开始
    const plan = planProject(PROJECT, fakeListDir(fs));
    expect(plan.started).toBe(false);
    expect(plan.done).toBe(false);
    expect(plan.nodes.every((entry) => entry.state === "not-started")).toBe(true);
    // P0 前置为空 → 首个节点永远可启动（测试主管开始准备测试申请文件）。
    const p0 = plan.nodes.find((entry) => entry.node.id === "P0")!;
    expect(p0.action?.kind).toBe("start");
    expect(p0.action?.targetFolderName).toBe("[P0-测试申请文件-进行中]");
    expect(plan.nodes.filter((entry) => entry.node.id !== "P0").every((entry) => entry.action === null)).toBe(true);
  });

  it("P0 完成后：P1 推导为 start（前置完成 + 员工空闲）", () => {
    const fs: FakeFs = new Map();
    addEntry(fs, PROJECT, "[P0-测试申请文件-已完成]");
    const plan = planProject(PROJECT, fakeListDir(fs));
    const p0 = plan.nodes.find((entry) => entry.node.id === "P0")!;
    const p1 = plan.nodes.find((entry) => entry.node.id === "P1")!;
    expect(p0.state).toBe("done");
    expect(p1.state).toBe("not-started");
    expect(p1.action?.kind).toBe("start");
    expect(p1.action?.targetFolderName).toBe("[P1-准入审查-进行中]");
    // P2 及其后仍被 P1 挡住
    expect(plan.nodes.find((entry) => entry.node.id === "P2")!.state).toBe("not-started");
    expect(plan.nodes.find((entry) => entry.node.id === "P2")!.action).toBeNull();
    expect(plan.started).toBe(true);
    expect(plan.done).toBe(false);
  });

  it("P0 已完成但项目主管正忙：P1 推导为 waiting（原地等待）", () => {
    const fs: FakeFs = new Map();
    addEntry(fs, PROJECT, "[P0-测试申请文件-已完成]");
    const plan = planProject(PROJECT, fakeListDir(fs), { "org-test-project-lead": true });
    const p1 = plan.nodes.find((entry) => entry.node.id === "P1")!;
    expect(p1.state).toBe("waiting");
    expect(p1.action?.kind).toBe("wait");
    expect(p1.action).toMatchObject({ nodeId: "P1" });
  });

  it("进行中节点保持 in-progress，不产生动作", () => {
    const fs: FakeFs = new Map();
    addEntry(fs, PROJECT, "[P0-测试申请文件-已完成]");
    addEntry(fs, PROJECT, "[P1-准入审查-进行中]");
    const plan = planProject(PROJECT, fakeListDir(fs));
    expect(plan.nodes.find((entry) => entry.node.id === "P1")!.state).toBe("in-progress");
    expect(plan.nodes.find((entry) => entry.node.id === "P1")!.action).toBeNull();
    // P2 前置 P1 尚未完成 → 不产生动作。
    const p2 = plan.nodes.find((entry) => entry.node.id === "P2")!;
    expect(p2.state).toBe("not-started");
    expect(p2.action).toBeNull();
  });

  it("全部节点完成后 done=true", () => {
    const fs: FakeFs = new Map();
    for (const node of [
      "P0",
      "P1",
      "P2",
      "P3",
      "P4",
      "P5",
      "P6",
      "P7",
      "P8",
      "P9",
      "P10",
      "P11",
      "P12",
      "P13",
      "P14",
    ]) {
      const def = TEST_FLOW_NODE_BY_ID.get(node)!;
      addEntry(fs, PROJECT, `[${node}-${def.label}-已完成]`);
    }
    const plan = planProject(PROJECT, fakeListDir(fs));
    expect(plan.done).toBe(true);
    expect(plan.started).toBe(true);
  });
});

describe("collectWakeups", () => {
  it("只收集 start 动作的节点，并带上岗位/文件夹名", () => {
    const fs: FakeFs = new Map();
    seedProjectWithP0Done(fs);
    const plan = planProject(PROJECT, fakeListDir(fs));
    const wakeups = collectWakeups([plan]);
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]).toMatchObject({
      roleId: "org-test-project-lead",
      projectDir: PROJECT,
      targetFolderName: "[P1-准入审查-进行中]",
    });
    expect(wakeups[0]!.node.id).toBe("P1");
  });
});

describe("buildNodePrompt", () => {
  it("提示词包含岗位说明、节点任务与文件流转规则", () => {
    const prompt = buildNodePrompt({
      workspace: workspace("org-test-designer-1"),
      projectDir: PROJECT,
      node: TEST_FLOW_NODE_BY_ID.get("P3")!,
      targetFolderName: "[P3-文档审查-进行中]",
    });
    expect(prompt).toContain("文档审查");
    expect(prompt).toContain(PROJECT);
    expect(prompt).toContain("[P3-文档审查-进行中]");
    expect(prompt).toContain("[P3-文档审查-已完成]");
    expect(prompt).toContain("只操作自己的节点文件夹");
    expect(prompt).toContain("org-test-designer-1");
  });
});

describe("FlowDriver", () => {
  const lead = workspace("org-test-project-lead", "gds");
  const testLead = workspace("org-test-lead", "gds");
  const unbound = workspace("org-test-designer-1");

  function makeDriver(
    fs: FakeFs,
    overrides: Partial<FlowDriverDeps> = {},
    workspaces: Workspace[] = [lead, testLead, unbound],
  ): { driver: FlowDriver; spawns: Array<{ workspaceId: string; prompt: string }> } {
    const spawns: Array<{ workspaceId: string; prompt: string }> = [];
    const driver = new FlowDriver({
      fsRoot: FS_ROOT,
      readSettings: () => settingsWithWorkspaces(workspaces),
      listDir: fakeListDir(fs),
      isEmployeeBusy: () => false,
      spawnEmployee: async ({ workspace: ws, prompt }) => {
        spawns.push({ workspaceId: ws.id, prompt });
      },
      ...overrides,
    });
    return { driver, spawns };
  }

  it("没有进行中项目时不派发任何线程", async () => {
    const { driver } = makeDriver(new Map());
    const snapshot = await driver.tick();
    expect(snapshot.projects).toEqual([]);
    expect(snapshot.wakeups).toEqual([]);
    expect(snapshot.dispatched).toEqual([]);
  });

  it("P0 完成后定向唤醒项目主管，派发线程并记录 spawned", async () => {
    const fs: FakeFs = new Map();
    addEntry(fs, PROJECT, "[P0-测试申请文件-已完成]");
    const { driver, spawns } = makeDriver(fs);
    const snapshot = await driver.tick();

    expect(snapshot.wakeups).toHaveLength(1);
    expect(snapshot.wakeups[0]!.roleId).toBe("org-test-project-lead");
    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.workspaceId).toBe("org-test-project-lead");
    expect(spawns[0]!.prompt).toContain("准入审查");
    expect(snapshot.dispatched[0]).toMatchObject({
      roleId: "org-test-project-lead",
      nodeId: "P1",
      status: "spawned",
    });
    // 快照缓存到 lastSnapshot
    expect(driver.snapshot()?.dispatched).toHaveLength(1);
  });

  it("未绑定 provider 的岗位被跳过（不 spawn）", async () => {
    const fs: FakeFs = new Map();
    addEntry(fs, PROJECT, "[P0-测试申请文件-已完成]");
    addEntry(fs, PROJECT, "[P1-准入审查-已完成]");
    addEntry(fs, PROJECT, "[P2-测试策划-已完成]");
    const { driver, spawns } = makeDriver(fs);
    const snapshot = await driver.tick();

    // P2 完成后，P3~P6 同时可启动，owner 分别是未绑定的 designer-1..4。
    const wakeupRoles = snapshot.wakeups.map((w) => w.roleId);
    expect(wakeupRoles).toContain("org-test-designer-1");
    expect(wakeupRoles).toContain("org-test-designer-4");
    expect(spawns).toHaveLength(0); // 全部未绑定 → 无任何线程
    const skipped = snapshot.dispatched.find((d) => d.roleId === "org-test-designer-1")!;
    expect(skipped.status).toBe("skipped");
    expect(skipped.detail).toContain("未绑定");
  });

  it("员工正忙的节点不产生唤醒（planFlow 推导为 waiting）", async () => {
    const fs: FakeFs = new Map();
    addEntry(fs, PROJECT, "[P0-测试申请文件-已完成]");
    const { driver, spawns } = makeDriver(fs, { isEmployeeBusy: (id) => id === "org-test-project-lead" });
    const snapshot = await driver.tick();

    expect(snapshot.wakeups).toHaveLength(0);
    expect(spawns).toHaveLength(0);
    expect(snapshot.projects[0]!.nodes.find((n) => n.node.id === "P1")!.state).toBe("waiting");
  });

  it("spawn 抛错时记录 failed，不影响其他派发", async () => {
    const fs: FakeFs = new Map();
    addEntry(fs, PROJECT, "[P0-测试申请文件-已完成]");
    addEntry(fs, PROJECT, "[P1-准入审查-已完成]");
    addEntry(fs, PROJECT, "[P2-测试策划-已完成]");
    // P2 完成后 P3~P6 同时可启动；给 designer-1..4 全部绑定 provider，
    // 并让 designer-1 的 spawn 抛错。
    const bound = [1, 2, 3, 4].map((n) => workspace(`org-test-designer-${n}`, "gds"));
    const { driver, spawns } = makeDriver(fs, {
      spawnEmployee: async ({ workspace: ws }) => {
        if (ws.id === "org-test-designer-1") throw new Error("boom");
        spawns.push({ workspaceId: ws.id, prompt: "x" });
      },
    }, [lead, testLead, ...bound]);
    const snapshot = await driver.tick();

    expect(snapshot.wakeups.length).toBeGreaterThanOrEqual(4);
    const failed = snapshot.dispatched.find((d) => d.roleId === "org-test-designer-1")!;
    expect(failed.status).toBe("failed");
    expect(failed.detail).toBe("boom");
    const spawned = snapshot.dispatched.filter((d) => d.status === "spawned");
    expect(spawned.length).toBeGreaterThan(0); // designer-2/3/4 不受影响
    expect(spawns.length).toBe(3);
  });

  it("start/stop 管理轮询（stop 后不再 tick）", async () => {
    const fs: FakeFs = new Map();
    seedProjectWithP0Done(fs);
    const spy = vi.spyOn(FlowDriver.prototype, "tick");
    const { driver } = makeDriver(fs, { intervalMs: 5 });
    driver.start();
    driver.stop();
    driver.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    driver.stop();
    expect(spy).toHaveBeenCalled();
  });
});
