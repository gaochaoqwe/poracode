/**
 * 数字员工系统 · 文件系统流转算法 —— 类型与常量
 *
 * 流转规则（与 `docs/数字员工系统-设计说明.md` 第 3 节一致）：
 * - 文件系统是员工之间协作的唯一载体；
 * - 每个项目的每个节点（工作步骤）对应一个真实文件夹；
 * - 节点文件夹名带状态前缀，格式为「[节点-状态]」，例如：
 *   - 开始后：「[P3-文档审查-进行中]」
 *   - 完成后：「[P3-文档审查-已完成]」
 * - 节点未开始前，对应员工收不到任何文件（文件夹不存在）；
 * - 文件已流转到该员工但员工正忙于其他项目时，文件保持上一节点
 *   完成时的状态原地等待；
 * - 员工根据自己收到文件夹的当前状态判断何时开始、何时结束。
 *
 * 本模块只描述模型与纯函数（解析/生成），不触碰文件系统；
 * 目录扫描与状态规划见 `flowEngine.ts`，文件系统布局见 `flowLayout.ts`。
 */

/** 测试项目生命周期状态（对应状态目录名） */
export const PROJECT_LIFECYCLE_STATES = ["未开展", "进行中", "已完成"] as const;
export type ProjectLifecycleState = (typeof PROJECT_LIFECYCLE_STATES)[number];

/** 节点文件夹状态后缀（「[节点-状态]」格式中的状态段） */
export const NODE_FOLDER_STATES = ["进行中", "已完成"] as const;
export type NodeFolderState = (typeof NODE_FOLDER_STATES)[number];

/** 节点在流转算法中的推导状态 */
export const NODE_STATES = ["not-started", "waiting", "in-progress", "done"] as const;
export type NodeState = (typeof NODE_STATES)[number];

/** 一个工作节点（P0~P14 之一） */
export interface FlowNode {
  /** 稳定节点 id，如 "P0" ~ "P14"。 */
  id: string;
  /** 节点名称，如 "文档审查"。 */
  label: string;
  /** 执行该节点的员工岗位 roleId（管理层或执行层员工）。 */
  ownerRoleId: string;
  /** 前置节点 id：全部完成后本节点才允许开始。 */
  dependsOn: readonly string[];
}

/**
 * 软件测评流水线 P0~P14 节点表。
 *
 * 执行岗位与组织种子的 roleId 对齐（管理层：测试主管 org-test-lead /
 * 测试项目主管 org-test-project-lead；执行层：org-test-team 的 5 名设计师 +
 * 2 名质量审查）。P0 由测试主管负责（含 组织资产/参考资料/本项目资料
 * 三个子目录的准备），P2 测试策划也由测试主管执行。
 *
 * 并行结构：
 * - P1 准入审查通过后进入 P2 测试策划；
 * - P2 完成后 P3~P9（文档审查/静态分析/代码审查/动态测试四个串行子步骤）
 *   可并行推进（动态测试内部 P6→P7→P8→P9 串行）；
 * - P3/P4/P5/P9 全部完成进入 P10 表单质量检查；
 * - P11 报告生成 → P12 报告编写 → P13 报告质量检查 → P14 最终报告。
 */
export const TEST_FLOW_NODES: readonly FlowNode[] = [
  { id: "P0", label: "测试申请文件", ownerRoleId: "org-test-lead", dependsOn: [] },
  { id: "P1", label: "准入审查", ownerRoleId: "org-test-project-lead", dependsOn: ["P0"] },
  { id: "P2", label: "测试策划", ownerRoleId: "org-test-lead", dependsOn: ["P1"] },
  { id: "P3", label: "文档审查", ownerRoleId: "org-test-designer-1", dependsOn: ["P2"] },
  { id: "P4", label: "静态分析", ownerRoleId: "org-test-designer-2", dependsOn: ["P2"] },
  { id: "P5", label: "代码审查", ownerRoleId: "org-test-designer-3", dependsOn: ["P2"] },
  { id: "P6", label: "动态测试-用例设计", ownerRoleId: "org-test-designer-4", dependsOn: ["P2"] },
  { id: "P7", label: "动态测试-用例执行", ownerRoleId: "org-test-designer-4", dependsOn: ["P6"] },
  { id: "P8", label: "动态测试-用例修正", ownerRoleId: "org-test-designer-4", dependsOn: ["P7"] },
  { id: "P9", label: "动态测试-问题单生成", ownerRoleId: "org-test-designer-4", dependsOn: ["P8"] },
  { id: "P10", label: "表单质量检查", ownerRoleId: "org-test-qa-1", dependsOn: ["P3", "P4", "P5", "P9"] },
  { id: "P11", label: "报告生成", ownerRoleId: "org-test-designer-5", dependsOn: ["P10"] },
  { id: "P12", label: "报告编写", ownerRoleId: "org-test-designer-5", dependsOn: ["P11"] },
  { id: "P13", label: "报告质量检查", ownerRoleId: "org-test-qa-2", dependsOn: ["P12"] },
  { id: "P14", label: "最终报告", ownerRoleId: "org-test-project-lead", dependsOn: ["P13"] },
];

export const TEST_FLOW_NODE_BY_ID: ReadonlyMap<string, FlowNode> = new Map(
  TEST_FLOW_NODES.map((node) => [node.id, node]),
);

/** 节点 id 的有序列表（P0 → P14）。 */
export const TEST_FLOW_NODE_IDS: readonly string[] = TEST_FLOW_NODES.map((node) => node.id);

/**
 * 生成节点文件夹名：「[P3-文档审查-进行中]」。
 * 骨架目录（未开始）使用不带前缀的「P3-文档审查」。
 */
export function nodeFolderName(node: FlowNode, state: NodeFolderState): string {
  return `[${node.id}-${node.label}-${state}]`;
}

/** 生成节点骨架目录名（未开始时的静态目录）：「P3-文档审查」。 */
export function nodeSkeletonFolderName(node: FlowNode): string {
  return `${node.id}-${node.label}`;
}

/**
 * 解析节点文件夹名「[P3-文档审查-进行中]」。
 * 返回 null 表示该名称不是合法的节点状态文件夹名（含骨架目录名）。
 */
export function parseNodeFolderName(
  name: string,
): { nodeId: string; folderState: NodeFolderState } | null {
  const match = /^\[(P\d+)-(.+)-(进行中|已完成)\]$/.exec(name);
  if (!match) return null;
  return { nodeId: match[1]!, folderState: match[3] as NodeFolderState };
}

/** 判断名称是否为某节点的骨架目录名（「P3-文档审查」）。 */
export function isNodeSkeletonName(name: string, nodeId: string): boolean {
  const node = TEST_FLOW_NODE_BY_ID.get(nodeId);
  return node ? name === nodeSkeletonFolderName(node) : false;
}

/** 项目状态目录是否合法。 */
export function isProjectLifecycleState(value: string): value is ProjectLifecycleState {
  return (PROJECT_LIFECYCLE_STATES as readonly string[]).includes(value);
}
