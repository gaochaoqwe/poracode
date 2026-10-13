import { errorResult, jsonResult } from "./toolResult";
import type { McpToolResult, ToolSpec } from "./types";

/**
 * P2-09 — business-domain tools for the 测试主管 / 测试执行设计师 / OA 分管
 * roles. Deliberately small and pure: these tools MODEL the business data
 * (pipeline phases, the multi-sheet test workbook, OA submission packages);
 * the live agent thread materializes actual .docx/.xlsx/.pptx/.zip artifacts
 * through the already-bundled officecli / documentFill chain — supervisor
 * never shells out here, so no God File grows.
 *
 * Data landing: pipeline phase state lives in a supervisor-process in-memory
 * registry (lost on restart — acceptable, phases are conversational state the
 * chief steward re-reads from its dispatched team runs). Nothing here touches
 * settings, SQLite, or provider runtimes.
 */

export type TestPipelinePhase = "planning" | "requirements" | "dynamic" | "report" | "done";

export const TEST_PIPELINE_PHASES: readonly TestPipelinePhase[] = [
  "planning",
  "requirements",
  "dynamic",
  "report",
  "done",
];

/** Sheet names of the single test workbook, one per pipeline stage. */
export const TEST_WORKBOOK_SHEETS = [
  "项目信息表",
  "策划表",
  "需求分析表",
  "用例表",
  "问题报告单",
] as const;

export const OA_UNITS = ["部办", "中心", "质量部", "公会", "团委", "创新部"] as const;
export type OaUnit = (typeof OA_UNITS)[number];

const PHASE_LABELS: Record<TestPipelinePhase, string> = {
  planning: "测试策划",
  requirements: "需求分析",
  dynamic: "动态测试",
  report: "报告生成",
  done: "归档完成",
};

/** Pure phase transition: forward only, one step at a time, no backward edits. */
export function nextTestPhase(current: TestPipelinePhase): TestPipelinePhase {
  const index = TEST_PIPELINE_PHASES.indexOf(current);
  return TEST_PIPELINE_PHASES[Math.min(index + 1, TEST_PIPELINE_PHASES.length - 1)]!;
}

export function isTestPipelinePhase(value: unknown): value is TestPipelinePhase {
  return typeof value === "string" && (TEST_PIPELINE_PHASES as readonly string[]).includes(value);
}

interface ProjectPhaseState {
  phase: TestPipelinePhase;
  updatedAt: string;
}

export const DOMAIN_TOOLS: ToolSpec[] = [
  {
    name: "test_phase_advance",
    description:
      "测试主管：把一个测试项目推进到下一阶段（测试策划→需求分析→动态测试→报告生成→归档）。只前进不退步；返回当前阶段与时间戳。",
    inputSchema: {
      type: "object",
      required: ["projectId"],
      properties: {
        projectId: { type: "string", description: "测试项目 id" },
        projectName: { type: "string", description: "项目名称（新项目首登用）" },
      },
    },
  },
  {
    name: "build_test_workbook",
    description:
      "生成总 Excel 测试表单的数据模型：五个 sheet（项目信息表×2 + 策划表 + 需求分析表 + 用例表 + 问题报告单）。返回结构化数据，由线程用 officecli 落成 .xlsx。",
    inputSchema: {
      type: "object",
      required: ["project"],
      properties: {
        project: { type: "object", description: "项目信息表字段" },
        planning: { type: "array", description: "策划表行" },
        requirements: { type: "array", description: "需求分析表行" },
        cases: { type: "array", description: "用例表行" },
        issues: { type: "array", description: "问题报告单行" },
      },
    },
  },
  {
    name: "generate_test_cases",
    description:
      "测试执行设计师：动态测试用例编写（测试用例单）与需求分析表生成——把需求条目转成用例行（用例编号/标题/前置条件/步骤/预期结果）。",
    inputSchema: {
      type: "object",
      required: ["requirements"],
      properties: { requirements: { type: "array" } },
    },
  },
  {
    name: "collect_test_results",
    description: "测试执行设计师：按用例汇总执行结果（通过/失败/阻塞），输出统计与失败清单。",
    inputSchema: {
      type: "object",
      required: ["runs"],
      properties: {
        runs: { type: "array", description: "[{caseId, result: passed|failed|blocked, note?}]" },
      },
    },
  },
  {
    name: "review_document_form",
    description:
      "测试执行设计师：核对从 docx/xlsx/pptx 抽取的文本是否覆盖给定检查清单；缺失项整理进问题报告单。",
    inputSchema: {
      type: "object",
      required: ["documentKind", "checklist"],
      properties: {
        documentKind: { type: "string", enum: ["docx", "xlsx", "pptx"] },
        checklist: { type: "array", items: { type: "string" } },
        extractedText: { type: "string" },
      },
    },
  },
  {
    name: "build_report_draft",
    description:
      "按表单汇总生成报告草稿大纲：项目概述/阶段结论/用例统计/问题清单/风险；报告正式生成走流水线后台报告系统。",
    inputSchema: {
      type: "object",
      required: ["projectName"],
      properties: {
        projectName: { type: "string" },
        phase: { type: "string" },
        caseStats: { type: "object" },
        issues: { type: "array" },
      },
    },
  },
  {
    name: "oa_submission_package",
    description:
      "OA 分管：生成机关材料上报打包模型（部办/中心/质量部/公会/团委/创新部），返回目录结构与 docx/xlsx/pptx/zip 清单，由线程落盘打包。",
    inputSchema: {
      type: "object",
      required: ["unit", "title"],
      properties: {
        unit: { type: "string", enum: [...OA_UNITS] },
        title: { type: "string" },
        attachments: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "oa_material_skeleton",
    description: "OA 分管：按机关部门返回汇报材料骨架（章节标题建议）。",
    inputSchema: {
      type: "object",
      required: ["unit"],
      properties: { unit: { type: "string", enum: [...OA_UNITS] } },
    },
  },
];

export const DOMAIN_TOOL_NAMES = new Set(DOMAIN_TOOLS.map((tool) => tool.name));

/** Supervisor-process registry of live test projects' pipeline phase. */
export class TestPipelineRegistry {
  private readonly projects = new Map<string, ProjectPhaseState>();

  advance(projectId: string, projectName?: string): ProjectPhaseState & { projectName?: string } {
    const current = this.projects.get(projectId)?.phase ?? "planning";
    const next = nextTestPhase(current);
    const state = { phase: next, updatedAt: new Date().toISOString() };
    this.projects.set(projectId, state);
    return { ...state, ...(projectName ? { projectName } : {}) };
  }

  get(projectId: string): ProjectPhaseState | undefined {
    return this.projects.get(projectId);
  }
}

function generateTestCases(requirements: readonly unknown[]): Array<{
  caseId: string;
  title: string;
  precondition: string;
  steps: string;
  expected: string;
}> {
  return requirements.map((requirement, index) => {
    const text = typeof requirement === "string" ? requirement : JSON.stringify(requirement);
    return {
      caseId: `TC-${String(index + 1).padStart(3, "0")}`,
      title: text.slice(0, 40),
      precondition: "环境就绪",
      steps: `按需求「${text.slice(0, 60)}」执行验证步骤`,
      expected: "行为与需求描述一致",
    };
  });
}

function collectTestResults(runs: readonly unknown[]): {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  failures: unknown[];
} {
  let passed = 0;
  let failed = 0;
  let blocked = 0;
  const failures: unknown[] = [];
  for (const run of runs) {
    const status = (run as { result?: string }).result;
    if (status === "passed") passed += 1;
    else if (status === "blocked") blocked += 1;
    else {
      failed += 1;
      failures.push(run);
    }
  }
  return { total: runs.length, passed, failed, blocked, failures };
}

function oaSkeleton(unit: OaUnit): { unit: string; sections: string[] } {
  const sections: Record<OaUnit, string[]> = {
    部办: ["工作概述", "重点事项办理", "请示与建议"],
    中心: ["任务完成情况", "业务数据", "下步安排"],
    质量部: ["质量指标", "问题与整改", "质量改进措施"],
    公会: ["活动开展", "会员服务", "经费使用"],
    团委: ["思想引领", "青年活动", "志愿服务"],
    创新部: ["创新项目进展", "成果与转化", "下一步计划"],
  };
  return { unit, sections: sections[unit] };
}

export async function dispatchDomainTool(
  name: string,
  args: Record<string, unknown>,
  registry: TestPipelineRegistry = new TestPipelineRegistry(),
): Promise<McpToolResult> {
  if (!DOMAIN_TOOL_NAMES.has(name)) {
    return errorResult(`超出总管家能力范围：未知或未授权工具 ${name}`);
  }
  switch (name) {
    case "test_phase_advance": {
      const projectId = typeof args.projectId === "string" ? args.projectId : "";
      if (!projectId) return errorResult("projectId is required");
      const state = registry.advance(
        projectId,
        typeof args.projectName === "string" ? args.projectName : undefined,
      );
      return jsonResult({ ...state, phaseLabel: PHASE_LABELS[state.phase] });
    }
    case "build_test_workbook": {
      return jsonResult({
        sheets: [
          { name: "项目信息表", rows: args.project ? [args.project] : [] },
          { name: "策划表", rows: Array.isArray(args.planning) ? args.planning : [] },
          { name: "需求分析表", rows: Array.isArray(args.requirements) ? args.requirements : [] },
          { name: "用例表", rows: Array.isArray(args.cases) ? args.cases : [] },
          { name: "问题报告单", rows: Array.isArray(args.issues) ? args.issues : [] },
        ],
      });
    }
    case "generate_test_cases": {
      const requirements = Array.isArray(args.requirements) ? args.requirements : [];
      return jsonResult({ cases: generateTestCases(requirements) });
    }
    case "collect_test_results": {
      const runs = Array.isArray(args.runs) ? args.runs : [];
      return jsonResult(collectTestResults(runs));
    }
    case "review_document_form": {
      const checklist = Array.isArray(args.checklist) ? args.checklist : [];
      const text = typeof args.extractedText === "string" ? args.extractedText : "";
      const missing = checklist.filter((item) => typeof item === "string" && !text.includes(item));
      return jsonResult({ documentKind: args.documentKind, missing, checked: checklist.length });
    }
    case "build_report_draft": {
      return jsonResult({
        sections: [
          "项目概述",
          `阶段结论（${typeof args.phase === "string" ? args.phase : "未知"}）`,
          "用例统计",
          "问题清单",
          "风险与建议",
        ],
        caseStats: args.caseStats ?? {},
        issues: Array.isArray(args.issues) ? args.issues : [],
      });
    }
    case "oa_submission_package": {
      const unit = typeof args.unit === "string" ? args.unit : "";
      const title = typeof args.title === "string" ? args.title : "";
      if (!OA_UNITS.includes(unit as OaUnit)) return errorResult(`未知机关部门：${unit}`);
      const attachments = Array.isArray(args.attachments) ? args.attachments : [];
      return jsonResult({
        directory: `${unit}/报送材料/${title}/`,
        files: [...attachments, "说明.docx", "汇总.xlsx", "汇报.pptx"],
        archive: `${unit}_${title}.zip`,
      });
    }
    case "oa_material_skeleton": {
      const unit = typeof args.unit === "string" ? args.unit : "";
      if (!OA_UNITS.includes(unit as OaUnit)) return errorResult(`未知机关部门：${unit}`);
      return jsonResult(oaSkeleton(unit as OaUnit));
    }
    default:
      return errorResult(`超出总管家能力范围：未知或未授权工具 ${name}`);
  }
}
