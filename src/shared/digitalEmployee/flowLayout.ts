/**
 * 数字员工系统 · 模拟公司电脑文件夹 —— 布局解析
 *
 * 顶层分三大类：测试项目 / 开发项目 / 办公项目，各类下分年份目录。
 *
 * - 测试项目（三态结构不同）：
 *   - 未开展：`<年>/未开展/<项目名>/`，不按软件类型分层，直接按项目名；
 *     项目文件夹内含测试主管准备的 `1组织资产 / 2参考项目资料 / 3本项目资料`
 *     三个文件夹（见 `UNSTARTED_PROJECT_DIRS`）。
 *   - 进行中：`<年>/进行中/<项目名>/`，同样直接按项目名分层；项目内部按
 *     P0~P14 建子目录（P0-测试申请文件 内含 组织资产/参考资料/本项目资料，
 *     见 `P0_APPLICATION_DIRS`）。
 *   - 已完成：`<年>/已完成/<软件类型>[/<子类>]/<项目名>/`，先按软件类型分、
 *     再按产品（子类）分、最后按项目名分；项目文件夹内含
 *     `1测试申请文件 / 2测试过程文件 / 3测试结果文件`（见
 *     `COMPLETED_PROJECT_DIRS`）。一~八类下再分子类（一光雷/二吊舱/三转塔/
 *     四告警/五地防），九外部测试、十搜潜直接按项目名分层。
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
  { name: "一系统控制类", subTypes: ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"] },
  { name: "二随动控制类", subTypes: ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"] },
  { name: "三图像处理类", subTypes: ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"] },
  { name: "四温补调焦类", subTypes: ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"] },
  { name: "五激光类", subTypes: ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"] },
  { name: "六红外类", subTypes: ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"] },
  { name: "七手柄类", subTypes: ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"] },
  { name: "八分色滤光类", subTypes: ["一光雷", "二吊舱", "三转塔", "四告警", "五地防"] },
  { name: "九外部测试", subTypes: [] },
  { name: "十搜潜", subTypes: [] },
];

/** 一~八类的五个产品子类目录名（汉语大写数字，与软件类型「一~八类」写法一致）。 */
export const TEST_PROJECT_SUB_TYPES: readonly string[] = [
  "一光雷",
  "二吊舱",
  "三转塔",
  "四告警",
  "五地防",
];

/** 未开展项目的准备文件夹（测试主管在项目开始前准备）：`1组织资产 / 2参考项目资料 / 3本项目资料`。 */
export const UNSTARTED_PROJECT_DIRS: readonly string[] = [
  "1组织资产",
  "2参考项目资料",
  "3本项目资料",
];

/** P0-测试申请文件 内含的三个子目录。 */
export const P0_APPLICATION_DIRS: readonly string[] = ["组织资产", "参考资料", "本项目资料"];

/** 已完成项目文件夹内含的三个文件夹。 */
export const COMPLETED_PROJECT_DIRS: readonly string[] = [
  "1测试申请文件",
  "2测试过程文件",
  "3测试结果文件",
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

/**
 * 测试项目类型目录（仅「已完成」使用）：`已完成/<类型>`。
 * 未开展 / 进行中 不按软件类型分层，本函数不适用。
 */
export function testProjectTypeDir(
  fsRoot: string,
  year: string,
  state: ProjectLifecycleState,
  typeName: string,
): string {
  return join([fsRoot, "测试项目", year, state, typeName]);
}

/**
 * 测试项目子类目录（仅「已完成」使用）：`已完成/<类型>/<子类>`。
 * 未开展 / 进行中 不按软件类型分层，本函数不适用。
 */
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
 * 测试项目目录：
 * - 未开展 / 进行中：`测试项目/<年>/<状态>/<项目名>`（不按软件类型分层，
 *   `typeName` / `subType` 参数被忽略）；
 * - 已完成：`测试项目/<年>/已完成/<类型>[/<子类>]/<项目名>`，
 *   一~八类带子类层；九、十类不带。
 */
export function testProjectDir(
  fsRoot: string,
  year: string,
  state: ProjectLifecycleState,
  typeName: string,
  projectName: string,
  subType?: string,
): string {
  if (state === "已完成") {
    const typePart = testTypeHasSubTypes(typeName) && subType ? `${typeName}/${subType}` : typeName;
    return join([fsRoot, "测试项目", year, state, typePart, projectName]);
  }
  return join([fsRoot, "测试项目", year, state, projectName]);
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
  /** 仅「已完成」项目有软件类型；未开展/进行中为 undefined。 */
  typeName?: string | undefined;
  /** 仅「已完成」项目一~八类有子类；九/十类与未开展/进行中为 undefined。 */
  subType?: string | undefined;
  projectName: string;
}

/**
 * 解析测试项目目录路径。
 * 兼容 `/` 与 `\` 分隔符；`fsRoot` 可以是任意前缀（如 `E:/code/github/模拟公司电脑文件夹`）。
 * - 未开展 / 进行中：`<fsRoot>/测试项目/<年>/<状态>/<项目名>`（恰好一层项目名）；
 * - 已完成：`<fsRoot>/测试项目/<年>/已完成/<类型>[/<子类>]/<项目名>`。
 * 非测试项目路径或结构不合法返回 null。
 */
export function parseTestProjectPath(path: string): ParsedTestProjectPath | null {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);

  // 找到「测试项目」段的位置
  const markerIndex = segments.indexOf("测试项目");
  if (markerIndex < 0) return null;
  const after = segments.slice(markerIndex + 1);
  if (after.length < 3) return null; // 年/状态/项目名 至少 3 段

  const [year, state, ...rest] = after as [string, string, ...string[]];
  if (!isProjectLifecycleState(state)) return null;

  if (state === "已完成") {
    if (rest.length < 2) return null;
    const [typeName, ...tail] = rest as [string, ...string[]];
    if (!isTestProjectType(typeName)) return null;
    if (testTypeHasSubTypes(typeName)) {
      if (tail.length !== 2) return null;
      const [subType, projectName] = tail as [string, string];
      if (!isTestProjectSubType(subType)) return null;
      return {
        fsRoot: segments.slice(0, markerIndex).join("/"),
        year,
        state,
        typeName,
        subType,
        projectName,
      };
    }
    if (tail.length !== 1) return null;
    return {
      fsRoot: segments.slice(0, markerIndex).join("/"),
      year,
      state,
      typeName,
      projectName: tail[0]!,
    };
  }

  // 未开展 / 进行中：直接按项目名（恰好一层）
  if (rest.length !== 1) return null;
  return {
    fsRoot: segments.slice(0, markerIndex).join("/"),
    year,
    state,
    projectName: rest[0]!,
  };
}
