import type { ScenarioCategory, Workspace } from "@/shared/contracts";
import { createWorkspace, updateWorkspaceProfile } from "@/renderer/actions/workspaceActions";

/**
 * A reusable digital-employee (岗位) job template. Mirrors the employee-profile
 * fields on `Workspace` (persona / responsibilities / skills / capabilities /
 * default binding / permissions) plus a human description — the shape CrewAI
 * calls role + goal + backstory. `category` is kept so an imported role lands in
 * the right task domain.
 */
export interface EmployeeTemplate {
  /** Stable template id (not a workspace id). */
  id: string;
  name: string;
  description: string;
  category?: ScenarioCategory | undefined;
  persona: string;
  responsibilities: string[];
  skillIds: string[];
  capabilityTags: string[];
  defaultThreadConfig?: Workspace["defaultThreadConfig"] | undefined;
  permissions?: Workspace["permissions"] | undefined;
}

/** Built-in role templates users can adopt with one click. */
export const EMPLOYEE_TEMPLATES: readonly EmployeeTemplate[] = [
  {
    id: "tmpl-requirements",
    name: "需求文档岗",
    description: "把模糊想法整理成可评审、可追溯的需求规格说明（SRS）。",
    category: "docs",
    persona:
      "我是「需求文档岗」员工。我擅长把模糊的业务想法整理成结构清晰的需求规格说明（SRS）：背景、目标、范围、功能与非功能需求、验收标准、约束与假设，做到可评审、可追溯、无歧义。",
    responsibilities: ["编写需求规格说明", "需求拆分与优先级", "验收标准定义", "需求评审"],
    skillIds: ["srs", "req-analysis"],
    capabilityTags: ["需求文档", "SRS", "验收标准", "需求评审"],
    defaultThreadConfig: undefined,
    permissions: undefined,
  },
  {
    id: "tmpl-design",
    name: "设计文档岗",
    description: "把需求转化为模块设计、接口与影响分析，供实现与评审使用。",
    category: "docs",
    persona:
      "我是「设计文档岗」员工。我擅长把需求转化为可落地的软件设计：架构与模块划分、接口定义、数据模型、时序与状态、影响分析（Impact Analysis）与风险，产出结构清晰、可评审的设计文档。",
    responsibilities: ["架构与模块设计", "接口与数据模型定义", "影响分析报告", "设计评审"],
    skillIds: ["design-doc", "impact-analysis"],
    capabilityTags: ["设计文档", "架构", "接口", "影响分析", "设计评审"],
    defaultThreadConfig: undefined,
    permissions: undefined,
  },
  {
    id: "tmpl-code-impl",
    name: "代码实现岗",
    description: "负责脚手架搭建、功能实现、缺陷修复与单元测试，遵循仓库规范。",
    category: "code",
    persona:
      "我是「代码实现岗」员工。我负责项目脚手架搭建、功能实现、缺陷修复与单元测试编写，遵循仓库规范，保持改动范围克制，提交前自测通过。",
    responsibilities: ["脚手架搭建", "功能实现", "缺陷修复", "单元测试", "代码评审响应"],
    skillIds: ["coding", "refactor"],
    capabilityTags: ["编码", "缺陷修复", "单元测试", "重构"],
    defaultThreadConfig: undefined,
    permissions: undefined,
  },
  {
    id: "tmpl-code-review",
    name: "代码审查岗",
    description: "从正确性、可维护性与规范符合度审查变更，输出可执行的修改建议。",
    category: "code",
    persona:
      "我是「代码审查岗」员工。我从正确性、可维护性、可读性与规范符合度审查代码变更，聚焦缺陷、边界条件与安全隐患，输出定位到行的可执行修改建议，不擅自改代码。",
    responsibilities: ["变更审查", "缺陷与边界识别", "规范符合度检查", "审查意见输出"],
    skillIds: ["code-review", "static-analysis"],
    capabilityTags: ["代码审查", "静态分析", "缺陷识别", "规范检查"],
    defaultThreadConfig: undefined,
    permissions: undefined,
  },
  {
    id: "tmpl-test",
    name: "软件测试岗",
    description: "设计测试用例、执行测试并输出缺陷报告，关注覆盖率与边界。",
    category: "test",
    persona:
      "我是「软件测试岗」员工。我负责测试方案与用例设计、测试执行与缺陷报告，关注覆盖率、边界条件与可追溯性，为交付质量把关，用证据说话。",
    responsibilities: ["测试方案设计", "测试用例生成", "测试执行", "缺陷报告"],
    skillIds: ["test-case", "boundary-test"],
    capabilityTags: ["测试用例", "边界测试", "缺陷报告", "覆盖率"],
    defaultThreadConfig: undefined,
    permissions: undefined,
  },
];

/** Serialize a template to JSON for export / clipboard. */
export function serializeTemplate(template: EmployeeTemplate): string {
  return JSON.stringify(template, null, 2);
}

/** Parse imported template JSON; returns null when the shape is unusable. */
export function parseTemplate(json: string): EmployeeTemplate | null {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Partial<EmployeeTemplate>;
    if (
      typeof candidate.name !== "string" ||
      typeof candidate.persona !== "string" ||
      !Array.isArray(candidate.responsibilities) ||
      !Array.isArray(candidate.skillIds) ||
      !Array.isArray(candidate.capabilityTags)
    ) {
      return null;
    }
    return {
      id: candidate.id ?? crypto.randomUUID(),
      name: candidate.name,
      description: typeof candidate.description === "string" ? candidate.description : "",
      category:
        candidate.category === "general" || candidate.category === "docs" ||
        candidate.category === "code" || candidate.category === "test"
          ? candidate.category
          : undefined,
      persona: candidate.persona,
      responsibilities: candidate.responsibilities.filter((x) => typeof x === "string"),
      skillIds: candidate.skillIds.filter((x) => typeof x === "string"),
      capabilityTags: candidate.capabilityTags.filter((x) => typeof x === "string"),
      defaultThreadConfig:
        candidate.defaultThreadConfig && typeof candidate.defaultThreadConfig === "object"
          ? candidate.defaultThreadConfig
          : undefined,
      permissions:
        candidate.permissions && typeof candidate.permissions === "object"
          ? candidate.permissions
          : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Adopt a template as a new employee (岗位): create a workspace and fill its
 * employee profile from the template. Returns the new workspace or null.
 */
export function applyEmployeeTemplate(name: string, template: EmployeeTemplate): Workspace | null {
  const workspace = createWorkspace(name);
  if (!workspace) return null;
  updateWorkspaceProfile(workspace.id, {
    persona: template.persona,
    responsibilities: template.responsibilities,
    skillIds: template.skillIds,
    capabilityTags: template.capabilityTags,
    defaultThreadConfig: template.defaultThreadConfig,
    permissions: template.permissions,
  });
  return workspace;
}

/** Extract a template from an existing employee (岗位) for export. */
export function buildTemplateFromWorkspace(workspace: Workspace): EmployeeTemplate {
  return {
    id: crypto.randomUUID(),
    name: workspace.name,
    description: workspace.persona ? "" : `基于 ${workspace.name} 导出的岗位模板`,
    category: workspace.category,
    persona: workspace.persona ?? "",
    responsibilities: workspace.responsibilities ?? [],
    skillIds: workspace.skillIds ?? [],
    capabilityTags: workspace.capabilityTags ?? [],
    defaultThreadConfig: workspace.defaultThreadConfig,
    permissions: workspace.permissions,
  };
}
