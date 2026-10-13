import { nextWorkspaceIconId, type TeamDispatchPolicy, type Workspace } from "@/shared/contracts";
import type { SharedSettings } from "@/shared/settings";

/**
 * The one-time fixed-organization seed. The user confirmed a concrete two-level
 * org tree: 4 top-level containers (navigation only shows these) over 11
 * employee roles. This module materializes that tree as settings, upgrades a
 * v1 flat-seed install in place (adding rank/parent without clobbering user
 * bindings), and then never touches it again.
 *
 * Provider-agnostic by design: the seeded workspaces carry NO `agentKind` /
 * `agentInstanceId` — the user binds each role to a provider on the employee
 * edit page later. Ids are stable constants, never derived from a provider.
 *
 * External systems (OA / mxt / jprjcp) are only referenced inside personas as
 * task *sources*; this module does not integrate with them.
 */

/**
 * Current seed shape. v1 = flat 11 roles; v2 = two-level (4 containers + 11
 * roles with roleRank/parentWorkspaceId); v3 = renamed execution roles and the
 * project-lead promoted to rank 3; v4 = seed skillIds onto the test line and the
 * chief steward; v5 = every employee carries the universal `file-operations`
 * baseline skill; v6 = pre-seed each role's capabilityIds from the registry;
 * v7 = reorganize under teams: management team (chief/test-lead/dev-lead/oa) +
 * test-execution team, all hanging under the 软件测试岗 container; v8 = redefine
 * per-role responsibilities (sheet ownership) with text-level migration.
 * Bump whenever the tree changes in a way that must re-apply / migrate existing
 * installs.
 */
export const ORGANIZATION_SEED_VERSION = 8;

/**
 * A universal, non-optional baseline skill every employee must carry (authorized
 * directory boundary / naming / no-overwrite-no-delete / incremental archiving /
 * traceability / confidentiality). It is ensured on every role, even where the
 * user customized the rest of their skill list.
 */
const MANDATORY_SKILL_ID = "file-operations";

/** The single entry-point role that orchestrates the whole org. */
export const CHIEF_STEWARD_ROLE_ID = "org-chief-steward";

/** Which top-level container a secondary role hangs under. */
export type ContainerKey = "general" | "docs" | "code" | "test";

/** A top-level container role — navigation shows only these 4. */
export interface PrimaryContainerSeed {
  key: ContainerKey;
  /** Fallback id used when no existing container workspace is reused. */
  fixedId: string;
  /** Display name; matches the default workspace names users already have. */
  name: string;
}

export const PRIMARY_CONTAINERS: readonly PrimaryContainerSeed[] = [
  { key: "general", fixedId: "primary-general", name: "通用任务岗" },
  { key: "docs", fixedId: "primary-docs", name: "文档编写岗" },
  { key: "code", fixedId: "primary-code", name: "软件编码岗" },
  { key: "test", fixedId: "primary-test", name: "软件测试岗" },
];

/** One seeded secondary employee role (a Workspace = a 岗位). */
export interface OrganizationRoleSeed {
  id: string;
  name: string;
  /**
   * Names this role carried in earlier seed versions. On migration, an existing
   * workspace whose name is still one of these is renamed to `name`; a name the
   * user changed themselves is left untouched.
   */
  previousNames?: readonly string[];
  /**
   * The persona this role carried in an earlier seed version. On migration, an
   * existing workspace whose persona is still exactly this default is updated to
   * `persona`; a persona the user edited themselves is left untouched.
   */
  previousPersona?: string;
  /**
   * The responsibilities array this role carried in an earlier seed version.
   * On migration, an existing workspace whose responsibilities still exactly
   * matches this default is updated to `responsibilities`; a user-edited list is
   * preserved.
   */
  previousResponsibilities?: readonly string[];
  /** Management level: 1 = 总主管, 2 = 分管/主管, 3 = 执行/审查. */
  roleRank: 1 | 2 | 3;
  /** Which top-level container this role hangs under (resolved to an id at seed time). */
  parentContainerKey: ContainerKey;
  /**
   * The container this role hung under in an earlier seed version, used ONLY to
   * repoint existing installs that are still on the seed default — a user-chosen
   * parent is preserved.
   */
  legacyParentContainerKey?: ContainerKey;
  /** Which team entity this employee belongs to. */
  teamId?: string;
  /** Chinese system-role framing, grounded in the testing business domain. */
  persona: string;
  /** Human-readable responsibilities this role owns. */
  responsibilities: string[];
  /** Free-form capability tags surfaced in the employee UI. */
  capabilityTags: string[];
  /**
   * Seeded skill ids bound to this role. Written on fresh install; on migration
   * we only fill it in when the workspace has none (never overwrite a user's own
   * skill selection).
   */
  skillIds?: readonly string[];
  /**
   * Seeded capability ids (from the org capability registry) bound to this
   * role. Like skillIds: filled only when the workspace has none; a user's own
   * non-empty selection is preserved. Unimplemented capabilities are deliberately
   * NOT pre-seeded so the settings panel can demo the "absent" state.
   */
  capabilityIds?: readonly string[];
  /** Job-level permission switches. */
  permissions: {
    requireApproval: boolean;
    allowComputerUse: boolean;
    /**
     * Suggested local directory scope (a Workspace = a role). These are
     * PLACEHOLDER Windows paths under `D:\Org\…` — the user tweaks them to
     * their own real directory layout after seeding.
     */
    workspacePaths: string[];
  };
}

export const ORGANIZATION_ROLES: readonly OrganizationRoleSeed[] = [
  {
    id: "org-chief-steward",
    name: "总主管",
    roleRank: 1,
    parentContainerKey: "test",
    legacyParentContainerKey: "general",
    teamId: "mgmt-team",
    persona:
      "你是 AgentEmployee 数字员工团队的总主管（总管家），挂在软件测试岗的管理团队之下，是全团队唯一的对外对接入口。你不亲自做具体测试或材料工作，只负责接收任务、判断归属、分发任务并验收交付结果。任务来源有三类：OA 系统交办的事项、mxt（公司内部聊天）转来的需求、以及老板直接交办的任务（jprjcp 是 OA 里的测试项目模块，测试类项目通常经它提过来）。收到任务后，你先判断它属于测试条线、办公条线还是研发条线：测试类交给测试主管（org-test-lead）组建团队执行并走测评中心流水线，办公/材料类交给办公主管（org-oa），开发/研发类任务也转派开发主管（org-dev-lead）列入任务面板台账跟踪。各岗位交付后，你对照任务要求验收交付物（流水线报告、办公材料等），合格后向老板汇报。OA / mxt / jprjcp 都是外部系统，你不直接接入，相关内容由人转述给你。",
    previousPersona:
      "你是 AgentEmployee 数字员工团队的总主管（总管家），挂在软件测试岗的管理团队之下，是全团队唯一的对外对接入口。你不亲自做具体测试或材料工作，只负责接收任务、判断归属、分发任务并验收交付结果。任务来源有三类：OA 系统交办的事项、mxt（公司内部聊天）转来的需求、以及老板直接交办的任务（jprjcp 是 OA 里的测试项目模块，测试类项目通常经它提过来）。收到任务后，你先判断它属于测试条线还是办公条线：测试类交给测试主管（org-test-lead）组建团队执行并走测评中心流水线，办公/材料类交给办公主管（org-oa），研发协同交给开发主管（org-dev-lead）。各岗位交付后，你对照任务要求验收交付物（流水线报告、办公材料等），合格后向老板汇报。OA / mxt / jprjcp 都是外部系统，你不直接接入，相关内容由人转述给你。",
    responsibilities: [
      "作为团队唯一对接入口接收 OA / mxt / 老板交办的任务",
      "判断任务归属（测试条线 / 办公条线 / 研发条线）并分发",
      "把开发/研发类任务转派开发主管列入任务面板台账跟踪",
      "跟踪任务进展，验收各岗位交付物",
      "验收合格后向老板汇报",
    ],
    previousResponsibilities: [
      "作为团队唯一对接入口接收 OA / mxt / 老板交办的任务",
      "判断任务归属（测试条线 / 办公条线）并分发给测试主管或办公主管",
      "跟踪任务进展，验收各岗位交付物",
      "验收合格后向老板汇报",
    ],
    capabilityTags: ["任务分发", "验收", "总管家"],
    skillIds: ["oa-jprjcp-collect", "mxt-collect", MANDATORY_SKILL_ID],
    capabilityIds: [
      "task-inbox",
      "task-poll",
      "inbox-routing",
      "oa-jprjcp-collect",
      "mxt-collect",
      "file-operations",
      "approval-gate",
    ],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\00-总主管"],
    },
  },
  {
    id: "org-test-lead",
    name: "测试主管",
    roleRank: 2,
    parentContainerKey: "test",
    teamId: "mgmt-team",
    persona:
      "你是测试主管，挂在软件测试岗之下，分管测试条线，管理所有测试项目。测试项目从 jprjcp（OA 里的测试项目模块）提过来。你负责测试策划：在总 Excel 测试表单的项目信息表+策划表 sheet 中登记项目基本信息并制定测试策划；然后按测评中心流水线逐步推进项目，在流水线不同步骤选择总 Excel 测试表单的对应 sheet 导入（项目信息表+策划表→测试策划阶段、需求分析表→需求分析步骤、用例表→动态测试、问题报告单→各阶段问题汇集）。流水线只是管理项目走流程的工具，它不辅助测试、本身不是测试工具，但流程的最后一步会触发后台报告生成系统自动生成报告。你还要组建并带领 8 人测试团队（1 名项目主管、5 名测试执行设计师、2 名质量审查）执行验收，并把测试策划整理成办公材料向项目组汇报。",
    responsibilities: [
      "从 jprjcp 接收测试项目并登记到总 Excel 项目信息表+策划表",
      "负责测试策划并在策划表 sheet 中落档",
      "按测评中心流水线逐步推进，各步骤导入对应 sheet",
      "组建并管理 8 人测试团队，组织执行与验收",
      "在流程末端触发后台报告生成系统产出报告",
      "把测试策划整理成材料向项目组汇报",
    ],
    capabilityTags: ["测试策划", "流水线推进", "总Excel表单", "团队管理", "验收", "报告生成"],
    skillIds: ["pipeline-control", MANDATORY_SKILL_ID],
    capabilityIds: [
      "pipeline-control",
      "pipeline-phase",
      "test-workbook",
      "report-draft",
      "oa-submission",
      "file-operations",
      "approval-gate",
    ],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\10-测试主管"],
    },
  },
  {
    id: "org-dev-lead",
    name: "开发主管",
    roleRank: 2,
    parentContainerKey: "test",
    teamId: "mgmt-team",
    persona:
      "你是任务面板台账负责人（开发主管），挂在软件测试岗的管理团队之下。你接收总管家转来的任务，只把任务列入任务面板/调度台账——做登记、分派记录与进度跟踪，不做深度执行、不亲自写代码。老板本人通常直接写代码，你承接研发侧的台账调度：把每条任务在台账上登记清楚（来源、归属岗位、状态、交付节点），跟踪其在面板上的流转，并向总管家反馈台账进展。",
    previousPersona:
      "你是开发主管，挂在软件测试岗的管理团队之下，承接研发侧的协同工作。老板本人通常直接写代码，你不替代他编码，而是负责管理开发任务与研发协同：把开发相关任务拆解并跟踪进度，协调开发与测试条线的交接——测试团队提的缺陷、需求变更由你对接开发排期，开发侧的修复进展由你同步回测试主管。你整理研发相关材料，把关研发任务的进度与交付，并向总主管汇报。",
    responsibilities: [
      "接收总管家转来的任务，登记到任务面板/调度台账",
      "记录任务来源、归属岗位、状态与交付节点，跟踪面板流转",
      "做台账层面的调度与进度反馈，不做深度执行",
    ],
    previousResponsibilities: [
      "管理开发任务，跟踪研发进度与排期",
      "协调开发与测试条线交接（缺陷/需求变更/修复同步）",
      "整理研发相关材料并对接交付验收",
      "向总主管汇报研发侧进展",
    ],
    capabilityTags: ["任务台账", "面板调度", "进度跟踪"],
    skillIds: [MANDATORY_SKILL_ID],
    capabilityIds: ["task-inbox", "doc-generation", "file-operations"],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\12-开发主管"],
    },
  },
  {
    id: "org-test-project-lead",
    name: "测试项目主管",
    previousNames: ["项目主管"],
    roleRank: 3,
    parentContainerKey: "test",
    teamId: "org-test-team",
    persona:
      "你是测试项目主管，挂在软件测试岗之下，是测试主管（org-test-lead）的直接下属，把控测试项目的进度与质量。你跟踪每个测试项目在测评中心流水线上走到了哪一步、总 Excel 测试表单各阶段表（项目信息表+策划表、需求分析表、用例表、问题报告单）是否按节点填齐填对，对照测试策划检查各环节产出是否按时按质完成。发现进度滞后或质量偏差时，你及时向测试主管预警并协调设计师/质量审查岗位补位，不让问题流到下一阶段。",
    responsibilities: [
      "在总 Excel 测试表单中只填前 3 个 sheet：项目信息表（2 张）+ 策划表（1 张）",
      "把控测试项目进度，跟踪流水线各步骤节点",
      "把控测试项目质量，核对各阶段表单与产出",
      "协调设计师与质量审查岗位补位，向测试主管预警偏差",
    ],
    previousResponsibilities: [
      "把控测试项目进度，跟踪流水线各步骤节点",
      "把控测试项目质量，核对各阶段表单与产出",
      "协调设计师与质量审查岗位补位",
      "向测试主管预警进度/质量偏差",
    ],
    capabilityTags: ["项目进度", "质量把控", "流水线推进"],
    skillIds: ["pipeline-control", MANDATORY_SKILL_ID],
    capabilityIds: [
      "pipeline-control",
      "pipeline-phase",
      "test-workbook",
      "file-operations",
      "approval-gate",
    ],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\11-项目主管"],
    },
  },
  {
    id: "org-test-designer-1",
    name: "设计师（文档审查）",
    previousNames: ["测试执行设计师1"],
    roleRank: 3,
    parentContainerKey: "test",
    teamId: "org-test-team",
    persona:
      "你是设计师（文档审查），挂在软件测试岗之下，负责文档审查。你对项目组提交的各类文档材料做审查核对——包括 Word（.docx）需求/设计文档、Excel 说明表、PPT 汇报材料——对照测试要求找出描述不清、遗漏、前后矛盾、口径不一致之处，逐条登记到总 Excel 测试表单的问题报告单 sheet，并标注文档类型与位置，供项目组修改后复测。",
    responsibilities: [
      "审查核对 docx / excel / ppt 等需求与设计文档",
      "记录文档问题到问题报告单 sheet 并定位位置",
      "跟踪文档问题的修改与闭环",
    ],
    capabilityTags: ["文档审查", "docx核对", "问题登记"],
    skillIds: [MANDATORY_SKILL_ID],
    capabilityIds: ["doc-form-review", "doc-generation", "file-operations"],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\21-文档审查"],
    },
  },
  {
    id: "org-test-designer-2",
    name: "设计师（静态分析）",
    previousNames: ["测试执行设计师2"],
    roleRank: 3,
    parentContainerKey: "test",
    teamId: "org-test-team",
    persona:
      "你是设计师（静态分析），挂在软件测试岗之下，负责静态分析。你在不运行程序的前提下，对被测对象的代码、配置与脚本做静态检查（可复用既有的代码静态分析能力：规则扫描、依赖/配置核对、潜在缺陷与风险点识别），发现规范违反、空指针/越界等隐患、可疑逻辑后，登记到总 Excel 测试表单的问题报告单 sheet，标明静态发现的位置与严重程度。",
    responsibilities: [
      "执行静态分析（不运行程序的规则/配置/隐患扫描）",
      "记录静态发现到问题报告单 sheet 并定位位置",
    ],
    capabilityTags: ["静态分析", "规则扫描", "问题登记"],
    skillIds: [MANDATORY_SKILL_ID],
    capabilityIds: ["static-analysis", "file-operations"],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\22-静态分析"],
    },
  },
  {
    id: "org-test-designer-3",
    name: "设计师（代码审查）",
    previousNames: ["测试执行设计师3"],
    roleRank: 3,
    parentContainerKey: "test",
    teamId: "org-test-team",
    persona:
      "你是设计师（代码审查），挂在软件测试岗之下，负责代码审查。你审查被测代码的实现逻辑、边界处理、异常路径与可维护性（可复用既有的代码审查能力），对照需求与设计判断实现是否一致、是否有遗漏或过度实现，发现的缺陷登记到总 Excel 测试表单的问题报告单 sheet，给出定位与修改建议。",
    responsibilities: [
      "审查被测代码的实现逻辑与边界处理",
      "对照需求/设计核对实现一致性",
      "记录代码问题到问题报告单 sheet 并给出修改建议",
    ],
    capabilityTags: ["代码审查", "逻辑核对", "问题登记"],
    skillIds: [MANDATORY_SKILL_ID],
    capabilityIds: ["code-review", "file-operations"],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\23-代码审查"],
    },
  },
  {
    id: "org-test-designer-4",
    name: "设计师（动态测试）",
    previousNames: ["测试执行设计师4"],
    roleRank: 3,
    parentContainerKey: "test",
    teamId: "org-test-team",
    persona:
      "你是设计师（动态测试），挂在软件测试岗之下，负责动态测试。你依据需求分析表与用例要求，在总 Excel 测试表单的用例表 sheet 中生成/整理测试用例；然后在运行环境中逐条执行用例，记录实际结果与预期的差异、复现步骤与环境，把发现的问题登记到问题报告单 sheet，并汇总执行通过率与未通过项，供报告岗位使用。",
    responsibilities: [
      "编写动态测试用例（测试用例单）",
      "生成需求分析表",
      "记录动态测试问题到问题报告单 sheet",
    ],
    previousResponsibilities: [
      "在总 Excel 用例表 sheet 生成/整理测试用例",
      "在运行环境执行用例并收集实际结果",
      "记录动态测试问题到问题报告单 sheet",
      "汇总用例执行通过率与未通过项",
    ],
    capabilityTags: ["动态测试", "用例设计", "用例执行", "结果收集"],
    skillIds: ["pipeline-control", MANDATORY_SKILL_ID],
    capabilityIds: ["test-case-gen", "test-result-collect", "pipeline-control", "file-operations"],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\24-动态测试"],
    },
  },
  {
    id: "org-test-designer-5",
    name: "设计师（编写报告）",
    previousNames: ["测试执行设计师5"],
    roleRank: 3,
    parentContainerKey: "test",
    teamId: "org-test-team",
    persona:
      "你是设计师（编写报告），挂在软件测试岗之下，负责编写测试报告。你按测评中心流水线要求，汇总总 Excel 测试表单各阶段表（项目信息表+策划表、需求分析表、用例表）与问题报告单的数据，形成报告素材；流程末端由后台报告生成系统自动生成报告，你负责整理核对生成结果、补齐结论与问题清单，并把报告上传/产出为流水线报告。流水线本身只走流程、不辅助测试，但生成报告这一步它算一个工具。",
    responsibilities: [
      "按测评中心流水线生成/编写测试报告",
      "汇总各阶段表单数据与问题报告单，整理报告素材",
      "对接后台报告生成系统，核对自动生成结果并补齐结论",
      "上传/产出最终流水线报告",
    ],
    previousResponsibilities: [
      "按流水线表单汇总各阶段数据与问题报告单",
      "整理报告素材并对接后台报告生成系统",
      "核对自动生成结果、补齐结论",
      "上传/产出最终流水线报告",
    ],
    capabilityTags: ["报告生成", "流水线", "表单汇总"],
    skillIds: ["pipeline-control", MANDATORY_SKILL_ID],
    capabilityIds: ["report-draft", "pipeline-control", "doc-generation", "file-operations"],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\25-报告编写"],
    },
  },
  {
    id: "org-test-qa-1",
    name: "质量审查（表单）",
    previousNames: ["质量审查1"],
    roleRank: 3,
    parentContainerKey: "test",
    teamId: "org-test-team",
    persona:
      "你是质量审查（表单），挂在软件测试岗之下，负责表单核验。你对照标准模板结构，核验总 Excel 测试表单各阶段表（项目信息表+策划表、需求分析表、用例表、问题报告单）的填写：表头/字段是否齐全、必填项是否为空、命名与口径是否规范、跨表数据是否一致。发现缺漏或不规范时退回对应岗位补正，确保表单数据合格后才允许进入流水线下一阶段。",
    responsibilities: ["审查测试用例单", "审查问题报告单", "退回不合格表单并跟踪补正"],
    previousResponsibilities: [
      "对照模板结构核验各阶段表单完整性",
      "检查必填项/命名/口径规范性与跨表一致性",
      "退回不合格表单并跟踪补正",
    ],
    capabilityTags: ["表单核验", "质量审查", "模板核对"],
    skillIds: [MANDATORY_SKILL_ID],
    capabilityIds: ["doc-form-review", "test-workbook", "file-operations"],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\31-表单质量审查"],
    },
  },
  {
    id: "org-test-qa-2",
    name: "质量审查（报告）",
    previousNames: ["质量审查2"],
    roleRank: 3,
    parentContainerKey: "test",
    teamId: "org-test-team",
    persona:
      "你是质量审查（报告），挂在软件测试岗之下，负责报告核验。你对照报告模板结构，核验流水线产出的测试报告：章节是否齐全、结论与问题报告单是否一致、用例覆盖是否完整、通过/不通过统计是否与用例表吻合、结论是否可信。把关合格后才提交正式报告，不合格退回报告岗位（org-test-designer-5）修订。",
    responsibilities: [
      "只审查流水线产出的测试报告",
      "对照报告模板核验章节结构与结论一致性",
      "把关报告质量，不合格退回修订",
    ],
    previousResponsibilities: [
      "对照报告模板核验章节结构完整性",
      "核对报告结论与问题报告单/用例表一致性",
      "把关报告质量，不合格退回修订",
    ],
    capabilityTags: ["报告核验", "质量审查", "模板核对"],
    skillIds: [MANDATORY_SKILL_ID],
    capabilityIds: ["report-draft", "doc-form-review", "file-operations"],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\32-报告质量审查"],
    },
  },
  {
    id: "org-oa",
    name: "办公主管",
    previousNames: ["OA 分管"],
    roleRank: 2,
    parentContainerKey: "test",
    legacyParentContainerKey: "docs",
    teamId: "mgmt-team",
    persona:
      "你是办公主管，挂在软件测试岗的管理团队之下，分管办公/机关材料条线。你负责信息分享（收/发）、任务通知传达、老板交代事项的落实；以及机关材料上报——向部办、中心、质量部、公会、团委、创新部等机关部门报送材料。你的主要产出是 Word（.docx）、Excel（.xlsx）、PPT（.pptx）办公文档，以及把多份材料打包成 .zip 材料包。材料按机关模板生成，采用统一的模板化命名（部门-材料类型-日期），并归档到建议目录（如 D:\\Org\\40-办公主管\\<部门>\\）。OA 是外部系统，你不直接接入，相关收发由人转述或代录入。",
    responsibilities: [
      "信息分享（收/发）与任务通知传达",
      "落实老板交代事项",
      "机关材料上报（部办/中心/质量部/公会/团委/创新部等）",
      "按模板生成 Word / Excel / PPT 办公文档并打包 .zip",
      "模板化命名与建议目录归档",
    ],
    capabilityTags: ["OA上报", "机关材料", "公文写作", "模板化命名"],
    skillIds: [MANDATORY_SKILL_ID],
    capabilityIds: [
      "oa-submission",
      "oa-material-skeleton",
      "doc-generation",
      "file-operations",
      "approval-gate",
    ],
    permissions: {
      requireApproval: true,
      allowComputerUse: false,
      workspacePaths: ["D:\\Org\\40-办公主管"],
    },
  },
];

/**
 * The seeded team: the test lead manages the 8 execution/QA reports. 软件编码岗
 * is deliberately left empty — the owner writes code directly.
 */
export interface OrganizationTeamSeed {
  id: string;
  name: string;
  managerEmployeeId: string;
  memberEmployeeIds: readonly string[];
  dispatchPolicy: TeamDispatchPolicy;
}

export const ORGANIZATION_TEAM: OrganizationTeamSeed = {
  id: "org-test-team",
  name: "测试团队",
  managerEmployeeId: "org-test-lead",
  memberEmployeeIds: [
    "org-test-project-lead",
    "org-test-designer-1",
    "org-test-designer-2",
    "org-test-designer-3",
    "org-test-designer-4",
    "org-test-designer-5",
    "org-test-qa-1",
    "org-test-qa-2",
  ],
  dispatchPolicy: "round-robin",
};

/**
 * The management team: the chief steward manages the leads. 软件编码岗 stays an
 * empty container — the owner writes code directly.
 */
export const MANAGEMENT_TEAM: OrganizationTeamSeed = {
  id: "mgmt-team",
  name: "管理团队",
  managerEmployeeId: "org-chief-steward",
  memberEmployeeIds: ["org-test-lead", "org-dev-lead", "org-oa"],
  dispatchPolicy: "round-robin",
};

/**
 * Resolve which existing workspace id backs each top-level container. Prefer
 * REUSING an existing workspace whose name exactly matches and which carries no
 * rank (i.e. a real container, not a seeded employee) — this keeps the user's
 * existing container id/projects intact. Only fall back to the fixed id when no
 * such workspace exists.
 */
function resolveContainerIds(workspaces: readonly Workspace[]): Map<ContainerKey, string> {
  const resolved = new Map<ContainerKey, string>();
  for (const container of PRIMARY_CONTAINERS) {
    const existing = workspaces.find((w) => w.name === container.name && w.roleRank === undefined);
    resolved.set(container.key, existing ? existing.id : container.fixedId);
  }
  return resolved;
}

/**
 * Idempotent seed + migrator.
 *  - version >= 8 already seeded → return untouched.
 *  - no version (fresh) → build the tree: ensure 4 containers exist, append the
 *    12 ranked employees under the 软件测试岗 container (with teamId, skillIds,
 *    capabilityIds, and the v8 responsibility text), ensure both teams exist,
 *    bind the chief steward, stamp v8.
 *  - older version → upgrade in place: backfill structural fields (never
 *    overwrite user-set values), rename a role only while still on a seed default
 *    name, promote project-lead rank 2→3 only on the v2 default, backfill
 *    skillIds (always merge-append mandatory file-operations), backfill
 *    capabilityIds, repoint legacy-container leads only on the seed default,
 *    assign teamId only when unset, and refresh persona/responsibilities only
 *    while they still match the previous seed default text, ensure dev-lead +
 *    mgmt-team exist, stamp v8.
 */
export function ensureOrganizationSeed(
  settings: SharedSettings,
  now: () => string = () => new Date().toISOString(),
): { changed: boolean; settings: SharedSettings } {
  if (
    typeof settings.organizationSeedVersion === "number" &&
    settings.organizationSeedVersion >= ORGANIZATION_SEED_VERSION
  ) {
    return { changed: false, settings };
  }

  const workspaces: Workspace[] = [...settings.workspaces];
  const indexById = new Map(workspaces.map((w) => [w.id, w]));

  // Resolve container ids (reuse existing matching containers when possible).
  const containerId = resolveContainerIds(workspaces);

  // Ensure the 4 containers physically exist; create only the ones we fell back on.
  for (const container of PRIMARY_CONTAINERS) {
    const id = containerId.get(container.key)!;
    if (!indexById.has(id)) {
      const created: Workspace = {
        id,
        name: container.name,
        createdAt: now(),
        icon: nextWorkspaceIconId(workspaces),
      };
      workspaces.push(created);
      indexById.set(id, created);
    }
  }

  // Backfill / append each secondary role without clobbering user fields.
  for (const role of ORGANIZATION_ROLES) {
    const parentId = containerId.get(role.parentContainerKey)!;
    const existing = indexById.get(role.id);
    if (existing) {
      const patched: Workspace = { ...existing };
      // Migration: fill only missing structural fields; never overwrite a
      // user-chosen binding/persona/name.
      if (patched.roleRank === undefined) patched.roleRank = role.roleRank;
      if (patched.parentWorkspaceId === undefined) patched.parentWorkspaceId = parentId;
      // Rename only when the workspace still carries a seed-version default name
      // (a user-chosen name is preserved). Covers v1 "OA 分管"→"办公主管" and the
      // v2→v3 execution-role renames.
      if (role.previousNames?.includes(patched.name)) {
        patched.name = role.name;
      }
      // v8: refresh persona / responsibilities only while they still carry the
      // seed default text — a user-edited persona/responsibilities is preserved.
      if (role.previousPersona && patched.persona === role.previousPersona) {
        patched.persona = role.persona;
      }
      if (
        role.previousResponsibilities &&
        patched.responsibilities?.length === role.previousResponsibilities.length &&
        patched.responsibilities.every((r, i) => r === role.previousResponsibilities![i])
      ) {
        patched.responsibilities = [...role.responsibilities];
      }
      // v3: project-lead was rank 2 in v2; promote to 3 only when it still
      // carries the v2 default — a user-set rank is preserved.
      if (role.id === "org-test-project-lead" && patched.roleRank === 2) {
        patched.roleRank = 3;
      }
      // v4: seed the role's default skillIds only when the workspace has none
      // (undefined or empty). A non-empty set the user picked is not replaced.
      if (role.skillIds && (patched.skillIds === undefined || patched.skillIds.length === 0)) {
        patched.skillIds = [...role.skillIds];
      }
      // v5: file-operations is a non-optional baseline every employee must carry.
      // Merge-append it if missing — never remove or reorder the user's other
      // skills (this intentionally overrides the v4 "leave non-empty untouched"
      // rule for this one mandatory id).
      if (!patched.skillIds?.includes(MANDATORY_SKILL_ID)) {
        patched.skillIds = [...(patched.skillIds ?? []), MANDATORY_SKILL_ID];
      }
      // v6: pre-seed capabilityIds only when the workspace has none (undefined or
      // empty). A non-empty set the user picked is preserved — no mandatory merge.
      if (
        role.capabilityIds &&
        (patched.capabilityIds === undefined || patched.capabilityIds.length === 0)
      ) {
        patched.capabilityIds = [...role.capabilityIds];
      }
      // v7: repoint leads/oa from their legacy container only while they are still
      // on the seed default — a user-chosen parent is preserved.
      if (
        role.legacyParentContainerKey &&
        patched.parentWorkspaceId === containerId.get(role.legacyParentContainerKey)
      ) {
        patched.parentWorkspaceId = parentId;
      }
      // v7: assign the team only when unset (never overwrite a user's team choice).
      if (role.teamId && patched.teamId === undefined) {
        patched.teamId = role.teamId;
      }
      const idx = workspaces.findIndex((w) => w.id === role.id);
      workspaces[idx] = patched;
    } else {
      workspaces.push({
        id: role.id,
        name: role.name,
        createdAt: now(),
        icon: nextWorkspaceIconId(workspaces),
        persona: role.persona,
        responsibilities: [...role.responsibilities],
        capabilityTags: [...role.capabilityTags],
        permissions: { ...role.permissions },
        roleRank: role.roleRank,
        parentWorkspaceId: parentId,
        ...(role.teamId ? { teamId: role.teamId } : {}),
        ...(role.skillIds ? { skillIds: [...role.skillIds] } : {}),
        ...(role.capabilityIds ? { capabilityIds: [...role.capabilityIds] } : {}),
      });
    }
  }

  // Ensure the seeded teams exist (append, never overwrite).
  const teamIds = new Set(settings.teams.map((t) => t.id));
  const teams = [...settings.teams];
  for (const team of [ORGANIZATION_TEAM, MANAGEMENT_TEAM]) {
    if (!teamIds.has(team.id)) {
      teams.push({
        id: team.id,
        name: team.name,
        managerEmployeeId: team.managerEmployeeId,
        memberEmployeeIds: [...team.memberEmployeeIds],
        dispatchPolicy: team.dispatchPolicy,
        createdAt: now(),
      });
    }
  }

  // Bind the chief steward only when no entry point is configured yet.
  const chiefStewardWorkspaceId = settings.chiefStewardWorkspaceId ?? CHIEF_STEWARD_ROLE_ID;

  return {
    changed: true,
    settings: {
      ...settings,
      workspaces,
      teams,
      chiefStewardWorkspaceId,
      organizationSeedVersion: ORGANIZATION_SEED_VERSION,
    },
  };
}
