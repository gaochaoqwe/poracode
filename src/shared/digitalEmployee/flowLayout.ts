/**
 * 数字员工系统 · 模拟公司电脑文件夹 —— 布局解析
 *
 * 顶层分三大类：测试项目 / 开发项目 / 办公项目，各类下分年份目录。
 *
 * - 测试项目：`<年>/<状态目录>/<软件类型>[/<子类>]/<项目名>/P0~P14`
 *   - 状态目录：未开展 / 进行中 / 已完成
 *   - 软件类型十类：一~八类下再分子类（1光雷/2吊舱/3转塔/4告警/5地防），
 *     九外部测试、十搜潜直接按项目名分层。
 * - 开发项目：`<年>/<项目名>`，无状态层、无 P 流程。
 * - 办公项目：`<年>/<状态目录>/<分类>/`，分类如 分类1（中心项目）等。
 *
 * 本模块只做纯路径构造与解析（跨平台使用 posix 分隔符统一建模，
 * Windows 下由调用方转换为本地路径；内部解析兼容 `/` 与 `\`）。
 */

import { isProjectLifecycleState, type ProjectLifecycleState } from "./flowTypes";

/** 顶层三大类目录名 */
export const TOP_LEVEL_DIRS = ["测试项目", "开发项目", "办公项目"] as const;
export type TopLevelDir = (typeof TOP_LEVEL_DIRS)[number];

/**
 * 模拟公司电脑文件夹根目录（v9 组织种子的授权目录基准，也是文件系统
 * 驱动的扫描根）。PLACEHOLDER 路径 —— 用户按自己的真实目录布局调整；
 * supervisor 侧可用环境变量 `AGENTEMPLOYEE_SIMULATED_FS_ROOT` 覆盖。
 */
export const SIMULATED_FS_ROOT = "E:\\code\\github\\poracode\\模拟公司电脑文件夹";

/** 测试项目软件类型：一~八类含 5 个子类；九、十类直接按项目名分。 */
export interface TestProjectType {
  name: string;
  /** 子类目录名；空数组表示该类型直接按项目名分层。 */
  subTypes: readonly string[];
}

export const TEST_PROJECT_TYPES: readonly TestProjectType[] = [
  { name: "一系统控制类", subTypes: ["1光雷", "2吊舱", "3转塔", "4告警", "5地防"] },
  { name: "二随动控制类", subTypes: ["1光雷", "2吊舱", "3转塔", "4告警", "5地防"] },
  { name: "三图像处理类", subTypes: ["1光雷", "2吊舱", "3转塔", "4告警", "5地防"] },
  { name: "四温补调焦类", subTypes: ["1光雷", "2吊舱", "3转塔", "4告警", "5地防"] },
  { name: "五激光类", subTypes: ["1光雷", "2吊舱", "3转塔", "4告警", "5地防"] },
  { name: "六红外类", subTypes: ["1光雷", "2吊舱", "3转塔", "4告警", "5地防"] },
  { name: "七手柄类", subTypes: ["1光雷", "2吊舱", "3转塔", "4告警", "5地防"] },
  { name: "八分色滤光类", subTypes: ["1光雷", "2吊舱", "3转塔", "4告警", "5地防"] },
  { name: "九外部测试", subTypes: [] },
  { name: "十搜潜", subTypes: [] },
];

export const TEST_PROJECT_SUB_TYPES: readonly string[] = [
  "1光雷",
  "2吊舱",
  "3转塔",
  "4告警",
  "5地防",
];

/** 办公项目分类目录名 */
export const OFFICE_PROJECT_CATEGORIES = [
  "分类1（中心项目）",
  "分类2（部门项目）",
  "分类3",
] as const;

/** 测试项目的「类型」是否有子类层。 */
export function testTypeHasSubTypes(typeName: string): boolean {
  return TEST_PROJECT_TYPES.some((type) => type.name === typeName && type.subTypes.length > 0);
}

/** 测试项目类型目录是否合法。 */
export function isTestProjectType(typeName: string): boolean {
  return TEST_PROJECT_TYPES.some((type) => type.name === typeName);
}

/** 测试项目子类目录是否合法。 */
export function isTestProjectSubType(subType: string): boolean {
  return (TEST_PROJECT_SUB_TYPES as readonly string[]).includes(subType);
}

function join(parts: readonly string[]): string {
  return parts.filter(Boolean).join("/");
}

// ── 测试项目路径构造 ────────────────────────────────────────────────

/** 测试项目根：`测试项目/<年>`。 */
export function testProjectYearDir(fsRoot: string, year: string): string {
  return join([fsRoot, "测试项目", year]);
}

/** 测试项目状态目录：`测试项目/<年>/<状态>`。 */
export function testProjectStateDir(
  fsRoot: string,
  year: string,
  state: ProjectLifecycleState,
): string {
  return join([fsRoot, "测试项目", year, state]);
}

/** 测试项目类型目录（一~八类类型层或九/十类项目层）：`.../<状态>/<类型>`。 */
export function testProjectTypeDir(
  fsRoot: string,
  year: string,
  state: ProjectLifecycleState,
  typeName: string,
): string {
  return join([fsRoot, "测试项目", year, state, typeName]);
}

/** 测试项目子类目录：`.../<类型>/<子类>`。 */
export function testProjectSubTypeDir(
  fsRoot: string,
  year: string,
  state: ProjectLifecycleState,
  typeName: string,
  subType: string,
): string {
  return join([fsRoot, "测试项目", year, state, typeName, subType]);
}

/**
 * 测试项目目录：`测试项目/<年>/<状态>/<类型>[/<子类>]/<项目名>`。
 * 一~八类带子类层；九、十类不带。
 */
export function testProjectDir(
  fsRoot: string,
  year: string,
  state: ProjectLifecycleState,
  typeName: string,
  projectName: string,
  subType?: string,
): string {
  const typePart = testTypeHasSubTypes(typeName) && subType ? `${typeName}/${subType}` : typeName;
  return join([fsRoot, "测试项目", year, state, typePart, projectName]);
}

// ── 开发 / 办公项目路径构造 ────────────────────────────────────────

/** 开发项目目录：`开发项目/<年>[/<项目名>]`。 */
export function devProjectDir(fsRoot: string, year: string, projectName?: string): string {
  return join([fsRoot, "开发项目", year, projectName ?? ""]);
}

/** 办公项目状态目录：`办公项目/<年>/<状态>`。 */
export function officeProjectStateDir(
  fsRoot: string,
  year: string,
  state: ProjectLifecycleState,
): string {
  return join([fsRoot, "办公项目", year, state]);
}

/** 办公项目分类目录：`办公项目/<年>/<状态>/<分类>`。 */
export function officeProjectCategoryDir(
  fsRoot: string,
  year: string,
  state: ProjectLifecycleState,
  category: string,
): string {
  return join([fsRoot, "办公项目", year, state, category]);
}

// ── 测试项目路径解析 ────────────────────────────────────────────────

/** 一次测试项目路径解析的结果。 */
export interface ParsedTestProjectPath {
  /** 文件系统根目录（原样回显）。 */
  fsRoot: string;
  year: string;
  state: ProjectLifecycleState;
  typeName: string;
  /** 一~八类时为子类名；九/十类为 undefined。 */
  subType?: string | undefined;
  projectName: string;
}

/**
 * 解析测试项目目录路径。
 * 兼容 `/` 与 `\` 分隔符；`fsRoot` 可以是任意前缀（如 `E:/code/github/模拟公司电脑文件夹`）。
 * 要求路径形如 `<fsRoot>/测试项目/<年>/<状态>/<类型>[/<子类>]/<项目名>`。
 * 非测试项目路径或结构不合法返回 null。
 */
export function parseTestProjectPath(path: string): ParsedTestProjectPath | null {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);

  // 找到「测试项目」段的位置
  const markerIndex = segments.indexOf("测试项目");
  if (markerIndex < 0) return null;
  const after = segments.slice(markerIndex + 1);
  if (after.length < 4) return null; // 年/状态/类型/项目名 至少 4 段

  const [year, state, typeName, ...rest] = after;
  if (!isProjectLifecycleState(state!)) return null;
  if (!isTestProjectType(typeName!)) return null;

  if (testTypeHasSubTypes(typeName!)) {
    if (rest.length < 2) return null;
    const [subType, projectName] = rest as [string, string];
    if (!isTestProjectSubType(subType)) return null;
    return {
      fsRoot: segments.slice(0, markerIndex).join("/"),
      year: year!,
      state,
      typeName: typeName!,
      subType,
      projectName,
    };
  }

  if (rest.length < 1) return null;
  return {
    fsRoot: segments.slice(0, markerIndex).join("/"),
    year: year!,
    state,
    typeName: typeName!,
    projectName: rest[0]!,
  };
}
