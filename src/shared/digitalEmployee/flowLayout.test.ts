import { describe, expect, it } from "vitest";
import {
  devProjectDir,
  officeProjectCategoryDir,
  officeProjectStateDir,
  parseTestProjectPath,
  testProjectDir,
  testProjectStateDir,
  testProjectSubTypeDir,
  testProjectTypeDir,
  testProjectYearDir,
  TEST_PROJECT_TYPES,
  isTestProjectSubType,
  isTestProjectType,
} from "./flowLayout";

const FS_ROOT = "E:/code/github/poracode/模拟公司电脑文件夹";

describe("测试项目路径构造", () => {
  it("构造年份/状态/类型/子类/项目路径", () => {
    expect(testProjectYearDir(FS_ROOT, "2026")).toBe(`${FS_ROOT}/测试项目/2026`);
    expect(testProjectStateDir(FS_ROOT, "2026", "未开展")).toBe(`${FS_ROOT}/测试项目/2026/未开展`);
    expect(testProjectTypeDir(FS_ROOT, "2026", "进行中", "一系统控制类")).toBe(
      `${FS_ROOT}/测试项目/2026/进行中/一系统控制类`,
    );
    expect(testProjectSubTypeDir(FS_ROOT, "2026", "进行中", "一系统控制类", "1光雷")).toBe(
      `${FS_ROOT}/测试项目/2026/进行中/一系统控制类/1光雷`,
    );
  });

  it("一~八类带子类层，九/十类不带", () => {
    expect(
      testProjectDir(FS_ROOT, "2026", "未开展", "一系统控制类", "项目A", "1光雷"),
    ).toBe(`${FS_ROOT}/测试项目/2026/未开展/一系统控制类/1光雷/项目A`);
    expect(testProjectDir(FS_ROOT, "2026", "未开展", "九外部测试", "项目B")).toBe(
      `${FS_ROOT}/测试项目/2026/未开展/九外部测试/项目B`,
    );
  });

  it("类型表包含十类且一~八类含五子类", () => {
    expect(TEST_PROJECT_TYPES).toHaveLength(10);
    expect(isTestProjectType("十搜潜")).toBe(true);
    expect(isTestProjectSubType("5地防")).toBe(true);
    expect(isTestProjectSubType("其他")).toBe(false);
  });
});

describe("开发/办公项目路径构造", () => {
  it("开发项目无状态层", () => {
    expect(devProjectDir(FS_ROOT, "2026", "数字员工")).toBe(
      `${FS_ROOT}/开发项目/2026/数字员工`,
    );
  });

  it("办公项目按状态 + 分类", () => {
    expect(officeProjectStateDir(FS_ROOT, "2026", "未开展")).toBe(
      `${FS_ROOT}/办公项目/2026/未开展`,
    );
    expect(officeProjectCategoryDir(FS_ROOT, "2026", "进行中", "分类1（中心项目）")).toBe(
      `${FS_ROOT}/办公项目/2026/进行中/分类1（中心项目）`,
    );
  });
});

describe("parseTestProjectPath", () => {
  it("解析一~八类项目（带子类）", () => {
    const parsed = parseTestProjectPath(
      `${FS_ROOT}/测试项目/2026/未开展/一系统控制类/1光雷/项目A`,
    );
    expect(parsed).toEqual({
      fsRoot: FS_ROOT,
      year: "2026",
      state: "未开展",
      typeName: "一系统控制类",
      subType: "1光雷",
      projectName: "项目A",
    });
  });

  it("解析九/十类项目（无子类）", () => {
    const parsed = parseTestProjectPath(
      `${FS_ROOT}/测试项目/2026/未开展/九外部测试/示例项目-A配置项测试`,
    );
    expect(parsed).toEqual({
      fsRoot: FS_ROOT,
      year: "2026",
      state: "未开展",
      typeName: "九外部测试",
      projectName: "示例项目-A配置项测试",
      subType: undefined,
    });
  });

  it("兼容 Windows 反斜杠路径", () => {
    const parsed = parseTestProjectPath(
      `${FS_ROOT}\\测试项目\\2026\\进行中\\二随动控制类\\2吊舱\\项目B`,
    );
    expect(parsed?.year).toBe("2026");
    expect(parsed?.state).toBe("进行中");
    expect(parsed?.subType).toBe("2吊舱");
    expect(parsed?.projectName).toBe("项目B");
  });

  it("拒绝非测试项目路径与非法结构", () => {
    expect(parseTestProjectPath(`${FS_ROOT}/开发项目/2026/项目X`)).toBeNull();
    expect(parseTestProjectPath(`${FS_ROOT}/测试项目/2026/其他状态/一系统控制类/1光雷/项目A`)).toBeNull();
    expect(parseTestProjectPath(`${FS_ROOT}/测试项目/2026/未开展/未知类型/项目A`)).toBeNull();
    expect(parseTestProjectPath(`${FS_ROOT}/测试项目/2026/未开展/一系统控制类/未知子类/项目A`)).toBeNull();
    expect(parseTestProjectPath(`${FS_ROOT}/测试项目/2026/未开展/一系统控制类/1光雷`)).toBeNull();
  });
});
