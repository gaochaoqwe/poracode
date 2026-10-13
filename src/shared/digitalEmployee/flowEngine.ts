/**
 * 数字员工系统 · 文件系统流转算法 —— 流转引擎
 *
 * 纯函数核心：输入「项目目录当前条目」+「员工忙碌状态」，
 * 输出每个节点的推导状态与建议动作（start / wait）。
 *
 * 规则（与 `docs/数字员工系统-设计说明.md` 一致）：
 * 1. 节点未开始前员工收不到任何文件 —— 目录不存在或仅存骨架目录；
 * 2. 文件已流转到该员工（前置节点已完成）但员工正忙 —— 保持
 *    上一节点完成状态原地等待（state = waiting，不创建「进行中」）；
 * 3. 前置节点全部完成且员工空闲 —— 建议 start（把骨架目录/不存在
 *    的目录创建为「[节点-进行中]」）；
 * 4. 员工根据文件夹当前状态判断开始/结束（完成由员工标记，
 *    本引擎不自动「完成」）。
 *
 * 文件系统读写不在此层：扫描通过注入的 `listDir`，动作只产出建议，
 * 由运行时（supervisor/main）执行。
 */

import {
  type FlowNode,
  nodeFolderName,
  parseNodeFolderName,
  type NodeFolderState,
  type NodeState,
  TEST_FLOW_NODE_BY_ID,
} from "./flowTypes";

/** 一个节点的目录扫描结果。 */
export interface NodeScan {
  node: FlowNode;
  /** 目录中匹配到该节点的条目名（状态文件夹或骨架目录），未找到为 null。 */
  folderEntry: string | null;
  /** 目录当前状态：已完成 / 进行中 / null（未开始，目录不存在或为骨架）。 */
  folderState: NodeFolderState | null;
}

/** 员工忙碌状态：roleId → 是否正忙于其他项目。缺省视为空闲。 */
export type EmployeeBusyMap = Readonly<Record<string, boolean>>;

/** 引擎建议的流转动作。 */
export type FlowActionKind = "start" | "wait";

export interface FlowAction {
  kind: FlowActionKind;
  nodeId: string;
  /** start：应创建的文件夹名（「[节点-进行中]」）；wait：无实际文件操作。 */
  targetFolderName: string;
  /** 人类可读的理由，便于调试与 UI 展示。 */
  reason: string;
}

/** 规划后的单个节点结果。 */
export interface PlannedNode {
  node: FlowNode;
  /** 推导状态：done / in-progress / waiting / not-started。 */
  state: NodeState;
  /** 匹配到的目录条目名（可能为骨架目录名）。 */
  folderEntry: string | null;
  /** 该节点本次规划的动作（没有需要做的动作为 null）。 */
  action: FlowAction | null;
}

/** 扫描项目目录的函数签名（注入，便于测试与运行时替换）。 */
export type ListDir = (projectDir: string) => readonly string[];

/**
 * 扫描项目目录：把目录条目名逐条匹配到节点状态文件夹，
 * 产出每个节点的目录扫描结果。
 */
export function scanProjectFlow(
  nodes: readonly FlowNode[],
  listDir: ListDir,
  projectDir: string,
): NodeScan[] {
  const entries = listDir(projectDir);
  return nodes.map((node) => {
    let matched: { entry: string; folderState: NodeFolderState | null } | null = null;
    for (const entry of entries) {
      const parsed = parseNodeFolderName(entry);
      if (parsed && parsed.nodeId === node.id) {
        matched = { entry, folderState: parsed.folderState };
        break;
      }
      // 骨架目录（如「P3-文档审查」）视为未开始
      if (entry === `${node.id}-${node.label}`) {
        matched = { entry, folderState: null };
        break;
      }
    }
    return {
      node,
      folderEntry: matched?.entry ?? null,
      folderState: matched?.folderState ?? null,
    };
  });
}

/** 判断一个节点是否已完成（目录状态为「已完成」）。 */
export function isNodeDone(scan: NodeScan): boolean {
  return scan.folderState === "已完成";
}

/**
 * 规划流转动作。
 *
 * 规则：
 * - done / in-progress：无动作；
 * - 前置节点未全部完成：not-started，无动作（未收到文件，等待前置）；
 * - 前置全部完成且执行员工空闲：not-started + start 动作
 *   （创建「[节点-进行中]」，文件流转到该员工）；
 * - 前置全部完成但执行员工正忙：waiting + wait 动作
 *   （文件保持上一节点完成状态原地等待）。
 */
export function planFlow(
  nodes: readonly FlowNode[],
  scans: readonly NodeScan[],
  busyMap: EmployeeBusyMap = {},
  /** 预留：项目目录路径，供运行时执行动作时定位文件夹（本纯函数不使用）。 */
  _projectDir = "",
): PlannedNode[] {
  const scanById = new Map(scans.map((scan) => [scan.node.id, scan]));

  return nodes.map((node) => {
    const scan = scanById.get(node.id);
    if (!scan) {
      return {
        node,
        state: "not-started" as const,
        folderEntry: null,
        action: null,
      };
    }

    // 已完成 / 进行中：不产生动作
    if (scan.folderState === "已完成") {
      return {
        node,
        state: "done" as const,
        folderEntry: scan.folderEntry,
        action: null,
      };
    }
    if (scan.folderState === "进行中") {
      return {
        node,
        state: "in-progress" as const,
        folderEntry: scan.folderEntry,
        action: null,
      };
    }

    // 未开始：检查前置
    const prerequisitesDone = node.dependsOn.every((depId) => {
      const depScan = scanById.get(depId);
      return depScan ? isNodeDone(depScan) : false;
    });
    if (!prerequisitesDone) {
      return {
        node,
        state: "not-started" as const,
        folderEntry: scan.folderEntry,
        action: null,
      };
    }

    // 前置全部完成：文件已流转到该员工
    const ownerBusy = busyMap[node.ownerRoleId] === true;
    const target = nodeFolderName(node, "进行中");
    if (ownerBusy) {
      return {
        node,
        state: "waiting" as const,
        folderEntry: scan.folderEntry,
        action: {
          kind: "wait" as const,
          nodeId: node.id,
          targetFolderName: target,
          reason: `前置节点已完成，但员工 ${node.ownerRoleId} 正忙于其他项目，文件原地等待`,
        },
      };
    }
    return {
      node,
      state: "not-started" as const,
      folderEntry: scan.folderEntry,
      action: {
        kind: "start" as const,
        nodeId: node.id,
        targetFolderName: target,
        reason: `前置节点全部完成且员工 ${node.ownerRoleId} 空闲，创建「${target}」开始节点`,
      },
    };
  });
}

/** 项目是否全部完成（所有节点 done）。 */
export function isProjectFlowDone(planned: readonly PlannedNode[]): boolean {
  return planned.every((entry) => entry.state === "done");
}

/** 项目是否已开始（至少一个节点进行中或已完成）。 */
export function isProjectFlowStarted(planned: readonly PlannedNode[]): boolean {
  return planned.some((entry) => entry.state === "in-progress" || entry.state === "done");
}

/**
 * 员工当前负责的节点（进行中或等待启动的未开始节点）。
 * 用于运行时判断该员工是否需要被唤醒。
 */
export function nodesOwnedByRole(
  planned: readonly PlannedNode[],
  roleId: string,
): readonly PlannedNode[] {
  return planned.filter(
    (entry) =>
      entry.node.ownerRoleId === roleId &&
      (entry.state === "in-progress" ||
        (entry.state === "not-started" && entry.action?.kind === "start")),
  );
}

/** 由节点 id 反查节点定义。 */
export function flowNodeById(nodeId: string): FlowNode | undefined {
  return TEST_FLOW_NODE_BY_ID.get(nodeId);
}
