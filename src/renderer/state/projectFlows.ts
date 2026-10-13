import type { Project, Workspace } from "@/shared/contracts";
import type { TestPipelinePhase } from "./orgFlow";

/**
 * 项目流程图 —— 项目看板右侧「项目流程图」的数据源与纯函数选择器。
 *
 * 一个项目按其条线（测试 / 办公 / 开发）套用一套预置流程模板：模板由若干
 * 节点（步骤 / 质量门）与节点之间的连线组成。每个节点、每条连线都带一个
 * 「执行方」：`auto` = 数字员工自动完成，`manual` = 需要人工（使用人员）完成。
 * 用户可在看板上逐节点 / 逐连线改写执行方，覆盖值持久化在
 * `projectFlowStore`。
 *
 * 模板内容对齐 `organizationSeed.ts` 的岗位划分与测评中心流水线
 * （planning → requirements → dynamic → report → done）。
 *
 * 纯数据 + 纯函数，便于单测；UI 只读这里的选择器。
 */

/** 项目条线：决定套用哪一套流程模板。 */
export type ProjectFlowKind = "test" | "office" | "dev";

export const PROJECT_FLOW_KINDS: readonly ProjectFlowKind[] = ["test", "office", "dev"];

export const PROJECT_FLOW_KIND_LABELS: Record<ProjectFlowKind, string> = {
  test: "测试项目",
  office: "办公项目",
  dev: "开发类任务",
};

/** 步骤执行方：auto = 数字员工（自动化）；manual = 人工（使用人员）。 */
export type FlowStepOwner = "auto" | "manual";

export const FLOW_STEP_OWNER_LABELS: Record<FlowStepOwner, string> = {
  auto: "自动（数字员工）",
  manual: "人工（使用人员）",
};

/** 节点形态：step = 普通步骤；gate = 质量门（需审查通过才放行）。 */
export type ProjectFlowNodeKind = "step" | "gate";

export interface ProjectFlowNode {
  id: string;
  label: string;
  /** 默认执行方（可被用户覆盖）。 */
  owner: FlowStepOwner;
  /** 承接该步骤的数字员工岗位 id（auto 时给出，用于点亮当前进度）。 */
  employeeId?: string;
  /** 岗位名（展示用，避免 UI 再查 workspace）。 */
  employeeLabel?: string;
  /** 网格列 / 行（左→右为主轴，行表示并行泳道）。 */
  col: number;
  row: number;
  kind: ProjectFlowNodeKind;
}

export interface ProjectFlowEdge {
  id: string;
  from: string;
  to: string;
  /** 默认执行方（可被用户覆盖）：这一步流转由谁推动。 */
  owner: FlowStepOwner;
  /** 虚线 = 监督 / 旁路关系，不是主链路流转。 */
  dashed?: boolean;
  label?: string;
}

export interface ProjectFlowTemplate {
  kind: ProjectFlowKind;
  title: string;
  description: string;
  nodes: readonly ProjectFlowNode[];
  edges: readonly ProjectFlowEdge[];
  /** 流水线阶段 → 停留节点 id（仅测试项目有真实阶段数据）。 */
  phaseNodeIds?: Readonly<Record<TestPipelinePhase, string>>;
}

/* ────────────────────────────── 测试项目流程 ────────────────────────────── */

/**
 * 测试条线（复杂）：总主管接入 → 测试主管策划 → 测评中心流水线
 * （需求分析 / 动态测试 / 报告 / 完成）+ 8 人测试团队并行审查 +
 * 两道质量门（表单核验 / 报告核验）。
 */
const TEST_FLOW: ProjectFlowTemplate = {
  kind: "test",
  title: "测试项目流程",
  description:
    "任务经总主管分流进入测试条线，测试主管完成策划后按测评中心流水线推进；3 名审查设计师并行产出问题报告单，2 名质量审查把两道门，末端触发报告生成系统。",
  nodes: [
    { id: "t-receive", label: "接收任务（OA / mxt / 老板交办）", owner: "manual", col: 0, row: 1, kind: "step" },
    { id: "t-triage", label: "判断条线并分发", owner: "auto", employeeId: "org-chief-steward", employeeLabel: "总主管", col: 1, row: 1, kind: "step" },
    { id: "t-plan", label: "测试策划（项目信息表 + 策划表）", owner: "auto", employeeId: "org-test-lead", employeeLabel: "测试主管", col: 2, row: 1, kind: "step" },
    { id: "t-progress", label: "流水线进度与质量把控", owner: "auto", employeeId: "org-test-project-lead", employeeLabel: "测试项目主管", col: 2, row: 0, kind: "step" },
    { id: "t-req", label: "需求分析表", owner: "auto", employeeId: "org-test-designer-4", employeeLabel: "设计师（动态测试）", col: 3, row: 1, kind: "step" },
    { id: "t-case", label: "测试用例表", owner: "auto", employeeId: "org-test-designer-4", employeeLabel: "设计师（动态测试）", col: 4, row: 1, kind: "step" },
    { id: "t-gate-form", label: "表单核验", owner: "auto", employeeId: "org-test-qa-1", employeeLabel: "质量审查（表单）", col: 4, row: 0, kind: "gate" },
    { id: "t-doc-review", label: "文档审查", owner: "auto", employeeId: "org-test-designer-1", employeeLabel: "设计师（文档审查）", col: 4, row: 2, kind: "step" },
    { id: "t-static", label: "静态分析", owner: "auto", employeeId: "org-test-designer-2", employeeLabel: "设计师（静态分析）", col: 5, row: 2, kind: "step" },
    { id: "t-code-review", label: "代码审查", owner: "auto", employeeId: "org-test-designer-3", employeeLabel: "设计师（代码审查）", col: 6, row: 2, kind: "step" },
    { id: "t-exec", label: "用例执行与结果收集", owner: "auto", employeeId: "org-test-designer-4", employeeLabel: "设计师（动态测试）", col: 5, row: 1, kind: "step" },
    { id: "t-issues", label: "问题汇总到问题报告单", owner: "auto", col: 7, row: 2, kind: "step" },
    { id: "t-report-draft", label: "汇总素材并编写报告", owner: "auto", employeeId: "org-test-designer-5", employeeLabel: "设计师（编写报告）", col: 6, row: 1, kind: "step" },
    { id: "t-gate-report", label: "报告核验", owner: "auto", employeeId: "org-test-qa-2", employeeLabel: "质量审查（报告）", col: 7, row: 0, kind: "gate" },
    { id: "t-report-gen", label: "触发后台报告生成系统", owner: "manual", col: 7, row: 1, kind: "step" },
    { id: "t-accept", label: "交付验收与汇报", owner: "auto", employeeId: "org-test-lead", employeeLabel: "测试主管", col: 8, row: 1, kind: "step" },
  ],
  edges: [
    { id: "te-receive-triage", from: "t-receive", to: "t-triage", owner: "auto" },
    { id: "te-triage-plan", from: "t-triage", to: "t-plan", owner: "auto" },
    { id: "te-plan-progress", from: "t-plan", to: "t-progress", owner: "auto", dashed: true, label: "监控" },
    { id: "te-plan-req", from: "t-plan", to: "t-req", owner: "auto", label: "导入策划" },
    { id: "te-req-case", from: "t-req", to: "t-case", owner: "auto", label: "需求分析" },
    { id: "te-case-gate", from: "t-case", to: "t-gate-form", owner: "auto", label: "送审" },
    { id: "te-gate-exec", from: "t-gate-form", to: "t-exec", owner: "auto", label: "放行" },
    { id: "te-case-doc", from: "t-case", to: "t-doc-review", owner: "auto" },
    { id: "te-case-static", from: "t-case", to: "t-static", owner: "auto" },
    { id: "te-case-code", from: "t-case", to: "t-code-review", owner: "auto" },
    { id: "te-doc-issues", from: "t-doc-review", to: "t-issues", owner: "auto" },
    { id: "te-static-issues", from: "t-static", to: "t-issues", owner: "auto" },
    { id: "te-code-issues", from: "t-code-review", to: "t-issues", owner: "auto" },
    { id: "te-issues-report", from: "t-issues", to: "t-report-draft", owner: "auto" },
    { id: "te-exec-report", from: "t-exec", to: "t-report-draft", owner: "auto", label: "动态测试" },
    { id: "te-report-gate", from: "t-report-draft", to: "t-gate-report", owner: "auto", label: "送审" },
    { id: "te-gate-gen", from: "t-gate-report", to: "t-report-gen", owner: "manual", label: "触发（系统未对接）" },
    { id: "te-gen-accept", from: "t-report-gen", to: "t-accept", owner: "auto" },
    { id: "te-progress-accept", from: "t-progress", to: "t-accept", owner: "auto", dashed: true, label: "进度把关" },
  ],
  phaseNodeIds: {
    planning: "t-plan",
    requirements: "t-req",
    dynamic: "t-exec",
    report: "t-report-draft",
    done: "t-accept",
  },
};

/* ────────────────────────────── 办公项目流程 ────────────────────────────── */

/** 办公条线（简单）：接收任务 → 理解任务 → 按模板出文档 → 打包归档 → 上报。 */
const OFFICE_FLOW: ProjectFlowTemplate = {
  kind: "office",
  title: "办公项目流程",
  description:
    "接收任务后由办公主管理解要求，按机关模板生成 Word / Excel / PPT 并打包归档，最后上报机关部门。首尾两步需要人工，中间生成环节由数字员工完成。",
  nodes: [
    { id: "o-receive", label: "接收任务（OA / 老板交办）", owner: "manual", col: 0, row: 0, kind: "step" },
    { id: "o-understand", label: "理解任务与材料要求", owner: "auto", employeeId: "org-oa", employeeLabel: "办公主管", col: 1, row: 0, kind: "step" },
    { id: "o-draft", label: "按模板生成文档（Word / Excel / PPT）", owner: "auto", employeeId: "org-oa", employeeLabel: "办公主管", col: 2, row: 0, kind: "step" },
    { id: "o-package", label: "打包 .zip 并按模板命名归档", owner: "auto", employeeId: "org-oa", employeeLabel: "办公主管", col: 3, row: 0, kind: "step" },
    { id: "o-report", label: "上报机关部门（OA 收发录入）", owner: "manual", col: 4, row: 0, kind: "step" },
  ],
  edges: [
    { id: "oe-receive-understand", from: "o-receive", to: "o-understand", owner: "auto" },
    { id: "oe-understand-draft", from: "o-understand", to: "o-draft", owner: "auto" },
    { id: "oe-draft-package", from: "o-draft", to: "o-package", owner: "auto" },
    { id: "oe-package-report", from: "o-package", to: "o-report", owner: "manual", label: "人工上报" },
  ],
};

/* ────────────────────────────── 开发类任务流程 ────────────────────────────── */

/**
 * 开发条线（最简）：开发主管只做台账登记与任务列表；老板自己写代码，
 * 不在公司内网执行，因此流程到「阅读任务信息」即闭环。
 */
const DEV_FLOW: ProjectFlowTemplate = {
  kind: "dev",
  title: "开发类任务流程",
  description:
    "开发主管只做台账登记与任务列表，不做深度执行、不在公司内网运行；任务信息整理好后交由人阅读排期，流程即闭环。",
  nodes: [
    { id: "d-receive", label: "接收任务（总主管转来）", owner: "manual", col: 0, row: 0, kind: "step" },
    { id: "d-ledger", label: "登记任务面板台账", owner: "auto", employeeId: "org-dev-lead", employeeLabel: "开发主管", col: 1, row: 0, kind: "step" },
    { id: "d-list", label: "形成任务列表", owner: "auto", employeeId: "org-dev-lead", employeeLabel: "开发主管", col: 2, row: 0, kind: "step" },
    { id: "d-feedback", label: "阅读任务信息 / 反馈进展", owner: "manual", col: 3, row: 0, kind: "step" },
  ],
  edges: [
    { id: "de-receive-ledger", from: "d-receive", to: "d-ledger", owner: "auto" },
    { id: "de-ledger-list", from: "d-ledger", to: "d-list", owner: "auto" },
    { id: "de-list-feedback", from: "d-list", to: "d-feedback", owner: "manual", label: "人工查阅" },
  ],
};

export const PROJECT_FLOW_TEMPLATES: Readonly<Record<ProjectFlowKind, ProjectFlowTemplate>> = {
  test: TEST_FLOW,
  office: OFFICE_FLOW,
  dev: DEV_FLOW,
};

export function projectFlowTemplate(kind: ProjectFlowKind): ProjectFlowTemplate {
  return PROJECT_FLOW_TEMPLATES[kind];
}

/* ────────────────────────────── 分类与选择器 ────────────────────────────── */

/**
 * 推断项目属于哪条条线：优先看项目挂靠岗位（workspace）的 category，
 * 其次回退到岗位名关键字（种子容器默认不带 category）。确实判不出来时
 * 归到最简单的办公流程，用户可在看板上手动改写。
 */
export function inferProjectFlowKind(
  project: Pick<Project, "workspaceId">,
  workspaces: readonly Workspace[],
): ProjectFlowKind {
  const workspace = project.workspaceId
    ? workspaces.find((w) => w.id === project.workspaceId)
    : undefined;
  if (workspace?.category === "test") return "test";
  if (workspace?.category === "code") return "dev";
  if (workspace?.category === "docs" || workspace?.category === "general") return "office";
  const name = workspace?.name ?? "";
  if (name.includes("测试")) return "test";
  if (name.includes("编码") || name.includes("开发") || name.includes("研发")) return "dev";
  if (name.includes("文档") || name.includes("办公")) return "office";
  return "office";
}

/** 取某个节点 / 连线的生效执行方（用户覆盖优先，其次模板默认）。 */
export function resolveFlowStepOwner(
  base: FlowStepOwner,
  overrides: Readonly<Record<string, FlowStepOwner>> | undefined,
  stepId: string,
): FlowStepOwner {
  return overrides?.[stepId] ?? base;
}

export function findFlowNode(
  template: ProjectFlowTemplate,
  nodeId: string,
): ProjectFlowNode | undefined {
  return template.nodes.find((node) => node.id === nodeId);
}

export function findFlowEdge(
  template: ProjectFlowTemplate,
  edgeId: string,
): ProjectFlowEdge | undefined {
  return template.edges.find((edge) => edge.id === edgeId);
}

/** 步骤 id 的默认执行方（节点与连线统一查询）。 */
export function defaultStepOwner(
  template: ProjectFlowTemplate,
  stepId: string,
): FlowStepOwner | undefined {
  return findFlowNode(template, stepId)?.owner ?? findFlowEdge(template, stepId)?.owner;
}

/* ────────────────────────────── 当前进度解析 ────────────────────────────── */

export interface ProjectFlowPosition {
  /** 当前停留的节点 id（有人在节点上作业）。 */
  nodeId?: string;
  /** 当前正在流转的连线 id（在节点之间交接）。 */
  edgeId?: string;
  /** true = 由实时线程活动推断；false = 由流水线阶段推断。 */
  fromActivity: boolean;
}

export interface ProjectFlowPositionInput {
  /** 测评中心流水线阶段（仅测试项目有）。 */
  phase?: TestPipelinePhase | undefined;
  /** 该项目上正在作业（working / launching）的岗位 id 集合。 */
  activeEmployeeIds: readonly string[];
}

/**
 * 解析项目当前卡在哪个节点 / 哪条连线：
 *  1. 有流水线阶段 → 落到阶段对应节点；若该节点的承接岗位正在作业，则判定
 *     「在节点上执行」，否则判定「停在出边上等待流转（交接中）」。
 *  2. 无阶段数据 → 用正在作业的岗位反查节点（办公 / 开发条线）。
 */
export function resolveProjectFlowPosition(
  template: ProjectFlowTemplate,
  input: ProjectFlowPositionInput,
): ProjectFlowPosition | null {
  const active = new Set(input.activeEmployeeIds);
  const phase = input.phase;
  const phaseNodeId = phase && template.phaseNodeIds ? template.phaseNodeIds[phase] : undefined;
  if (phaseNodeId) {
    const node = findFlowNode(template, phaseNodeId);
    if (node?.employeeId !== undefined && active.has(node.employeeId)) {
      return { nodeId: node.id, fromActivity: true };
    }
    const outgoing = template.edges.find((edge) => edge.from === phaseNodeId && edge.dashed !== true);
    if (outgoing) return { edgeId: outgoing.id, fromActivity: active.size > 0 };
    return { nodeId: phaseNodeId, fromActivity: false };
  }
  for (const node of template.nodes) {
    if (node.employeeId !== undefined && active.has(node.employeeId)) {
      return { nodeId: node.id, fromActivity: true };
    }
  }
  return null;
}
