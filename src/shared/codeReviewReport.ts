/**
 * Machine-readable review reports written by the code-review skills to
 * `<project>/reviews/<taskId>-<mode>-review.json`. The app only reads them;
 * the skills own the format (see resources/plugins/code-review/skills/
 * references/issue-schema.json).
 *
 * Lives in `src/shared` so both the main process (which ingests the reports
 * into the global `state.sqlite`) and the renderer (which displays them) parse
 * with the same tolerant logic. Parsing is intentionally tolerant: reports are
 * produced by an agent and may gain fields, so unknown/extra fields are ignored
 * and a bad or missing file yields `null` rather than throwing.
 */

export type ReviewMode = "function" | "chain" | "feature";

/**
 * 报告级函数信息（机器报告末端的 `function_info`）。函数审查模式用它描述被审函数，
 * 渲染在问题单最上方。
 *
 * 单函数报告里 `function_info` 是对象；批量聚合报告里是**数组**（每个被审函数一条），
 * 解析层统一归一化成数组，两种形态都能读。
 */
export interface ReviewFunctionInfo {
  /** 所属审查任务（从报告文件名解析出的 taskId）。 */
  taskId: string;
  mode: ReviewMode | null;
  functionName: string;
  /**
   * 函数所在文件（报告 `function_info.file_name`）。可选：老报告没有这一项，
   * 此时左树只能从问题里回推文件；有值时函数会挂到对应文件节点下（即使该函数
   * 没有问题，也能在目录树里看到）。
   */
  fileName: string;
  /** 函数功能概述正文；报告未提供时为空串（面板仍渲染该区块与占位文案）。 */
  functionDescription: string;
}

/** A single problem row the panel renders, with persisted state merged in. */
export interface ReviewIssueView {
  /** Globally unique within a task; may repeat across tasks. */
  id: string;
  /** taskId + issueId — the stable key used for persisted state. */
  key: string;
  taskId: string;
  mode: ReviewMode | null;
  file: string;
  functionName: string | null;
  /**
   * 该问题所属的功能模块 id（报告 `problems[].feature_id`）。链路 / 功能审查填写后，
   * 「功能模块列表 / 功能列表」选中某模块时能精确收敛到该模块的问题；老报告没有这一项
   * （null），退化为按审查任务收敛。
   */
  featureId: string | null;
  /** 精确行号（优先从 description_location 解析，其次 model 直接给出的 line） */
  line: number | null;
  /** 问题类型 / 违反的规则，来自 problem_reason */
  type: string;
  /** 中文严重度：一般问题 / 重要问题（「建议改进」已在解析层自动过滤） */
  severity: string;
  /** 问题名称，来自 issue_name */
  summary: string;
  /** 问题描述，来自 description_issue */
  descriptionIssue: string;
  /** 建议方向，来自 description_requirement */
  suggestion: string;
  /** 影响分析，来自 description_impact */
  impact: string;
  /** 问题所在函数的完整源码（报告 `source_code`），导出「源代码」列使用 */
  sourceCode: string;
  /** description_location 原始串（含上下文源码），用于详情展示 */
  descriptionLocation: string;
  /** 从 description_location 提取的问题代码语句，用于代码视图全字匹配定位 */
  codeStatement: string;
  /** 问题原因原始值（problem_reason 回退 type / issue_name） */
  problemReason: string;
  /** 问题位置原始值（issue_location 回退 source.locator / source.location） */
  issueLocation: string;
  /**
   * 涉及函数（报告 `affected_functions`）。链路 / 功能审查里一个问题跨多个函数时，
   * 面板「涉及函数」字段展示；为空串则不渲染该字段。
   */
  affectedFunctions: string;
}

/**
 * 功能模块（报告级 `features[]`）— 链路 / 功能审查四栏布局第一栏的数据源。
 *
 * 对齐源项目 requirement_extractor：链路审查的第一栏「功能模块列表」是按需求章节
 * 组织的一棵树（`sub_features` 嵌套），功能审查的第一栏「功能列表」是平铺的功能卡片。
 * 解析层统一归一化成**平铺数组**（`parentId` 指回父模块），树形由 `buildFeatureTree`
 * 还原，这样外部契约保持简单、两种形态共用一套渲染。
 */
export interface ReviewFeatureView {
  /** 所属审查任务（报告文件名解析出的 taskId）。 */
  taskId: string;
  mode: ReviewMode | null;
  /** 功能模块稳定 id（`problems[].feature_id` 引用它）。 */
  id: string;
  name: string;
  /** 章节号（链路审查按需求文档章节划分时使用，如 "3.2"）。 */
  section: string;
  /** 功能介绍 / 功能描述 —— 渲染在第四栏「功能介绍」区块。 */
  description: string;
  /** 功能入口函数。 */
  entryFunction: string;
  /** 审查状态（功能列表的状态标签）：pending / running / done / failed，未知为空串。 */
  status: string;
  /** 该功能模块涉及的文件（目录树高亮与收敛用）。 */
  files: readonly string[];
  /** 该功能模块涉及的函数名。 */
  functions: readonly string[];
  /** 链路顺序：函数名按调用先后排列（入口在前），目录树据此打 A/B/C 角标。 */
  chainOrder: readonly string[];
  /** 父功能 id（顶层模块为 null，同任务内唯一）。 */
  parentId: string | null;
}

/** 功能模块树节点（`buildFeatureTree` 输出；含按 `parentId` 还原出的 children）。 */
export interface ReviewFeatureNode extends ReviewFeatureView {
  children: ReviewFeatureNode[];
}

/** 链路审查可选的调用关系图（报告 `callgraph`，来自索引，不得编造）。 */
export interface ReviewCallGraphNode {
  id: string;
  label: string;
  type: "file" | "function";
  file: string;
}

export interface ReviewCallGraph {
  taskId: string;
  nodes: readonly ReviewCallGraphNode[];
  edges: readonly { from: string; to: string }[];
}

export interface ReviewReport {
  schemaVersion: number;
  mode: ReviewMode | null;
  taskId: string;
  fileName: string;
  issues: readonly ReviewIssueView[];
  /** 报告级函数信息（`function_info`，已归一化为数组）；缺失时为空数组。 */
  functionInfos: readonly ReviewFunctionInfo[];
  /** 报告级功能模块（`features`，已归一化为平铺数组 + parentId）；缺失时为空数组。 */
  features: readonly ReviewFeatureView[];
  /** 链路审查的调用关系图（`callgraph`）；缺失时为 null。 */
  callgraph: ReviewCallGraph | null;
  /** 本次解析中被自动过滤掉的「建议改进」问题数（供诊断/测试）。 */
  filteredCount: number;
}

// ============================================================================
// 左侧目录树（文件 → 函数）
// ============================================================================

/** 目录树里的一个函数节点。 */
export interface ReviewTreeFunction {
  /** 函数名；报告未给函数名的归到 `(未命名)` 分组。 */
  name: string;
  /** 所属任务 id（同名函数跨任务时用于区分 key）。 */
  taskId: string;
  problemCount: number;
  markedCount: number;
  /** 该函数首个问题（按行号升序）的 key，点击函数时定位到它；无问题时为 null。 */
  firstIssueKey: string | null;
  firstIssueLine: number | null;
}

/** 目录树里的一个文件节点（含其下函数）。 */
export interface ReviewTreeFile {
  /** 原始路径（点击后写回 store，供代码视图读源码）。 */
  path: string;
  /** 归一化路径，用于分组与选中比较。 */
  key: string;
  name: string;
  problemCount: number;
  markedCount: number;
  functions: ReviewTreeFunction[];
}

/** 纯函数：把问题聚合 ∪ 报告 `function_info` 组织成「文件 → 函数」两级目录树。 */
export const UNNAMED_FUNCTION = "(未命名)";

/**
 * 构造「文件 → 函数」两级目录树（对齐源项目 requirement_extractor 的代码结构树）：
 * - 文件节点来自问题里出现过的文件，外加 `function_info.file_name` 指向的文件
 *   （这样即使某文件 / 某函数没有问题，也能在树里看到）；
 * - 函数节点显示该函数的问题数与已标记数；点函数可定位到它第一个问题；
 * - `function_info` 没写 `file_name` 的老报告，其函数无法归位，只在上方「函数功能概述」
 *   区块展示，不强行塞进某个文件节点（避免张冠李戴）。
 */
export function buildReviewTree(
  issues: readonly ReviewIssueView[],
  functionInfos: readonly ReviewFunctionInfo[],
  statuses: Readonly<Record<string, string>>,
): ReviewTreeFile[] {
  interface DraftFile {
    path: string;
    key: string;
    functions: Map<string, ReviewTreeFunction>;
  }
  const files = new Map<string, DraftFile>();

  const ensureFile = (path: string): DraftFile => {
    const key = normalizeReviewFilePath(path);
    const existing = files.get(key);
    if (existing) return existing;
    const created: DraftFile = { path, key, functions: new Map() };
    files.set(key, created);
    return created;
  };

  const ensureFunction = (file: DraftFile, taskId: string, name: string): ReviewTreeFunction => {
    const key = `${taskId}::${name}`;
    const existing = file.functions.get(key);
    if (existing) return existing;
    const created: ReviewTreeFunction = {
      name,
      taskId,
      problemCount: 0,
      markedCount: 0,
      firstIssueKey: null,
      firstIssueLine: null,
    };
    file.functions.set(key, created);
    return created;
  };

  // 1) 先把报告里带 file_name 的函数挂到文件下（0 问题也可见）。
  for (const info of functionInfos) {
    if (!info.fileName || !info.functionName) continue;
    ensureFunction(ensureFile(info.fileName), info.taskId, info.functionName);
  }

  // 2) 按文件聚合问题。
  for (const issue of issues) {
    const file = ensureFile(issue.file);
    const fn = ensureFunction(file, issue.taskId, issue.functionName || UNNAMED_FUNCTION);
    fn.problemCount += 1;
    if (statuses[issue.key] === "marked") fn.markedCount += 1;
    const line = issue.line !== null && Number.isFinite(issue.line) ? issue.line : null;
    const better =
      fn.firstIssueKey === null ||
      (line !== null && (fn.firstIssueLine === null || line < fn.firstIssueLine));
    if (better) {
      fn.firstIssueKey = issue.key;
      fn.firstIssueLine = line;
    }
  }

  const result: ReviewTreeFile[] = [];
  for (const file of files.values()) {
    const functions = [...file.functions.values()].sort((a, b) => {
      const la = a.firstIssueLine ?? Number.POSITIVE_INFINITY;
      const lb = b.firstIssueLine ?? Number.POSITIVE_INFINITY;
      if (la !== lb) return la - lb;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    result.push({
      path: file.path,
      key: file.key,
      name: file.key.split("/").pop() || file.key,
      problemCount: functions.reduce((sum, fn) => sum + fn.problemCount, 0),
      markedCount: functions.reduce((sum, fn) => sum + fn.markedCount, 0),
      functions,
    });
  }
  result.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return result;
}

const REVIEW_MODE_PATTERN = /^(.+)-(\w+)-review\.json$/i;

export function parseReviewFileName(fileName: string): {
  taskId: string;
  mode: ReviewMode | null;
} | null {
  const match = REVIEW_MODE_PATTERN.exec(fileName);
  if (!match) return null;
  const mode = (match[2] ?? "").toLowerCase();
  const knownMode: ReviewMode | null =
    mode === "function" || mode === "chain" || mode === "feature" ? mode : null;
  return { taskId: match[1] ?? "", mode: knownMode };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 「建议改进」等级的问题**在解析层直接丢弃**（入库、面板、导出、计数都看不到）。
 *
 * 理由：这类问题绝大多数是编码规范 / 风格 / 可读性建议（命名、注释、魔法数字、
 * 圈复杂度），对程序功能与逻辑没有实质影响，数量又极大，会把真缺陷淹没。等级提示词
 * 已同步收窄为「重要问题 / 一般问题」两级；这里再兜一层，容错历史报告、旧库数据与
 * 模型偶发产出（含英文 level 与「建议」等近义写法）。
 */
const FILTERED_SEVERITY_PATTERN =
  /^(建议改进|建议|优化建议|风格建议|可读性建议|suggestion|suggest|improvement|minor|low|info|nit)$/i;

/** 该等级是否属于「不入库、不展示」的建议类问题。 */
export function isFilteredSeverity(severity: string): boolean {
  return FILTERED_SEVERITY_PATTERN.test(severity.trim());
}

/** 归一化 description_location 里的转义换行/制表符（报告可能以 \n / \t 字面量写入）。 */
function normalizeLocationText(value: string): string {
  return value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

/** 引用源程序的分隔标记（宽容多种写法，对齐源项目 requirement_extractor）。 */
const LOCATION_SOURCE_MARKERS = ["源程序为：", "源代码为：", "源程序为:", "源代码为:"] as const;

/**
 * 拆分 description_location（`xx文件的xx函数的N行：问题语句源程序为：<代码>`）：
 * `summary` 为分隔标记前的“位置描述”正文，`source` 为其后引用的源程序，供面板按
 * **代码格式**（等宽 `pre`）渲染，而不是混在一段普通文字里。
 */
export function splitDescriptionLocation(value: string): { summary: string; source: string } {
  const normalized = normalizeLocationText(value);
  let markerIndex = -1;
  let markerLength = 0;
  for (const marker of LOCATION_SOURCE_MARKERS) {
    const index = normalized.indexOf(marker);
    if (index !== -1 && (markerIndex === -1 || index < markerIndex)) {
      markerIndex = index;
      markerLength = marker.length;
    }
  }
  if (markerIndex === -1) return { summary: normalized.trim(), source: "" };
  return {
    summary: normalized.slice(0, markerIndex).trim(),
    source: normalized.slice(markerIndex + markerLength).replace(/^\s*\n/, ""),
  };
}

/** 规范化审查文件路径（去前导 ./、反斜杠转正斜杠、去重复斜杠），问题单过滤与文件树共用。 */
export function normalizeReviewFilePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .trim();
}

/** 规范化后完全相等（目录树分组 / 选中高亮用，避免 a/b.c 与 b.c 互相误判）。 */
export function sameReviewFileExact(a: string, b: string): boolean {
  const na = normalizeReviewFilePath(a);
  const nb = normalizeReviewFilePath(b);
  return na.length > 0 && na === nb;
}

/**
 * 宽容匹配问题文件与 diff/文件树选中文件路径（忽略前导 ./ 与分隔符差异，允许一侧是
 * 另一侧的后缀）。用于报告路径与项目路径前缀不一致时的兜底。
 */
export function sameFile(a: string, b: string): boolean {
  const na = normalizeReviewFilePath(a);
  const nb = normalizeReviewFilePath(b);
  if (!na || !nb) return false;
  return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

/**
 * 按选中文件过滤问题：**优先精确匹配**（规范化后相等），一个都没有时才回退到宽容的
 * 后缀匹配。这样选中 `src/b.c` 时不会把 `b.c` 之类别的文件的问题一起带出来，同时
 * 保留「报告路径与项目路径前缀不同」时的可用性。
 */
export function filterIssuesByFile<T extends { file: string }>(
  issues: readonly T[],
  file: string,
): T[] {
  const exact = issues.filter((issue) => sameReviewFileExact(issue.file, file));
  if (exact.length > 0) return exact;
  return issues.filter((issue) => sameFile(issue.file, file));
}

/**
 * 问题是否属于目录树里的某个函数节点（点了函数节点后问题单按函数过滤用）。
 *
 * `name` 传 `UNNAMED_FUNCTION` 时匹配**没有函数名**的问题 —— 它们在树里被归到
 * 「(未命名)」分组，不能拿字符串去比。
 */
export function issueBelongsToFunction(
  issue: { functionName: string | null },
  name: string,
): boolean {
  if (name === UNNAMED_FUNCTION) return !issue.functionName;
  return issue.functionName === name;
}

/**
 * 按所属审查任务过滤问题（链路 / 功能审查的「功能模块列表」选中某一项后，其余面板
 * 一律只看该任务的结果）。`taskId` 为空 = 不过滤。
 */
export function filterIssuesByTask<T extends { taskId?: string }>(
  issues: readonly T[],
  taskId: string | null,
): T[] {
  if (!taskId) return [...issues];
  return issues.filter((issue) => issue.taskId === taskId);
}

/**
 * 问题单的显示范围过滤：**先按任务、再按功能模块、再按文件、最后按函数**
 * （都可为空 = 不过滤）。
 *
 * - 任务：链路 / 功能审查左侧「功能模块列表 / 功能列表」选中那条任务（函数审查不用）；
 * - 功能：任务内再按功能模块 id 收敛（父模块传入「自身 + 全部子模块」的 id 集合）；
 * - 文件：点文件节点只传文件（该文件全部函数的问题）；
 * - 函数：点函数节点再带上函数名（**只显示该函数的问题**，其它函数的一律不显示）。
 */
export function filterIssuesByScope<
  T extends {
    file: string;
    functionName: string | null;
    taskId?: string;
    featureId?: string | null;
  },
>(
  issues: readonly T[],
  file: string | null,
  functionName: string | null,
  taskId: string | null = null,
  featureIds: readonly string[] = [],
): T[] {
  const byTask = filterIssuesByTask(issues, taskId);
  // 功能过滤只在「选了任务 + 选了功能」时生效；没有 feature_id 的老报告自然退化为按任务。
  const byFeature =
    taskId && featureIds.length > 0
      ? byTask.filter(
          (issue) => issue.featureId != null && featureIds.includes(issue.featureId),
        )
      : byTask;
  const byFile = file ? filterIssuesByFile(byFeature, file) : byFeature;
  if (!functionName) return byFile;
  return byFile.filter((issue) => issueBelongsToFunction(issue, functionName));
}

/** 从 description_location 提取问题代码语句（“源程序为：”之前、最后一个全角冒号之后）。 */
function extractCodeStatement(descriptionLocation: string): string {
  if (!descriptionLocation) return "";
  const { summary } = splitDescriptionLocation(descriptionLocation);
  const colonIndex = summary.lastIndexOf("：");
  return colonIndex < 0 ? summary.trim() : summary.slice(colonIndex + 1).trim();
}

/**
 * 把「问题位置」收敛到**文件级**（去掉函数名与行号），对齐源项目
 * requirement_extractor 导出「问题来源」列的处理（`_extract_file_level_location`）。
 *
 * 支持三种真实写法：
 * - `xx文件的xx函数的N行：…`（description_location 式）→ `xx文件`
 * - `file::fn` / `file#fn` → `file`
 * - `file:fn` / `file:23` → `file`（仅当 `file` 看起来像带扩展名的路径时截断，
 *   以免把 Windows 盘符 `D:/…` 的冒号当成函数分隔符）
 *
 * 比源项目多处理两个点（`文件的` 前缀与 `file:fn`），因为本项目的 issue_location
 * 实际写法是 `math_utils.c:unsafe_copy`——源项目那个实现会把它原样带出函数名，
 * 与该列「文件级位置」的本意不符。
 */
export function fileLevelLocation(issueLocation: string, fileName: string): string {
  let value = (issueLocation ?? "").trim();
  const fallback = (fileName ?? "").trim();
  if (!value) return fallback;
  // description_location 式：`xx文件的xx函数的N行…` —— 取「文件的」之前的部分。
  const cjkMatch = /^(.*?)文件的/.exec(value);
  if (cjkMatch) return (cjkMatch[1] ?? "").trim() || fallback;
  for (const separator of ["::", "#"]) {
    const index = value.indexOf(separator);
    if (index !== -1) value = value.slice(0, index).trim();
  }
  const lastColon = value.lastIndexOf(":");
  if (lastColon !== -1) {
    const head = value.slice(0, lastColon).trim();
    const tail = value.slice(lastColon + 1).trim();
    if (/^\d+$/.test(tail)) value = head;
    else if (tail.length > 0 && /\.[A-Za-z0-9_]+$/.test(head) && !/\s/.test(head)) value = head;
  }
  return value || fallback;
}

/** 从 description_location 提取精确行号（xx文件的xx函数的N行） */
function extractLine(descriptionLocation: string): number | null {
  if (!descriptionLocation) return null;
  const match = /函数的(\d+)行/.exec(descriptionLocation);
  return match ? Number(match[1]) : null;
}

function parseIssue(
  value: unknown,
  taskId: string,
  mode: ReviewMode | null,
): ReviewIssueView | "filtered" | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const severity = asString(record.issue_level) || asString(record.severity) || "一般问题";
  // 建议类问题在解析层直接丢弃（见 isFilteredSeverity），先于字段校验，保证计数准确。
  if (isFilteredSeverity(severity)) return "filtered";
  const source =
    record.source && typeof record.source === "object"
      ? (record.source as Record<string, unknown>)
      : {};
  // 优先 problems[] 字段；旧 issues[] 回退到 source 结构
  const file =
    asString(record.file_name) ||
    asString(record.file) ||
    asString(source.file) ||
    asString(source.path);
  if (!file) return null;
  const id =
    asString(record.id) ||
    `${file}#${asString(record.issue_location) || asString(source.locator) || asString(record.issue_name)}`;
  const functionName =
    asString(record.function_name) ||
    asString(record.functionName) ||
    asString(source.function) ||
    asString(source.functionName) ||
    null;
  const descriptionLocation = asString(record.description_location);
  const codeStatement = extractCodeStatement(descriptionLocation);
  const line =
    extractLine(descriptionLocation) ??
    asNumber(source.line) ??
    asNumber(record.line);
  const summary =
    asString(record.issue_name) || asString(record.summary) || asString(record.description_issue);
  // description_issue 独立展示问题描述；仅当 summary 已回退到 description_issue 时不重复。
  const descriptionIssue =
    asString(record.description_issue) && summary !== asString(record.description_issue)
      ? asString(record.description_issue)
      : "";
  const suggestion = asString(record.description_requirement) || asString(record.suggestion);
  const impact = asString(record.description_impact);
  const type =
    asString(record.problem_reason) || asString(record.type) || asString(record.issue_name);
  // 与 type 同一条取值链，保留 problem_reason 原始值供详情字段展示。
  const problemReason =
    asString(record.problem_reason) || asString(record.type) || asString(record.issue_name);
  const issueLocation =
    asString(record.issue_location) || asString(source.locator) || asString(source.location);
  const sourceCode = asString(record.source_code) || asString(record.sourceCode);
  const featureId = asString(record.feature_id) || asString(record.featureId);
  const affectedFunctions =
    asString(record.affected_functions) || asString(record.affectedFunctions);
  return {
    id,
    key: `${taskId}::${id}`,
    taskId,
    mode,
    file,
    functionName,
    featureId: featureId || null,
    line,
    type,
    severity,
    summary,
    descriptionIssue,
    suggestion,
    impact,
    descriptionLocation,
    codeStatement,
    problemReason,
    issueLocation,
    sourceCode,
    affectedFunctions,
  };
}

/**
 * 宽容解析报告级 `function_info`，归一化为数组：
 * - 单函数报告里是对象 → 1 条；
 * - 批量聚合报告里是数组（每函数一条）→ N 条；
 * - 函数名与描述都为空的条目丢弃（整份报告的 function_info 都为空时得到空数组，
 *   面板仍会渲染「函数功能概述」区块并显示空态占位）。
 */
function parseFunctionInfos(
  record: Record<string, unknown>,
  taskId: string,
  mode: ReviewMode | null,
): ReviewFunctionInfo[] {
  const rawValue = record.function_info ?? record.functionInfo;
  const list = Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : [];
  const infos: ReviewFunctionInfo[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const functionName = asString(raw.function_name) || asString(raw.functionName);
    const functionDescription =
      asString(raw.function_description) || asString(raw.functionDescription);
    const fileName = asString(raw.file_name) || asString(raw.fileName);
    if (!functionName && !functionDescription) continue;
    infos.push({ taskId, mode, functionName, fileName, functionDescription });
  }
  return infos;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * 宽容解析报告级 `features`（链路=树形 `sub_features`，功能=平铺），统一归一化为
 * **平铺数组 + parentId**：树形由 `buildFeatureTree` 还原。缺失/畸形时返回空数组，
 * 面板会退化为「按审查任务列出」的兜底视图而不是空白。
 */
function parseFeatures(
  record: Record<string, unknown>,
  taskId: string,
  mode: ReviewMode | null,
): ReviewFeatureView[] {
  const raw = record.features ?? record.feature_list ?? record.featureList;
  if (!Array.isArray(raw)) return [];
  const out: ReviewFeatureView[] = [];
  const seen = new Set<string>();
  const walk = (list: readonly unknown[], parentId: string | null): void => {
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const node = entry as Record<string, unknown>;
      const id =
        asString(node.id) || asString(node.feature_id) || asString(node.featureId) || asString(node.key);
      const name =
        asString(node.name) || asString(node.feature_name) || asString(node.title);
      if (!id || !name) continue;
      const dedupeKey = `${taskId}::${id}`;
      const sub = Array.isArray(node.sub_features)
        ? node.sub_features
        : Array.isArray(node.children)
          ? node.children
          : [];
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        out.push({
          taskId,
          mode,
          id,
          name,
          section: asString(node.section),
          description: asString(node.description) || asString(node.feature_description),
          entryFunction: asString(node.entry_function) || asString(node.entryFunction),
          status: asString(node.status),
          files: uniqueStrings([...asStringArray(node.files), ...asStringArray(node.related_files)]),
          functions: uniqueStrings([
            ...asStringArray(node.functions),
            ...asStringArray(node.related_functions),
          ]),
          chainOrder: uniqueStrings([
            ...asStringArray(node.chain_order),
            ...asStringArray(node.chainOrder),
          ]),
          parentId,
        });
      }
      if (sub.length > 0) walk(sub, id);
    }
  };
  walk(raw, null);
  return out;
}

/** 宽容解析链路审查的 `callgraph`；无节点也无边时返回 null。 */
function parseCallGraph(record: Record<string, unknown>, taskId: string): ReviewCallGraph | null {
  const raw = record.callgraph ?? record.call_graph ?? record.callGraph;
  if (!raw || typeof raw !== "object") return null;
  const graph = raw as Record<string, unknown>;
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodes: ReviewCallGraphNode[] = [];
  for (const entry of rawNodes) {
    if (!entry || typeof entry !== "object") continue;
    const node = entry as Record<string, unknown>;
    const id = asString(node.id);
    if (!id) continue;
    nodes.push({
      id,
      label: asString(node.label) || id,
      type: asString(node.type) === "file" ? "file" : "function",
      file: asString(node.file),
    });
  }
  const edges: { from: string; to: string }[] = [];
  for (const entry of rawEdges) {
    if (!entry || typeof entry !== "object") continue;
    const edge = entry as Record<string, unknown>;
    const from = asString(edge.from) || asString(edge.source);
    const to = asString(edge.to) || asString(edge.target);
    if (from && to) edges.push({ from, to });
  }
  if (nodes.length === 0 && edges.length === 0) return null;
  return { taskId, nodes, edges };
}

/**
 * 把平铺的 `features` 还原成树（按 `parentId` 挂 children，保持报告里的原始顺序）。
 * 找不到父节点的模块按顶层处理（避免数据脏了就整棵树都不显示）。
 */
export function buildFeatureTree(
  features: readonly ReviewFeatureView[],
): ReviewFeatureNode[] {
  const nodes = new Map<string, ReviewFeatureNode>();
  const keyed = (feature: ReviewFeatureView) => `${feature.taskId}::${feature.id}`;
  const roots: ReviewFeatureNode[] = [];
  for (const feature of features) {
    nodes.set(keyed(feature), { ...feature, children: [] });
  }
  for (const feature of features) {
    const node = nodes.get(keyed(feature));
    if (!node) continue;
    const parent = feature.parentId ? nodes.get(`${feature.taskId}::${feature.parentId}`) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** 收集某个功能模块及其全部子模块的 id（选中父模块 = 连同子树一起收敛）。 */
export function collectFeatureIds(feature: ReviewFeatureNode): string[] {
  const ids: string[] = [];
  const walk = (node: ReviewFeatureNode): void => {
    ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(feature);
  return ids;
}

/**
 * 按功能模块收敛问题：命中 `featureId` 之一、且属于该任务的问题。
 * `ids` 为空 = 不过滤（保持「全部」语义）。
 */
export function filterIssuesByFeatureIds<
  T extends { taskId: string; featureId: string | null },
>(issues: readonly T[], taskId: string, ids: readonly string[]): T[] {
  if (ids.length === 0) return [...issues];
  const wanted = new Set(ids);
  return issues.filter(
    (issue) => issue.taskId === taskId && issue.featureId !== null && wanted.has(issue.featureId),
  );
}

/** 收集某个功能模块及其全部子模块声明的文件（去重）。 */
export function collectFeatureFiles(feature: ReviewFeatureNode): string[] {
  const files: string[] = [];
  const walk = (node: ReviewFeatureNode): void => {
    files.push(...node.files);
    for (const child of node.children) walk(child);
  };
  walk(feature);
  return uniqueStrings(files);
}

/** 收集某个功能模块及其全部子模块声明的函数名（去重）。 */
export function collectFeatureFunctions(feature: ReviewFeatureNode): string[] {
  const names: string[] = [];
  const walk = (node: ReviewFeatureNode): void => {
    names.push(...node.functions);
    for (const child of node.children) walk(child);
  };
  walk(feature);
  return uniqueStrings(names);
}

/**
 * 按选中的功能模块收敛问题（UI 层用）：
 * 1. 优先按 `feature_id` 命中（`featureIds` = 选中模块及其全部子模块的 id）；
 * 2. 报告没填 `feature_id` 时，退化为按该模块声明的 `files` / `functions` 命中 ——
 *    旧报告（或 agent 未填 feature_id）也能得到有意义的结果，而不是一片空白。
 */
export function filterIssuesToFeature<
  T extends { file: string; functionName: string | null; featureId: string | null },
>(
  issues: readonly T[],
  feature: { featureIds: readonly string[]; files: readonly string[]; functions: readonly string[] },
): T[] {
  const ids = new Set(feature.featureIds);
  const byId = issues.filter((issue) => issue.featureId !== null && ids.has(issue.featureId));
  if (byId.length > 0) return byId;
  const files = feature.files.map(normalizeReviewFilePath).filter((file) => file.length > 0);
  const functions = new Set(feature.functions);
  if (files.length === 0 && functions.size === 0) return [];
  return issues.filter(
    (issue) =>
      files.some((file) => sameReviewFileExact(issue.file, file)) ||
      (issue.functionName !== null && functions.has(issue.functionName)),
  );
}

/**
 * 链路顺序角标文案：0 → A，1 → B，…，25 → Z，26 → AA（对齐源项目目录树里的 A/B/C 角标）。
 */
export function chainOrderLabel(index: number): string {
  if (!Number.isFinite(index) || index < 0) return "";
  let n = Math.floor(index);
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** 链路顺序查表：函数名 → 角标下标（同名的取最靠前的一个）。 */
export function chainOrderIndex(order: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  order.forEach((name, index) => {
    if (name && !map.has(name)) map.set(name, index);
  });
  return map;
}

export function parseReviewFile(
  text: string | null | undefined,
  fileName: string,
): ReviewReport | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const { taskId, mode } = parseReviewFileName(fileName) ?? { taskId: fileName, mode: null };
  const problemSource = Array.isArray(record.problems)
    ? record.problems
    : Array.isArray(record.issues)
      ? record.issues
      : [];
  const functionInfos = parseFunctionInfos(record, taskId, mode);
  const features = parseFeatures(record, taskId, mode);
  const callgraph = parseCallGraph(record, taskId);
  const issues: ReviewIssueView[] = [];
  let filteredCount = 0;
  for (const entry of problemSource) {
    const parsed = parseIssue(entry, taskId, mode);
    if (parsed === "filtered") {
      filteredCount += 1;
    } else if (parsed) {
      issues.push(parsed);
    }
  }
  const scope =
    record.scope && typeof record.scope === "object"
      ? (record.scope as Record<string, unknown>)
      : {};
  const scopeMode =
    typeof scope.mode === "string" && scope.mode.length > 0 ? scope.mode : null;
  return {
    schemaVersion:
      typeof record.version === "number" ? record.version : typeof record.schemaVersion === "number" ? record.schemaVersion : 1,
    mode: mode ?? (scopeMode === "function" || scopeMode === "chain" || scopeMode === "feature" ? scopeMode : null),
    taskId,
    fileName,
    issues,
    functionInfos,
    features,
    callgraph,
    filteredCount,
  };
}

/** 审查进度，供前端进度条渲染（由 skill 写入 reviews/<taskId>-<mode>-progress.json）。 */
export interface ReviewProgress {
  taskId: string;
  mode: ReviewMode | null;
  status: "running" | "done" | "paused" | null;
  total: number;
  done: number;
  batchSize: number | null;
  currentFile: string | null;
  currentFunction: string | null;
  issuesInBatch: number | null;
  accumulatedIssues: number | null;
  overBudget: boolean | null;
  updatedAt: string | null;
}

const PROGRESS_MODE_PATTERN = /^(.+)-(\w+)-progress\.json$/i;

export function parseProgressFileName(fileName: string): {
  taskId: string;
  mode: ReviewMode | null;
} | null {
  const match = PROGRESS_MODE_PATTERN.exec(fileName);
  if (!match) return null;
  const mode = (match[2] ?? "").toLowerCase();
  const knownMode: ReviewMode | null =
    mode === "function" || mode === "chain" || mode === "feature" ? mode : null;
  return { taskId: match[1] ?? "", mode: knownMode };
}

/** 宽容解析进度文件：字段缺失/畸形返回 null 而非抛错。 */
export function parseProgressFile(
  text: string | null | undefined,
  fileName: string,
): ReviewProgress | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const { taskId, mode } = parseProgressFileName(fileName) ?? { taskId: fileName, mode: null };
  const statusRaw = typeof record.status === "string" ? record.status : "";
  const status: ReviewProgress["status"] =
    statusRaw === "running" || statusRaw === "done" || statusRaw === "paused"
      ? statusRaw
      : null;
  const total = asNumber(record.total) ?? 0;
  const done = asNumber(record.done) ?? 0;
  return {
    taskId,
    mode,
    status,
    total,
    done,
    batchSize: asNumber(record.batchSize),
    currentFile: asString(record.currentFile) || null,
    currentFunction: asString(record.currentFunction) || null,
    issuesInBatch: asNumber(record.issuesInBatch),
    accumulatedIssues: asNumber(record.accumulatedIssues),
    overBudget: typeof record.overBudget === "boolean" ? record.overBudget : null,
    updatedAt: asString(record.updatedAt) || null,
  };
}

/** 回归审查的单文件变更状态。 */
export type RegressionFileStatus = "modified" | "added" | "deleted";

/** 回归审查中的单个变更文件，供前端 DiffEditor 渲染。 */
export interface RegressionDiffFile {
  path: string;
  status: RegressionFileStatus;
  /** 基线（变更前）完整文件文本；新增文件为 null。 */
  left: string | null;
  /** 变更后完整文件文本；删除文件为 null。 */
  right: string | null;
}

/** 回归审查的差异数据报告（`<taskId>-regression-diff.json`）。 */
export interface RegressionDiffReport {
  schemaVersion: number;
  taskId: string;
  fileName: string;
  leftPath: string | null;
  rightPath: string | null;
  updatedAt: string | null;
  changedFiles: readonly RegressionDiffFile[];
}

const REGRESSION_DIFF_NAME_PATTERN = /^(.+)-regression-diff\.json$/i;

export function parseRegressionDiffFileName(fileName: string): { taskId: string } | null {
  const match = REGRESSION_DIFF_NAME_PATTERN.exec(fileName);
  if (!match) return null;
  return { taskId: match[1] ?? "" };
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseRegressionDiffFileEntry(value: unknown): RegressionDiffFile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const path = asString(record.path);
  if (!path) return null;
  const statusRaw = typeof record.status === "string" ? record.status : "";
  const status: RegressionFileStatus =
    statusRaw === "added" || statusRaw === "deleted" ? statusRaw : "modified";
  const left = asOptionalString(record.left);
  const right = asOptionalString(record.right);
  if (left === null && right === null) return null;
  return { path, status, left, right };
}

/** 宽容解析回归差异文件：字段缺失/畸形返回 null 而非抛错。 */
export function parseRegressionDiffFile(
  text: string | null | undefined,
  fileName: string,
): RegressionDiffReport | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const taskId = parseRegressionDiffFileName(fileName)?.taskId ?? fileName;
  const changedFiles = Array.isArray(record.changedFiles)
    ? record.changedFiles
        .map((entry) => parseRegressionDiffFileEntry(entry))
        .filter((entry): entry is RegressionDiffFile => entry !== null)
    : [];
  return {
    schemaVersion:
      typeof record.version === "number"
        ? record.version
        : typeof record.schemaVersion === "number"
          ? record.schemaVersion
          : 1,
    taskId,
    fileName,
    leftPath: asOptionalString(record.leftPath),
    rightPath: asOptionalString(record.rightPath),
    updatedAt: asOptionalString(record.updatedAt),
    changedFiles,
  };
}
