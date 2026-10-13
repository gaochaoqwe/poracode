/**
 * Machine-readable static-analysis reports written by the static-analysis
 * skill to `<project>/static-analysis/<taskId>-<mode>-report.json`. The format
 * mirrors the original requirement_extractor staticAnalysis module's problem
 * sheet: every problem carries the four-part description (需求描述/问题描述/
 * 问题定位/影响分析) plus the 测评单位意见 (test-unit opinion).
 *
 * Lives in `src/shared` so both the main process (which ingests reports into
 * the global `state.sqlite`) and the renderer (which displays them) parse with
 * the same tolerant logic.
 */

/** analysis kind: pure-AI (normal) vs tool/科代-filter (filter) × C vs FPGA. */
export type StaticAnalysisMode = "normal_c" | "normal_fpga" | "filter_c" | "filter_fpga";

export type StaticAnalysisRuleType = "gjb" | "cwe" | "fpga";

export function staticAnalysisModeLabel(mode: StaticAnalysisMode | null): string {
  switch (mode) {
    case "normal_c":
      return "纯AI模式·C语言";
    case "normal_fpga":
      return "纯AI模式·FPGA";
    case "filter_c":
      return "工具模式·C语言";
    case "filter_fpga":
      return "工具模式·FPGA";
    default:
      return "静态分析";
  }
}

/** 问题单三段结构：四段式描述 + 测评单位意见（对齐原项目）。 */
export interface StaticAnalysisProblemSheet {
  issue_name: string;
  four_part_description: string;
  test_unit_opinion: string;
}

/** A normalized problem row; fields mirror the original normalize_problem(). */
export interface StaticAnalysisProblem {
  problemId: string;
  issue_name: string;
  issue_file: string;
  issue_line: number | null;
  issue_location: string;
  issue_description: string;
  issue_level: string;
  rule_code: string;
  rule_type: StaticAnalysisRuleType | null;
  rule_accuracy_type: string;
  ai_analyzed: boolean;
  ai_is_real_issue: boolean | null;
  ai_confidence: number | null;
  ai_analysis_result: string;
  ai_reasoning: string;
  ai_recommendations: string;
  /** 0 新发现 / 1 已查看 / 2 已过滤 / 3 已标记. */
  problem_status: number;
  is_filtered: boolean;
  filter_reason: string;
  file_name: string;
  violation_rules: string;
  description_requirement: string;
  description_issue: string;
  description_location: string;
  description_impact: string;
  problem_sheet: StaticAnalysisProblemSheet | null;
  function_name: string;
  source_code: string;
  sheet_name: string;
  row_index: number | null;
}

export interface StaticAnalysisFile {
  file_name: string;
  file_path: string;
  source_code: string;
}

export interface StaticAnalysisReport {
  schemaVersion: number;
  taskId: string;
  mode: StaticAnalysisMode | null;
  fileName: string;
  files: readonly StaticAnalysisFile[];
  problems: readonly StaticAnalysisProblem[];
  selectedRules: readonly string[];
}

export interface StaticAnalysisProgress {
  taskId: string;
  mode: StaticAnalysisMode | null;
  status: "pending" | "running" | "paused" | "completed" | "failed" | null;
  progress: number;
  totalFiles: number;
  processedFiles: number;
  totalProblems: number;
  totalRules: number;
  accurateRules: number;
  uncertainRules: number;
  totalUnits: number;
  processedUnits: number;
  currentRuleCode: string | null;
  currentAnalyzingIssue: string | null;
  toolCallsCount: number;
  updatedAt: string | null;
}

export interface StaticAnalysisRule {
  ruleCode: string;
  ruleType: StaticAnalysisRuleType;
  ruleName: string;
  ruleDescription: string;
  category: string;
  accuracyType: "accurate" | "uncertain";
  analysisComplexity: string;
  detectionMethod: string;
  keywords: readonly { keyword: string; keywordType: string | null }[];
  problemCount: number;
  isSelected: boolean;
}

/** A static-analysis task row as the renderer sees it (persisted on create). */
export interface StaticAnalysisTaskView {
  taskId: string;
  taskName: string;
  mode: StaticAnalysisMode | null;
  domain: string;
  status: string;
  progress: number;
  totalFiles: number;
  processedFiles: number;
  totalProblems: number;
  totalRules: number;
  accurateRules: number;
  uncertainRules: number;
  totalUnits: number;
  processedUnits: number;
  currentRuleCode: string | null;
  currentAnalyzingIssue: string | null;
  toolCallsCount: number;
  selectedRules: readonly string[];
  excelFile: string | null;
  codebasePath: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Aggregated static-analysis state for one project (tasks + problems + files + rules). */
export interface StaticAnalysisProjectData {
  tasks: readonly StaticAnalysisTaskView[];
  problems: readonly StaticAnalysisProblem[];
  files: readonly StaticAnalysisFile[];
  rules: readonly StaticAnalysisRule[];
}

const REPORT_NAME_PATTERN = /^(.+)-(\w+)-report\.json$/i;
const PROGRESS_NAME_PATTERN = /^(.+)-(\w+)-progress\.json$/i;

function knownMode(raw: string): StaticAnalysisMode | null {
  const mode = raw.toLowerCase();
  return mode === "normal_c" ||
    mode === "normal_fpga" ||
    mode === "filter_c" ||
    mode === "filter_fpga"
    ? mode
    : null;
}

export function parseStaticAnalysisReportFileName(fileName: string): {
  taskId: string;
  mode: StaticAnalysisMode | null;
} | null {
  const match = REPORT_NAME_PATTERN.exec(fileName);
  if (!match) return null;
  return { taskId: match[1] ?? "", mode: knownMode(match[2] ?? "") };
}

export function parseStaticAnalysisProgressFileName(fileName: string): {
  taskId: string;
  mode: StaticAnalysisMode | null;
} | null {
  const match = PROGRESS_NAME_PATTERN.exec(fileName);
  if (!match) return null;
  return { taskId: match[1] ?? "", mode: knownMode(match[2] ?? "") };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asRuleType(value: unknown): StaticAnalysisRuleType | null {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  return raw === "gjb" || raw === "cwe" || raw === "fpga" ? raw : null;
}

function parseProblemSheet(value: unknown): StaticAnalysisProblemSheet | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    issue_name: asString(record.issue_name),
    four_part_description: asString(record.four_part_description),
    test_unit_opinion: asString(record.test_unit_opinion),
  };
}

function parseProblem(value: unknown): StaticAnalysisProblem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const file = asString(record.file_name) || asString(record.issue_file);
  if (!file) return null;
  const problemId =
    asString(record.problemId) ||
    asString(record.id) ||
    `${file}#${asString(record.issue_location) || asString(record.rule_code) || "row"}`;
  return {
    problemId,
    issue_name: asString(record.issue_name),
    issue_file: asString(record.issue_file) || file,
    issue_line: asNumber(record.issue_line) ?? asNumber(record.line),
    issue_location: asString(record.issue_location),
    issue_description: asString(record.issue_description) || asString(record.description_issue),
    issue_level: asString(record.issue_level) || "一般问题",
    rule_code: asString(record.rule_code) || asString(record.violation_rules),
    rule_type: asRuleType(record.rule_type),
    rule_accuracy_type: asString(record.rule_accuracy_type) || "uncertain",
    ai_analyzed: asBool(record.ai_analyzed) ?? false,
    ai_is_real_issue: asBool(record.ai_is_real_issue),
    ai_confidence: asNumber(record.ai_confidence),
    ai_analysis_result: asString(record.ai_analysis_result),
    ai_reasoning: asString(record.ai_reasoning),
    ai_recommendations: asString(record.ai_recommendations),
    problem_status: asNumber(record.problem_status) ?? 0,
    is_filtered: asBool(record.is_filtered) ?? false,
    filter_reason: asString(record.filter_reason),
    file_name: file,
    violation_rules: asString(record.violation_rules) || asString(record.rule_code),
    description_requirement: asString(record.description_requirement),
    description_issue: asString(record.description_issue),
    description_location: asString(record.description_location),
    description_impact: asString(record.description_impact),
    problem_sheet: parseProblemSheet(record.problem_sheet),
    function_name: asString(record.function_name),
    source_code: asString(record.source_code),
    sheet_name: asString(record.sheet_name),
    row_index: asNumber(record.row_index),
  };
}

function parseFile(value: unknown): StaticAnalysisFile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const filePath = asString(record.file_path) || asString(record.path);
  if (!filePath) return null;
  return {
    file_name: asString(record.file_name) || (filePath.split("/").pop() ?? filePath),
    file_path: filePath,
    source_code: asString(record.source_code),
  };
}

export function parseStaticAnalysisReportFile(
  text: string | null | undefined,
  fileName: string,
): StaticAnalysisReport | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const { taskId, mode } = parseStaticAnalysisReportFileName(fileName) ?? {
    taskId: fileName,
    mode: null,
  };
  const problems = Array.isArray(record.problems)
    ? record.problems
        .map((p) => parseProblem(p))
        .filter((p): p is StaticAnalysisProblem => p !== null)
    : [];
  const files = Array.isArray(record.files)
    ? record.files
        .map((f) => parseFile(f))
        .filter((f): f is StaticAnalysisFile => f !== null)
    : [];
  return {
    schemaVersion:
      typeof record.version === "number"
        ? record.version
        : typeof record.schemaVersion === "number"
          ? record.schemaVersion
          : 1,
    taskId,
    mode,
    fileName,
    files,
    problems,
    selectedRules: Array.isArray(record.selectedRules)
      ? record.selectedRules.map((r) => asString(r)).filter((r) => r.length > 0)
      : [],
  };
}

export function parseStaticAnalysisProgressFile(
  text: string | null | undefined,
  fileName: string,
): StaticAnalysisProgress | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const { taskId, mode } = parseStaticAnalysisProgressFileName(fileName) ?? {
    taskId: fileName,
    mode: null,
  };
  const statusRaw = typeof record.status === "string" ? record.status : "";
  const status: StaticAnalysisProgress["status"] =
    statusRaw === "pending" ||
    statusRaw === "running" ||
    statusRaw === "paused" ||
    statusRaw === "completed" ||
    statusRaw === "failed"
      ? statusRaw
      : null;
  return {
    taskId,
    mode,
    status,
    progress: asNumber(record.progress) ?? 0,
    totalFiles: asNumber(record.totalFiles) ?? 0,
    processedFiles: asNumber(record.processedFiles) ?? 0,
    totalProblems: asNumber(record.totalProblems) ?? 0,
    totalRules: asNumber(record.totalRules) ?? 0,
    accurateRules: asNumber(record.accurateRules) ?? 0,
    uncertainRules: asNumber(record.uncertainRules) ?? 0,
    totalUnits: asNumber(record.totalUnits) ?? 0,
    processedUnits: asNumber(record.processedUnits) ?? 0,
    currentRuleCode: asString(record.currentRuleCode) || null,
    currentAnalyzingIssue: asString(record.currentAnalyzingIssue) || null,
    toolCallsCount: asNumber(record.toolCallsCount) ?? 0,
    updatedAt: asString(record.updatedAt) || null,
  };
}
