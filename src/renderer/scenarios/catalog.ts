import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bug,
  ClipboardCheck,
  ClipboardList,
  Code2,
  Compass,
  Eye,
  FileSearch,
  FileText,
  FlaskConical,
  GitCompare,
  ListChecks,
  MonitorPlay,
  Package,
  Presentation,
  Recycle,
  ShieldCheck,
  Table2,
  Wrench,
} from "lucide-react";
import {
  SCENARIO_CATEGORIES,
  type ScenarioCategory,
  type ScenarioDefinition,
} from "@/shared/contracts";

/** How a scenario input is provided. */
export type ScenarioInputKind = "files" | "code";

/** One input a scenario collects before its draft can be sent. */
export interface ScenarioInputRequirement {
  id: string;
  label: MessageDescriptor;
  /** Short guidance shown under the label (what to provide, what to leave out). */
  hint?: MessageDescriptor;
  /** `files` (default): attachments. `code`: a directory inside the project. */
  kind?: ScenarioInputKind;
  /** Minimum number of attached files that satisfies this input (files kind). */
  minFiles: number;
  /** When true, the draft cannot be sent until this input is satisfied. */
  required: boolean;
}

/** A document template a scenario fills and live-previews. */
export interface ScenarioDocumentTemplate {
  /** Template id resolved through `project → global → built-in`. */
  templateId: string;
  /** Output path used before/if template resolution fails. */
  defaultResultFile: string;
}

/**
 * One way a scenario can produce its output, offered as a picker in the draft.
 * Declared by the scenario so shared UI stays generic: it renders whatever modes
 * the scenario lists and injects the active one's {@link agentInstruction}.
 */
export interface ScenarioOutputMode {
  id: string;
  /** Button label. */
  label: MessageDescriptor;
  /** One line under the picker: when to choose this mode. */
  hint?: MessageDescriptor;
  /** Instruction appended to the prompt when this mode is active. */
  agentInstruction: MessageDescriptor;
  /**
   * Pick this mode automatically when a `code` reference input is chosen; the
   * other mode is picked when none is. Lets the draft suggest the sensible mode
   * without the user choosing first.
   */
  recommendedWhenReferenceSelected: boolean;
}

/**
 * Display sub-group within a scenario's category. The `docs` ("Document
 * writing") list splits into the requirements document, design document, and
 * change document workstreams; the `code` ("Software coding") list splits into
 * code generation, code maintenance, and unit testing. Categories that leave it
 * unset (today only `test`) render as one flat list.
 */
export const SCENARIO_SUBGROUPS = [
  "requirements",
  "design",
  "change",
  "code-generation",
  "code-maintenance",
  "unit-test",
] as const;
export type ScenarioSubgroup = (typeof SCENARIO_SUBGROUPS)[number];

/**
 * A scenario as the UI sees it: the provider-agnostic {@link ScenarioDefinition}
 * plus localized copy. Lives in the renderer (not `src/shared`) because Lingui
 * only scans `src/renderer` — the strings here are what get extracted. The
 * shared side keeps only the id/category shape the workspace schema validates
 * against.
 */
export interface ScenarioView extends ScenarioDefinition {
  title: MessageDescriptor;
  description: MessageDescriptor;
  /**
   * Card mark, drawn in the scenario's category accent. Every scenario carries
   * one so a card grid reads at a glance instead of as a wall of text.
   */
  icon: LucideIcon;
  /**
   * Prefilled into the draft composer when the user starts this scenario,
   * together with {@link steps}. Omitted for scenarios that deliberately open
   * an empty composer: the user writes the message themselves, and all guidance
   * lives in the guide card and inputs panel (see `applyScenario`). Steps are
   * only seeded alongside this prompt, so an omitted prompt seeds nothing.
   */
  prompt?: MessageDescriptor;
  /**
   * Optional display sub-group within the scenario's category; see
   * {@link ScenarioSubgroup}. Scenarios without one render as a flat list.
   */
  subgroup?: ScenarioSubgroup;
  /**
   * Usage steps for this scenario, shown in order on the draft's guide card
   * and appended to the prefilled prompt so the agent follows the same method.
   */
  steps: readonly MessageDescriptor[];
  /**
   * Bundled skill the scenario binds as the leading `/skill` segment, so the
   * agent loads the scenario's method instead of only reading the prompt.
   */
  leadingSkillId?: string;
  /** Inputs the draft requires before it can be sent, shown on the guide card. */
  requiredInputs?: readonly ScenarioInputRequirement[];
  /**
   * One line shown to the user at the top of the draft's input boxes, stating
   * what each source is for. Also reused as a method step so the agent follows
   * the same division of labour.
   */
  inputsNote?: MessageDescriptor;
  /**
   * Document template the scenario fills; starting it resolves the template,
   * inlines it into the prompt, and opens the live preview panel on the output.
   */
  documentTemplate?: ScenarioDocumentTemplate;
  /**
   * Project-relative directory this scenario's generated files belong in. When
   * set, starting the scenario injects the conversation's resolved working
   * directory (its project root) plus this output dir into the prompt, so the
   * agent never has to guess where "the project root" is.
   */
  fileOutputDir?: string;
  /**
   * Output modes this scenario offers (e.g. "based on reference code" vs "from
   * scratch"). When set, the draft shows a mode picker and injects the active
   * mode's instruction into the prompt; the instruction is added at send time so
   * it reflects the user's choice, not the start-time seed.
   */
  outputModes?: readonly ScenarioOutputMode[];
}

/**
 * One sentence stating what each source input is for. Shown to the user at the
 * top of the draft's input boxes and reused as a method step, so the user and
 * the agent share the same division of labour.
 */
const REQUIREMENTS_SOURCES_NOTE = msg`Three sources, three jobs: the task brief tells me which requirements exist, the reference source code gives the concrete details (parameters, interface boundaries), and a similar document only gives the ordering and wording. Give whichever you have.`;
const DESIGN_SOURCES_NOTE = msg`Three sources, three jobs: the requirements specification tells me which design items exist, the reference source code gives the concrete details (architecture, modules, interfaces, parameters), and a similar design description only gives the ordering and wording. Give whichever you have.`;
const CHANGE_SOURCES_NOTE = msg`Three sources, three jobs: the pre-change code is the baseline, the current code is what changed, and any reference documents (joint test minutes, defect reports, change requests) explain the change intent. Comparing the two code versions gives the requirement, design, and code changes; the documents help confirm why.`;
const CODING_ISSUES_SOURCES_NOTE = msg`Two sources, two jobs: the issue workbook lists each problem to fix (one per row, with its code location), and the source directory is where that code lives. Fix only what the workbook lists.`;

/**
 * The bundled scenario catalog. Each entry is a *task entry point* — it does not
 * enable capabilities by itself; "start" only prefills a draft (see
 * `startScenario`), and the user reviews and sends. Kept small on purpose: every
 * title/description/prompt is translated into all locales.
 */
export const SCENARIOS: readonly ScenarioView[] = [
  {
    id: "write-requirements",
    category: "docs",
    subgroup: "requirements",
    icon: ClipboardList,
    title: msg`Write a requirements document`,
    description: msg`Produce a GJB 438C-2021 [5.10] software requirements specification as a Word (.docx) file, using the bundled GJB 438C SRS plugin. Builds a requirement-item outline first, then fills the fixed template after you confirm.`,
    prompt: msg`Using the GJB 438C software requirements specification skill (gjb438c-srs), produce a GJB 438C-2021 [5.10] software requirements specification from the material I provide. Work in two phases: first output the requirement-item outline for me to confirm, then fill the template. Only fill content — never change the template structure. Leave any unknown metric, interface boundary, or acceptance condition as a placeholder and ask me instead of inventing it. Write the finished .docx under docs/ in the project.`,
    steps: [
      msg`Attach the draft requirements, system requirements, task brief, or interface files.`,
      REQUIREMENTS_SOURCES_NOTE,
      msg`Confirm the requirement-item outline I produce.`,
      msg`Get the finished .docx under the project's docs/ folder and open it in Word to refresh the table of contents.`,
    ],
    leadingSkillId: "gjb438c-srs",
    relatedSkillIds: ["gjb438c-srs"],
    fileOutputDir: "docs",
    inputsNote: REQUIREMENTS_SOURCES_NOTE,
    requiredInputs: [
      {
        id: "material",
        label: msg`Reference material (development task brief, system requirements, task book)`,
        hint: msg`Required. The task brief / draft requirements this specification is written from.`,
        minFiles: 1,
        required: true,
      },
      {
        id: "code",
        label: msg`Reference source code (optional)`,
        hint: msg`Optional. A directory inside this project. Keep hand-written source only — delete build outputs and generated files, and declare which directories are third-party or library code so no requirements are written for them.`,
        kind: "code",
        minFiles: 1,
        required: false,
      },
      {
        id: "similar",
        label: msg`Similar requirements of another model (optional)`,
        hint: msg`Optional. Another model's requirements, used only as a style and structure reference — never as a requirements source.`,
        minFiles: 1,
        required: false,
      },
    ],
  },
  {
    id: "write-design",
    category: "docs",
    subgroup: "design",
    icon: Compass,
    title: msg`Write a design document`,
    description: msg`Produce a GJB 438C-2021 [5.11] software design description as a Word (.docx) file, using the bundled GJB 438C SDD plugin. Builds a design-item outline first, then fills the fixed template after you confirm.`,
    prompt: msg`Using the GJB 438C software design description skill (gjb438c-sdd), produce a GJB 438C-2021 [5.11] software design description from the requirements document, source code, and technical constraints I provide. Work in two phases: first output the design-item outline for me to confirm, then fill the template. Only fill content — never change the template structure. Leave any design decision, interface boundary, or exception case you cannot determine as a placeholder and ask me instead of inventing it. Write the finished .docx under docs/ in the project.`,
    steps: [
      msg`Attach the requirements document and the source code or interface files.`,
      DESIGN_SOURCES_NOTE,
      msg`Confirm the design-item outline I produce.`,
      msg`Get the finished .docx under the project's docs/ folder and open it in Word to refresh the table of contents.`,
    ],
    leadingSkillId: "gjb438c-sdd",
    relatedSkillIds: ["gjb438c-sdd"],
    fileOutputDir: "docs",
    inputsNote: DESIGN_SOURCES_NOTE,
    requiredInputs: [
      {
        id: "requirements",
        label: msg`Requirements specification`,
        hint: msg`Required. The software requirements specification this design description is derived from.`,
        minFiles: 1,
        required: true,
      },
      {
        id: "code",
        label: msg`Software source code (optional)`,
        hint: msg`Optional. A directory inside this project. Keep hand-written source only, and declare which directories are third-party or library code.`,
        kind: "code",
        minFiles: 1,
        required: false,
      },
      {
        id: "similar-design",
        label: msg`Similar design description of another model (optional)`,
        hint: msg`Optional. Used only as a structure and style reference for the design.`,
        minFiles: 1,
        required: false,
      },
    ],
  },
  {
    id: "write-impact-analysis",
    category: "docs",
    subgroup: "change",
    icon: GitCompare,
    title: msg`Write a change impact analysis report`,
    description: msg`Compare the pre-change and current source code, plus any reference documents like joint test minutes, and produce a change impact-domain analysis report as a Word (.docx) file, using the bundled impact analysis plugin. Classifies every change into exactly one section and merges related changes into one entry, confirms the outline first, then fills the fixed template.`,
    prompt: msg`Using the change impact-domain analysis skill (gjb438c-ida), produce an impact-domain analysis report from the pre-change and current source code (and any reference documents) I provide. Work in two steps: first output a change outline for me to confirm, then write the report content. In the outline, classify every change into exactly one of the requirement, design, or code change sections — never list the same change twice — and merge related changes that belong together into a single entry instead of splitting them. Only fill content — never change the template structure. Base every change entry on the actual difference between the two code versions and cite the file or function it comes from; leave any impact you cannot determine as a placeholder and ask me instead of inventing it. Write the finished .docx under docs/ in the project.`,
    steps: [
      msg`Point me at the pre-change and current code versions, and attach any reference documents you have (optional).`,
      CHANGE_SOURCES_NOTE,
      msg`Confirm the change outline (each change classified once, related changes merged) I produce.`,
      msg`Get the finished .docx under the project's docs/ folder and open it in Word to refresh the table of contents.`,
    ],
    leadingSkillId: "gjb438c-ida",
    relatedSkillIds: ["gjb438c-ida"],
    fileOutputDir: "docs",
    inputsNote: CHANGE_SOURCES_NOTE,
    requiredInputs: [
      {
        id: "previous-code",
        label: msg`Pre-change code (baseline)`,
        hint: msg`Required. A directory inside this project holding the baseline source before the change.`,
        kind: "code",
        minFiles: 1,
        required: true,
      },
      {
        id: "current-code",
        label: msg`Current code (after the change)`,
        hint: msg`Required. A directory inside this project holding the current source after the change.`,
        kind: "code",
        minFiles: 1,
        required: true,
      },
      {
        id: "reference-docs",
        label: msg`Reference documents (optional)`,
        hint: msg`Optional. Joint test minutes, defect reports, change requests, or other material that explains the change intent.`,
        minFiles: 1,
        required: false,
      },
    ],
  },
  {
    id: "scaffold-project",
    category: "code",
    subgroup: "code-generation",
    icon: Package,
    title: msg`Scaffold a project`,
    description: msg`Generate a runnable project skeleton — directories, core modules, and configuration — from the basis document. Choose a generation mode: modify a reference source directory in place, or create an empty src-new/ and start from scratch.`,
    prompt: msg`Using the basis document I attach (and the reference source directory if I choose one), scaffold a runnable project skeleton — directory layout, core modules, and configuration — for the project I describe. Work in two phases: first propose the directory layout and core modules for me to confirm, then create the files. Work in the output location the generation mode below specifies, and never write code anywhere else. Leave the implementation details for me to fill in.`,
    steps: [
      msg`Add the basis document (requirements specification or software design description), and optionally choose a similar product's source directory as a framework and partial-implementation reference.`,
      msg`If you build on the reference code, initialize git and commit the unmodified code before starting, so you can review the agent's changes in VS Code's Source Control.`,
      msg`Pick a generation mode: based on reference code (edit the reference source directory in place) or from scratch (create an empty src-new/).`,
      msg`Describe the project and its intended stack.`,
      msg`Confirm the proposed structure.`,
      msg`Get the result in the mode's output location — the reference directory edited in place, or a new src-new/ — and fill in the details.`,
    ],
    outputModes: [
      {
        id: "reuse",
        label: msg`Based on reference code`,
        hint: msg`Recommended when you provided a reference source directory: commit it to git first, then let the agent edit that code in place.`,
        agentInstruction: msg`Generation mode: based on reference code. Work directly in the reference source directory I selected — modify that code in place. Do not copy it to another directory and do not create a src-new/ folder. Adapt it to the basis document and the reference documents, editing it so it implements the requirements. Before editing, confirm that code is committed to git so the changes stay reviewable; if it is not, ask me to commit it first.`,
        recommendedWhenReferenceSelected: true,
      },
      {
        id: "scratch",
        label: msg`From scratch`,
        hint: msg`Recommended when you did not provide reference code: create an empty src-new/ and write the code from scratch.`,
        agentInstruction: msg`Generation mode: from scratch. Create an empty src-new/ directory in this project's root and write the code from scratch. If a reference source directory is provided, use it only as a framework and partial-implementation reference — never copy it verbatim.`,
        recommendedWhenReferenceSelected: false,
      },
    ],
    inputsNote: msg`Two sources, two jobs: the basis document says what the project must do, and a similar product's source directory is a framework and partial-implementation reference.`,
    requiredInputs: [
      {
        id: "basis",
        label: msg`Basis document (requirements specification or software design description)`,
        hint: msg`Required. The requirements specification or software design description this project is generated from.`,
        minFiles: 1,
        required: true,
      },
      {
        id: "reference-software",
        label: msg`Similar product's source directory (optional)`,
        hint: msg`Optional. A directory inside this project holding another product's source, used only as a framework and partial-implementation reference — never copied verbatim.`,
        kind: "code",
        minFiles: 1,
        required: false,
      },
    ],
  },
  {
    id: "modify-project-code",
    category: "code",
    subgroup: "code-generation",
    icon: Code2,
    title: msg`Modify project-level code`,
    description: msg`Implement a change across the project — a new feature or a behavior change — following the existing architecture and conventions. Proposes a change plan first, then edits the affected files.`,
    steps: [
      msg`Make sure the workspace project you pick is the root directory of this codebase; the scenario reads and edits files relative to that root.`,
      msg`Describe the change and the feature it belongs to.`,
      msg`Confirm the change plan (files, interfaces, order).`,
      msg`Review the diff and adopt the edits.`,
    ],
  },
  {
    id: "fix-coding-rule-issues",
    category: "code",
    subgroup: "code-maintenance",
    icon: Wrench,
    title: msg`Fix coding-rule issues`,
    description: msg`Read a .xlsx issue workbook, locate the sheet listing the problems, and fix the source one row at a time — each row is one issue with its code location — then write each row's status back to a copy of the workbook.`,
    prompt: msg`I have attached an issue workbook (.xlsx) and pointed you at the source directory. Using the xlsx-issues skill, first parse the workbook, list its sheets, and identify the sheet holding the issue list; report that sheet and the meaning of each column, then wait for my confirmation before changing any code. Each issue row carries a problem description and its code location. After I confirm, fix the issues row by row, keeping behavior unchanged, and state for each row the problem, the file and symbol you changed, the fix, and the rule or reason it satisfies. Ask me about any row whose location or intent is unclear instead of guessing. When done, write each row's status and a short note back to a copy of the workbook (never the original), then re-run the project's checks.`,
    steps: [
      msg`Attach the issue workbook (.xlsx) and choose the source directory inside this project.`,
      CODING_ISSUES_SOURCES_NOTE,
      msg`Confirm the issue sheet and its column meaning I report.`,
      msg`Review the row-by-row fixes and re-run the checks.`,
      msg`Open the fixed workbook copy under the project and check each row's status.`,
    ],
    leadingSkillId: "xlsx-issues",
    relatedSkillIds: ["xlsx-issues"],
    inputsNote: CODING_ISSUES_SOURCES_NOTE,
    requiredInputs: [
      {
        id: "issues",
        label: msg`Issue workbook (Excel .xlsx)`,
        hint: msg`Required. One sheet lists the issues, one per row, each with a problem description and its code location.`,
        minFiles: 1,
        required: true,
      },
      {
        id: "code",
        label: msg`Source code directory`,
        hint: msg`Required. A directory inside this project holding the hand-written source to fix; declare which subdirectories are third-party or library code.`,
        kind: "code",
        minFiles: 1,
        required: true,
      },
    ],
  },
  {
    id: "understand-project",
    category: "code",
    subgroup: "code-maintenance",
    icon: BookOpen,
    title: msg`Understand and describe the project`,
    description: msg`Explore an unfamiliar codebase and produce an architecture overview: modules, responsibilities, key flows, and entry points.`,
    prompt: msg`Explore this project and produce an architecture overview: the module layout, each module's responsibility, the key call flows, and the entry points. Call out anything important that is not obvious from the file names alone.`,
    steps: [
      msg`Point me at the project root or the area to understand.`,
      msg`Read the module and flow overview.`,
      msg`Ask follow-up questions about specific modules.`,
    ],
  },
  {
    id: "review-code",
    category: "code",
    subgroup: "code-maintenance",
    icon: Eye,
    title: msg`Review code quality`,
    description: msg`Review code for correctness, readability, maintainability, and style consistency with the surrounding code, reporting issues with suggested fixes.`,
    prompt: msg`Review the following code for correctness, readability, maintainability, and style consistency with the surrounding code. Output an issue list with location, type, severity, and a suggested fix. Do not decide on my behalf — leave the final call to me.`,
    steps: [
      msg`Point me at the code to review.`,
      msg`Read the issue list with location, type, and severity.`,
      msg`Decide which suggested fixes to apply.`,
    ],
  },
  {
    id: "refactor-code",
    category: "code",
    subgroup: "code-maintenance",
    icon: Recycle,
    title: msg`Optimize or refactor code`,
    description: msg`Refactor code for performance, readability, or maintainability while preserving behavior, with a before/after diff and per-item notes.`,
    prompt: msg`Refactor the following code for the goals I give (performance, readability, or maintainability) while keeping behavior equivalent. Show the before/after diff and explain each change so I can adopt or revert them one by one.`,
    steps: [
      msg`Point me at the code and the goal (performance, readability, or maintainability).`,
      msg`Review the before/after diff.`,
      msg`Adopt or revert each change individually.`,
    ],
  },
  {
    id: "fix-bug",
    category: "code",
    subgroup: "code-maintenance",
    icon: Bug,
    title: msg`Locate and fix a defect`,
    description: msg`Locate a defect from a description, log, or stack trace and produce a fix with its rationale. Pauses before changing files.`,
    prompt: msg`From the error description, log, or stack trace I provide, locate the defect, explain the evidence for the location, and produce a fix. Stop and confirm with me before modifying any file.`,
    steps: [
      msg`Describe the defect or paste the log / stack trace.`,
      msg`Review the located cause and the proposed fix.`,
      msg`Confirm before I modify any file.`,
    ],
  },
  {
    id: "write-unit-tests",
    category: "code",
    subgroup: "unit-test",
    icon: FlaskConical,
    title: msg`Write unit tests`,
    description: msg`Write unit tests for a function or module that match the existing test style, covering normal, boundary, and error paths.`,
    prompt: msg`Write unit tests for the code I point at, matching the existing test framework and style. Cover normal paths, boundary cases, and error cases, and explain what each test protects against.`,
    steps: [
      msg`Point me at the code that needs tests.`,
      msg`Review the proposed test cases.`,
      msg`Adopt the tests and run them.`,
    ],
  },
  {
    id: "review-document",
    category: "test",
    icon: FileSearch,
    title: msg`Review a document`,
    description: msg`Review requirements, design, or other documents for completeness, clarity, consistency, and formatting against the expected template.`,
    prompt: msg`Review the following document for completeness, clarity, consistency, and formatting against the expected template. Output an issue list with location, type, severity, and a suggested fix. Do not decide on my behalf — leave the final call to me.`,
    steps: [
      msg`Paste the document to review.`,
      msg`Read the issue list with location, type, and severity.`,
      msg`Decide which suggested fixes to apply.`,
    ],
  },
  {
    id: "static-analysis",
    category: "test",
    icon: ShieldCheck,
    title: msg`静态分析（GJB8114/CWE）`,
    description: msg`迁移自原项目静态分析模块：纯AI模式与工具模式（科代）× C语言/FPGA。选择代码目录作为工作区（工具模式另需上传科代结果 Excel），勾选 GJB8114/CWE 规则，创建任务即落库，由智能体执行分析并产出问题单与代码视图。`,
    relatedSkillIds: ["static-analysis"],
    prompt: msg`使用静态分析技能执行本次静态分析。按当前模式对范围内的代码逐条规则审查：违反的规则代码（GJB8114 或 CWE）、问题等级、问题名称、问题定位（文件+行）、问题描述、需求描述、影响分析、修改意见。每个问题输出四段式问题单（需求描述/问题描述/问题定位/影响分析）与测评单位意见。完成后将报告写入项目的 static-analysis/ 目录，文件命名为 <taskId>-<mode>-report.json，进度写入 <taskId>-<mode>-progress.json。任务ID使用静态分析模块创建任务时生成的ID；若无法获取，可用任意标识，系统会自动关联该项目同模式下进行中的任务。`,
    outputModes: [
      {
        id: "normal_c",
        label: msg`纯AI模式·C语言`,
        hint: msg`直接对 C/C++ 代码目录做基于 GJB8114/CWE 规则库的静态分析，无需外部工具。`,
        agentInstruction: msg`模式：纯AI模式·C语言（normal_c）。选择代码目录作为工作区，无需上传代码包。读取全局规则库（GJB8114/CWE），按勾选的规则逐文件逐函数分析 C/C++ 源码，输出问题单（对齐原项目格式：文件名称/源代码/违反规则/问题等级/问题名称/问题来源/问题描述/修改意见）。报告写入 static-analysis/<taskId>-normal_c-report.json。`,
        recommendedWhenReferenceSelected: true,
      },
      {
        id: "normal_fpga",
        label: msg`纯AI模式·FPGA`,
        hint: msg`直接对 FPGA（VHDL/Verilog）代码目录做静态分析。`,
        agentInstruction: msg`模式：纯AI模式·FPGA（normal_fpga）。选择代码目录作为工作区。基于 GJB8114 规则库对 FPGA（VHDL/Verilog）源码做静态分析，输出问题单（对齐原项目格式）。报告写入 static-analysis/<taskId>-normal_fpga-report.json。`,
        recommendedWhenReferenceSelected: false,
      },
      {
        id: "filter_c",
        label: msg`工具模式·C语言`,
        hint: msg`上传科代静态分析结果 Excel，按 GJB8114/CWE 规则做 AI 智能过滤并生成问题单。`,
        agentInstruction: msg`模式：工具模式·C语言（filter_c）。读取上传的科代静态分析结果 Excel 与代码目录，先按确定规则做规则匹配过滤，再对不确定规则逐条做 AI 分析（判定是否真实问题、给出置信度/证据/建议），生成格式化问题单（对齐原项目：GJB/CWE 双 Sheet，含 issue_name/issue_file/issue_line/rule_code/rule_accuracy_type/ai_* 字段与 problem_sheet）。报告写入 static-analysis/<taskId>-filter_c-report.json。`,
        recommendedWhenReferenceSelected: false,
      },
      {
        id: "filter_fpga",
        label: msg`工具模式·FPGA`,
        hint: msg`上传科代 FPGA 静态分析结果 Excel，按规则做 AI 智能过滤并生成问题单。`,
        agentInstruction: msg`模式：工具模式·FPGA（filter_fpga）。读取上传的科代 FPGA 静态分析结果 Excel 与 FPGA 代码目录，按 GJB8114 规则做规则匹配与 AI 过滤，生成格式化问题单（对齐原项目格式）。报告写入 static-analysis/<taskId>-filter_fpga-report.json。`,
        recommendedWhenReferenceSelected: false,
      },
    ],
    steps: [
      msg`选择代码目录作为工作区（纯AI模式无需上传代码包）；工具模式另需上传科代结果 Excel。`,
      msg`勾选要应用的 GJB8114 / CWE 规则（确定/不确定）。`,
      msg`创建任务（任务即写入数据库），发送场景提示词让智能体执行分析。`,
      msg`在静态分析模块查看问题单与代码视图，标记问题状态。`,
    ],
    fileOutputDir: "static-analysis",
  },
  {
    id: "code-review",
    category: "test",
    icon: ClipboardCheck,
    title: msg`代码审查（配置项）`,
    description: msg`对 C/C++ 代码做三类审查：函数审查（单个函数）、链路审查（跨函数调用路径）、功能审查（对照需求审查整个功能）。用 WASM tree-sitter 建立代码索引以精确定位问题。`,
    relatedSkillIds: ["function-review", "chain-review", "feature-review"],
    prompt: msg`Run a code review over the C/C++ code I point at. Pick one of the three review modes (function, chain, or feature), index the code, and output an issue list with location, type, severity, and a suggested fix. Do not decide on my behalf — leave the final call to me.`,
    outputModes: [
      {
        id: "function",
        label: msg`函数审查`,
        hint: msg`审查单个函数：命名、复杂度、错误处理、资源与内存安全、空指针与越界、魔法数、返回值、副作用、类型安全、文档。`,
        agentInstruction: msg`使用 /function-review 技能。对范围内的每个函数执行固定问题目录审查，逐条给出文件+稳定定位、类型、严重度与建议方向。`,
        // 代码审查场景不声明 `code` 输入，`hasReferenceCodeSelection` 恒为 false，
        // 于是 `resolveScenarioOutputMode` 取「第一个 recommendedWhenReferenceSelected
        // === false 的模式」。函数审查是三种模式的基线，必须显式 false 才能成为默认；
        // 早期写成 true 会让默认落到链路审查（起草区选择器 / 智能体提示词 / 审查面板
        // 三处一致地默认成链路）。
        recommendedWhenReferenceSelected: false,
      },
      {
        id: "chain",
        label: msg`链路审查`,
        hint: msg`追踪跨函数调用路径：循环、深度、数据流断裂、错误被吞、分层、生命周期、条件不一致、共享状态竞争。`,
        agentInstruction: msg`使用 /chain-review 技能。基于索引调用图追踪范围内的跨函数调用链，核查数据与错误沿链传播，逐条给出文件+稳定定位、类型、严重度与建议方向。`,
        recommendedWhenReferenceSelected: false,
      },
      {
        id: "feature",
        label: msg`功能审查`,
        hint: msg`对照需求审查整个功能：完整性、边界、输入校验、需求匹配、默认值、并发、可测性、一致性、文档。`,
        agentInstruction: msg`使用 /feature-review 技能。对照需求审查范围内功能：对功能的入口与行为执行固定问题目录检查，逐条给出文件+稳定定位、类型、严重度与建议方向。`,
        recommendedWhenReferenceSelected: false,
      },
    ],
    steps: [
      msg`Point me at the code (and requirements, for a feature review).`,
      msg`Choose the review mode: function, chain, or feature.`,
      msg`Read the issue list with location, type, and severity.`,
      msg`Decide which issues to raise with the team.`,
    ],
    fileOutputDir: "reviews",
  },
  {
    id: "code-review-regression",
    category: "test",
    icon: ClipboardCheck,
    title: msg`代码审查（回归）`,
    description: msg`回归审查：对比代码变更与上传的影响域分析报告的一致性，并审查变更代码本身的语义级问题。用 Poracode diff_paths MCP 生成变更差异，首页支持上传影响域分析报告。`,
    relatedSkillIds: ["regression-review"],
    prompt: msg`Run a regression review over the changed code against the uploaded impact-analysis report. Check consistency between the change and the report, and review the change itself for semantic problems. Do not decide on my behalf — leave the final call to me.`,
    outputModes: [
      {
        id: "regression",
        label: msg`回归审查`,
        hint: msg`审查变更代码与影响域分析报告的一致性，并审查变更代码本身的语义级问题（功能逻辑、边界与异常路径、资源与生命周期、数据/错误传递等）。`,
        agentInstruction: msg`使用 /regression-review 技能。读取上传的影响域分析报告，用 diff_paths MCP 对比变更代码，逐条核查变更与报告的一致性，并审查变更本身的语义级问题。`,
        recommendedWhenReferenceSelected: true,
      },
    ],
    requiredInputs: [
      {
        id: "impact_report",
        label: msg`影响域分析报告`,
        hint: msg`必填。上传描述本次变更及影响范围的报告（变更内容、影响文件/函数/模块、风险点）。`,
        minFiles: 1,
        required: true,
      },
      {
        id: "baseline",
        label: msg`基线代码目录（旧，可选）`,
        hint: msg`可选。变更前的代码目录，用于和变更后代码做 diff。不填则用 git 工作区变更。`,
        kind: "code",
        minFiles: 1,
        required: false,
      },
      {
        id: "change",
        label: msg`变更代码目录（新，必填）`,
        hint: msg`必填。本次变更后的代码目录，作为 diff 的右（变更）侧。`,
        kind: "code",
        minFiles: 1,
        required: true,
      },
    ],
    steps: [
      msg`Upload the impact-analysis report.`,
      msg`Point me at the changed code (left = baseline, right = change).`,
      msg`Read consistency issues and change-level problems.`,
      msg`Decide which issues to raise with the team.`,
    ],
    fileOutputDir: "reviews",
  },
  {
    id: "generate-test-cases",
    category: "test",
    icon: ListChecks,
    title: msg`Generate test cases`,
    description: msg`Turn requirements or interfaces into a structured test-case set, covering normal, boundary, and exception paths.`,
    prompt: msg`From the requirements or interfaces I provide, produce a structured test-case set. Cover normal, boundary, and exception paths, and give each case an id, preconditions, steps, and expected result.`,
    steps: [
      msg`Provide the requirements or interfaces to cover.`,
      msg`Review the generated test cases.`,
      msg`Adopt the cases into your test plan.`,
    ],
  },
  {
    id: "draft-word-document",
    category: "general",
    icon: FileText,
    title: msg`Write a Word document`,
    description: msg`Draft a Word (.docx) document — a report, manual, or plan — from the material you provide, then render and insert the figures it needs.`,
    prompt: msg`Write a Word (.docx) document from the material I provide. Work in two phases: first give me the outline — sections, what each one covers, and which figures or tables it needs — and wait for my confirmation; then write the full text into the document. Build and edit the document with the bundled officecli tool (create, set, add, view, validate) rather than writing raw XML by hand, and run officecli help <element> instead of guessing a property name. Use the bundled docx-figures skill to render and insert each figure at the confirmed anchor, and read every rendered image back to check it before reporting it as done. Before you hand the document over, self-check it: run officecli validate and officecli view <file> issues and fix what they report. Keep each number, name, and conclusion traceable to my material: leave a placeholder and ask me instead of inventing content. Write the finished .docx under docs/ in the project.`,
    steps: [
      msg`Attach the material the document is written from — notes, an existing draft, or data.`,
      msg`Tell me the document's purpose and audience, and where it will be used.`,
      msg`Confirm the outline and the figure list I propose.`,
      msg`Get the finished .docx under the project's docs/ folder and review it in Word.`,
    ],
    leadingSkillId: "docx-figures",
    relatedSkillIds: ["docx-figures", "officecli"],
    relatedPluginIds: ["officecli"],
    fileOutputDir: "docs",
  },
  {
    id: "organize-spreadsheet",
    category: "general",
    icon: Table2,
    title: msg`Clean up a spreadsheet`,
    description: msg`Tidy an Excel workbook: unify formats, fill or flag what is missing, drop duplicates, and add the summary rows you ask for — always on a copy.`,
    prompt: msg`Work on the Excel workbook I attach. Read it first and report back: the sheets it holds, what each one is for, the meaning of the columns, and every data-quality problem you find — mixed formats, blank or duplicated keys, dates stored as text, totals that do not add up. Wait for my confirmation before changing anything. Then produce a cleaned copy under the project (never overwrite the original) that unifies the formats, fills or clearly flags the gaps, removes duplicates, and adds the summary rows I ask for. Read and edit the workbook with the bundled officecli tool (get, query, set, add) so formats, number formats, and formulas survive intact, and run officecli help xlsx <element> instead of guessing a property name. Use the bundled Python runtime with openpyxl only for what officecli cannot express — do not install extra packages. Before you hand the copy over, self-check it: run officecli validate and officecli view <file> issues and fix what they report. Finish with a short change log: what you changed, in which sheet and column, and why.`,
    steps: [
      msg`Attach the workbook (.xlsx) and say what the table is used for.`,
      msg`Confirm the sheet/column reading and the problem list I report.`,
      msg`Pick which cleanups to apply and which totals you need.`,
      msg`Open the cleaned copy and review the change log.`,
    ],
    relatedSkillIds: ["officecli"],
    relatedPluginIds: ["officecli"],
  },
  {
    id: "build-slide-deck",
    category: "general",
    icon: Presentation,
    title: msg`Build a slide deck`,
    description: msg`Turn your material into a presentation: agree the story line, then get each slide's title, bullets, and speaker notes as a Markdown deck you can paste into PowerPoint.`,
    prompt: msg`Turn the material I provide into a presentation. Work in three phases: first propose the story line and the slide list (titles only) and wait for my confirmation; then write each slide's title, three to six bullets, and the speaker notes; finally review the whole deck for a consistent level of detail and for slides that repeat each other. One idea per slide, and prefer the concrete numbers, names, and decisions from my material over generic statements. Deliver the deck as a Markdown file under docs/ — one "## slide title" section per slide, followed by its notes — so I can paste it into PowerPoint.`,
    steps: [
      msg`Attach the material the deck is built from and describe the audience and the time slot.`,
      msg`Confirm the story line and slide list I propose.`,
      msg`Read the drafted slides and adjust the emphasis.`,
      msg`Get the Markdown deck under the project's docs/ folder and paste it into PowerPoint.`,
    ],
    fileOutputDir: "docs",
  },
  {
    id: "control-desktop-app",
    category: "general",
    icon: MonitorPlay,
    title: msg`Automate a desktop app`,
    description: msg`Drive a desktop application for you — open it, click through a flow, fill in the form — and report what the window actually shows at every step.`,
    prompt: msg`Operate the desktop app I name, using AgentEmployee's desktop-control tools. Work in small verified steps: before each action say what you are about to click or type and why; after it, look at the window again and confirm the result before continuing. Never enter credentials, send messages, make purchases, or delete anything without asking me first. If a step fails or the window does not look the way you expected, stop and show me what you see instead of retrying blindly. When you finish, report the final window state and everything you changed.`,
    steps: [
      msg`Name the app and window to drive, and describe the outcome you want.`,
      msg`Confirm the step plan before I start clicking.`,
      msg`Answer my questions when a step needs your decision — credentials and irreversible actions are always yours to approve.`,
      msg`Read the final report and check the app's window state.`,
    ],
    leadingSkillId: "computer-use",
    relatedSkillIds: ["computer-use"],
    relatedPluginIds: ["computer-use"],
    enableMcpServerIds: ["computer-use"],
  },
];

/**
 * Localized display name for each category, used for grouping headers and the
 * workspace domain picker. Named after the task, not the bare topic, so the
 * option reads as a kind of work ("Software coding") rather than a label that
 * collides with the generic "Code"/"General" strings used elsewhere.
 */
export const SCENARIO_CATEGORY_LABELS: Record<ScenarioCategory, MessageDescriptor> = {
  general: msg`General tasks`,
  docs: msg`Document writing`,
  code: msg`Software coding`,
  test: msg`Software testing`,
};

/**
 * Localized display name for each sub-group, used for the headers that split
 * the document-writing list (requirements / design / change) and the
 * software-coding list (code generation / code maintenance / unit testing) into
 * workstreams.
 */
export const SCENARIO_SUBGROUP_LABELS: Record<ScenarioSubgroup, MessageDescriptor> = {
  requirements: msg`Requirements document`,
  design: msg`Design document`,
  change: msg`Change document`,
  "code-generation": msg`Code generation`,
  "code-maintenance": msg`Code maintenance`,
  "unit-test": msg`Unit testing`,
};

/**
 * One display group: a sub-group header (or no header for a flat run) plus the
 * scenarios under it. `key` is stable per sub-group, so list renderers can use
 * it as a React key.
 */
export interface ScenarioDisplayGroup {
  key: string;
  label: MessageDescriptor | null;
  scenarios: ScenarioView[];
}

/**
 * Split a scenario list into display groups in first-seen sub-group order.
 * Scenarios without a sub-group share one header-less group, so a workspace
 * that mixes categories (or a category that never sets `subgroup`) still
 * renders as a single flat run. Sub-groups preserve their catalog order within
 * the group and drop duplicate headers even when catalog entries interleave.
 */
export function groupScenariosForDisplay(
  scenarios: readonly ScenarioView[],
): ScenarioDisplayGroup[] {
  const groups = new Map<string, ScenarioDisplayGroup>();
  for (const scenario of scenarios) {
    const subgroup = scenario.subgroup;
    const key = subgroup ?? "flat";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: subgroup ? SCENARIO_SUBGROUP_LABELS[subgroup] : null,
        scenarios: [],
      };
      groups.set(key, group);
    }
    group.scenarios.push(scenario);
  }
  return [...groups.values()];
}

/** Scenarios grouped by category, in catalog order. Categories with no scenarios get an empty list. */
export function scenariosByCategory(): Map<ScenarioCategory, ScenarioView[]> {
  const byCategory = new Map<ScenarioCategory, ScenarioView[]>(
    SCENARIO_CATEGORIES.map((category) => [category, []]),
  );
  for (const scenario of SCENARIOS) {
    byCategory.get(scenario.category)!.push(scenario);
  }
  return byCategory;
}

export function scenarioById(id: string): ScenarioView | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/**
 * Scenario ids seeded onto the matching default workspace (by category) on
 * first run. Categories with no scenarios stay empty so their workspace shows
 * every scenario rather than none.
 */
export const DEFAULT_SCENARIO_IDS_BY_CATEGORY: Record<ScenarioCategory, readonly string[]> = {
  general: [
    "draft-word-document",
    "organize-spreadsheet",
    "build-slide-deck",
    "control-desktop-app",
  ],
  docs: ["write-requirements", "write-design", "write-impact-analysis"],
  code: [
    "scaffold-project",
    "modify-project-code",
    "fix-coding-rule-issues",
    "understand-project",
    "review-code",
    "refactor-code",
    "fix-bug",
    "write-unit-tests",
  ],
  test: ["review-document", "static-analysis", "code-review", "code-review-regression", "generate-test-cases"],
};

/** Category the built-in default workspaces map to, in `DEFAULT_WORKSPACE_NAMES` order. */
export const DEFAULT_WORKSPACE_CATEGORIES: readonly ScenarioCategory[] = [
  "general",
  "docs",
  "code",
  "test",
];
