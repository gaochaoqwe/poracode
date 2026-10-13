/**
 * 数字员工系统 · 文件系统驱动快照类型（shared）
 *
 * `FlowDriverSnapshot` 是 supervisor 侧文件系统驱动每一轮扫描-派发的结果
 * （纯数据，可跨进程传输）：进行中的测试项目列表 + 每个项目 P0~P14 节点的
 * 推导状态 + 本轮派发记录。main 转发、renderer 展示都只依赖这里的类型，
 * supervisor 的 `FlowDriver` 实现位于 `src/supervisor/digitalEmployee/`。
 */

import type { FlowNode } from "./flowTypes";
import type { PlannedNode } from "./flowEngine";

/** 单个项目的一轮流转规划结果。 */
export interface ProjectFlowPlan {
  projectDir: string;
  nodes: PlannedNode[];
  started: boolean;
  done: boolean;
}

/** 一个需要唤醒的节点任务（planFlow 推导出 start 动作）。 */
export interface FlowWakeup {
  roleId: string;
  node: FlowNode;
  projectDir: string;
  /** 应创建的文件夹名：「[P3-文档审查-进行中]」。 */
  targetFolderName: string;
  reason: string;
}

/** 一轮派发中单个节点的处理记录。 */
export interface FlowDispatchEntry {
  roleId: string;
  nodeId: string;
  projectDir: string;
  status: "spawned" | "skipped" | "failed";
  detail?: string;
}

/** 驱动一轮扫描-派发的结果（供 UI / IPC 展示）。 */
export interface FlowDriverSnapshot {
  scannedAt: string;
  projects: ProjectFlowPlan[];
  wakeups: FlowWakeup[];
  dispatched: FlowDispatchEntry[];
}
