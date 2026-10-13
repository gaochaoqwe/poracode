/**
 * 数字员工系统 · 文件系统驱动（supervisor 运行时）
 *
 * 把「模拟公司电脑文件夹」上的文件系统流转接到真实的员工线程：
 * 1. 扫描「测试项目/<年>/进行中/<类型>[/<子类>]/<项目>」找到进行中的项目；
 * 2. 对每个项目跑 `scanProjectFlow` + `planFlow`（纯函数，见
 *    `src/shared/digitalEmployee/flowEngine.ts`），推导每个 P 节点的状态；
 * 3. 对「前置完成且员工空闲 → start」的节点，收集唤醒请求
 *    （`FlowWakeup`），定向派发到该节点 owner 岗位的员工线程；
 * 4. 员工线程完成节点后把文件夹改名为「[节点-已完成]」，下一轮扫描
 *    自然推进到后续节点（文件系统是唯一流转载体）。
 *
 * 边界（provider-agnostic）：
 * - 不直接 spawn 线程：通过注入的 `spawnEmployee` 委托给 supervisor
 *   主运行时的 startThread 闭包（与 TeamDispatcher 同一接线路径）；
 * - 岗位未绑定 provider（agentKind 为空）或员工正忙时跳过并记录，
 *   绝不崩溃、绝不静默派发错误岗位；
 * - 文件系统访问通过注入的 `listDir`（默认 node:fs），可独立测试。
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Workspace } from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";
import {
  TEST_FLOW_NODES,
  type FlowNode,
  nodeFolderName,
  nodeSkeletonFolderName,
} from "@/shared/digitalEmployee/flowTypes";
import {
  planFlow,
  scanProjectFlow,
  isProjectFlowDone,
  isProjectFlowStarted,
  type EmployeeBusyMap,
  type ListDir,
} from "@/shared/digitalEmployee/flowEngine";
import type {
  FlowDriverSnapshot,
  FlowWakeup,
  ProjectFlowPlan,
} from "@/shared/digitalEmployee/flowSnapshot";

/** 目录不存在时视为空目录（驱动对缺目录静默）。 */
function listDirSafe(listDir: ListDir, dir: string): readonly string[] {
  try {
    return listDir(dir);
  } catch {
    return [];
  }
}

/** 默认目录扫描器：真实文件系统。 */
export function defaultListDir(dir: string): readonly string[] {
  return readdirSync(dir);
}

/**
 * 在模拟公司电脑文件夹下发现「进行中」的测试项目目录。
 * 结构：`测试项目/<年>/进行中/<软件类型>[/<子类>]/<项目名>/`。
 * 项目目录的特征：目录条目中含 P 节点状态文件夹（「[P3-…]」）或
 * 骨架目录（「P3-…」）。递归深度最多 4 层（类型 → 子类 → 项目）。
 */
export function discoverInProgressProjects(fsRoot: string, listDir: ListDir): string[] {
  const found: string[] = [];
  for (const year of listDirSafe(listDir, join(fsRoot, "测试项目"))) {
    walkProjects(join(fsRoot, "测试项目", year, "进行中"), 4);
  }
  return found;

  function walkProjects(dir: string, depth: number): void {
    if (depth < 0) return;
    for (const entry of listDirSafe(listDir, dir)) {
      const child = join(dir, entry);
      if (looksLikeProject(child)) {
        found.push(child);
        continue;
      }
      walkProjects(child, depth - 1);
    }
  }

  function looksLikeProject(dir: string): boolean {
    return listDirSafe(listDir, dir).some((entry) => /^(?:\[P\d+-|P\d+-)/.test(entry));
  }
}

/** 单个项目的一轮流转规划结果。 */
// 类型见 shared `flowSnapshot.ts`（ProjectFlowPlan / FlowWakeup / FlowDriverSnapshot）。

/**

/**
 * 对单个项目目录做扫描 + 规划。
 * `busyMap` 由驱动在 tick 开始时从 settings + 线程状态构建，
 * 使 planFlow 能把「员工正忙」的节点推导为 waiting（原地等待）。
 */
export function planProject(
  projectDir: string,
  listDir: ListDir,
  busyMap: EmployeeBusyMap = {},
): ProjectFlowPlan {
  const scans = scanProjectFlow(TEST_FLOW_NODES, listDir, projectDir);
  const nodes = planFlow(TEST_FLOW_NODES, scans, busyMap, projectDir);
  return {
    projectDir,
    nodes,
    started: isProjectFlowStarted(nodes),
    done: isProjectFlowDone(nodes),
  };
}

/** 汇总所有项目的唤醒请求（只含推导出 start 动作的节点）。 */
export function collectWakeups(plans: readonly ProjectFlowPlan[]): FlowWakeup[] {
  return plans.flatMap((plan) =>
    plan.nodes
      .filter((entry) => entry.action?.kind === "start")
      .map((entry) => ({
        roleId: entry.node.ownerRoleId,
        node: entry.node,
        projectDir: plan.projectDir,
        targetFolderName: entry.action!.targetFolderName,
        reason: entry.action!.reason,
      })),
  );
}

/** 生成派发给节点员工的提示词（含岗位说明与文件系统流转操作规则）。 */
export function buildNodePrompt(opts: {
  workspace: Workspace;
  projectDir: string;
  node: FlowNode;
  targetFolderName: string;
}): string {
  const { workspace, projectDir, node, targetFolderName } = opts;
  const lines: string[] = [
    `你是「${workspace.name}」（${workspace.id}），负责软件测评流水线节点「${node.label}」（${node.id}）。`,
    `项目目录：${projectDir}`,
  ];
  if (workspace.persona) {
    lines.push(`岗位说明：${workspace.persona}`);
  }
  if (workspace.responsibilities && workspace.responsibilities.length > 0) {
    lines.push(`职责：\n- ${workspace.responsibilities.join("\n- ")}`);
  }
  lines.push(
    `本次任务：完成节点「${node.id}-${node.label}」的测评工作，成果写入你的节点文件夹。`,
    `操作规则（文件系统流转，务必遵守）：`,
    `1. 工作目录是项目目录；你只操作自己的节点文件夹（${nodeSkeletonFolderName(node)} 或当前状态文件夹），其他节点的文件夹一律不动；`,
    `2. 开始工作前，把节点文件夹创建/改名为「${targetFolderName}」（[节点-进行中]）；`,
    `3. 完成节点工作后，把文件夹改名为「${nodeFolderName(node, "已完成")}」（[节点-已完成]），并把工作成果（文档/表单/报告等）写入该文件夹，供下一节点员工查阅；`,
    `4. 不要改动项目目录下其他任何文件；你不负责推进后续节点。`,
  );
  return lines.join("\n\n");
}

/** 驱动一轮扫描-派发的结果（类型见 shared `flowSnapshot.ts`）。 */

export interface FlowDriverDeps {
  /** 模拟公司电脑文件夹根目录（默认 SIMULATED_FS_ROOT）。 */
  fsRoot: string;
  /** 读取共享 settings（workspaces / teams）。 */
  readSettings: () => SharedSettings;
  /** 目录扫描器（默认真实 fs；测试可注入内存假实现）。 */
  listDir?: ListDir;
  /** 该岗位员工当前是否正忙（有其他进行中的线程）。 */
  isEmployeeBusy: (roleId: string) => boolean;
  /**
   * 定向派发：为一名节点员工启动线程。
   * 由 supervisor 主运行时的 startThread 闭包实现；未绑定 provider 的岗位
   * 由调用方在闭包内抛错，驱动捕获后记录为 skipped/failed。
   */
  spawnEmployee: (request: {
    workspace: Workspace;
    projectDir: string;
    node: FlowNode;
    targetFolderName: string;
    prompt: string;
  }) => Promise<void>;
  /** 轮询间隔毫秒（默认 30s）。 */
  intervalMs?: number;
  /** 每轮扫描-派发完成后回调（supervisor 用它把快照广播给 main → renderer）。 */
  onSnapshot?: (snapshot: FlowDriverSnapshot) => void;
  log?: (...args: unknown[]) => void;
}

/**
 * 文件系统驱动：周期扫描进行中的测试项目 → planFlow →
 * 对 start 节点定向唤醒员工线程。
 *
 * 生命周期：`start()` 立即跑一轮并进入轮询；`stop()` 停止轮询。
 * 每轮结果缓存在 `lastSnapshot`，供 UI/IPC 查询。
 */
export class FlowDriver {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: FlowDriverSnapshot | null = null;
  private readonly listDir: ListDir;
  private readonly intervalMs: number;
  private readonly log: (...args: unknown[]) => void;

  constructor(private readonly deps: FlowDriverDeps) {
    this.listDir = deps.listDir ?? defaultListDir;
    this.intervalMs = deps.intervalMs ?? 30_000;
    this.log = deps.log ?? (() => {});
  }

  start(): void {
    if (this.timer) return;
    void this.tick().catch((error) => this.log("[flow-driver] tick failed:", error));
    this.timer = setInterval(() => {
      void this.tick().catch((error) => this.log("[flow-driver] tick failed:", error));
    }, this.intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 最近一轮扫描结果（未跑过为 null）。 */
  snapshot(): FlowDriverSnapshot | null {
    return this.lastSnapshot;
  }

  /** 跑一轮：扫描 → 规划 → 派发。 */
  async tick(): Promise<FlowDriverSnapshot> {
    const settings = this.deps.readSettings();
    const busyMap: Record<string, boolean> = {};
    for (const role of settings.workspaces) {
      busyMap[role.id] = this.deps.isEmployeeBusy(role.id);
    }

    const projects = discoverInProgressProjects(this.deps.fsRoot, this.listDir).map((dir) =>
      planProject(dir, this.listDir, busyMap),
    );
    const wakeups = collectWakeups(projects);

    const dispatched: FlowDriverSnapshot["dispatched"] = [];
    for (const wakeup of wakeups) {
      const workspace = settings.workspaces.find((entry) => entry.id === wakeup.roleId);
      if (!workspace) {
        dispatched.push({
          roleId: wakeup.roleId,
          nodeId: wakeup.node.id,
          projectDir: wakeup.projectDir,
          status: "skipped",
          detail: "岗位不存在于组织种子",
        });
        continue;
      }
      if (!workspace.agentKind) {
        dispatched.push({
          roleId: wakeup.roleId,
          nodeId: wakeup.node.id,
          projectDir: wakeup.projectDir,
          status: "skipped",
          detail: "岗位未绑定 provider（agentKind 为空）",
        });
        continue;
      }
      // planFlow 已用 busyMap 推导，这里再查一次是并发防御。
      if (busyMap[wakeup.roleId]) {
        dispatched.push({
          roleId: wakeup.roleId,
          nodeId: wakeup.node.id,
          projectDir: wakeup.projectDir,
          status: "skipped",
          detail: "员工正忙于其他任务",
        });
        continue;
      }
      const prompt = buildNodePrompt({
        workspace,
        projectDir: wakeup.projectDir,
        node: wakeup.node,
        targetFolderName: wakeup.targetFolderName,
      });
      try {
        await this.deps.spawnEmployee({
          workspace,
          projectDir: wakeup.projectDir,
          node: wakeup.node,
          targetFolderName: wakeup.targetFolderName,
          prompt,
        });
        dispatched.push({
          roleId: wakeup.roleId,
          nodeId: wakeup.node.id,
          projectDir: wakeup.projectDir,
          status: "spawned",
        });
      } catch (error) {
        this.log("[flow-driver] spawn failed:", wakeup.roleId, wakeup.node.id, error);
        dispatched.push({
          roleId: wakeup.roleId,
          nodeId: wakeup.node.id,
          projectDir: wakeup.projectDir,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const snapshot: FlowDriverSnapshot = {
      scannedAt: new Date().toISOString(),
      projects,
      wakeups,
      dispatched,
    };
    this.lastSnapshot = snapshot;
    this.deps.onSnapshot?.(snapshot);
    return snapshot;
  }
}
