import { describe, expect, it } from "vitest";
import {
  COMPLETED_PROJECT_DIRS,
  devProjectDir,
  isTestProjectSubType,
  isTestProjectType,
  officeProjectCategoryDir,
  officeProjectStateDir,
  P0_APPLICATION_DIRS,
  parseTestProjectPath,
  testProjectDir,
  testProjectStateDir,
  testProjectSubTypeDir,
  testProjectTypeDir,
  testProjectYearDir,
  TEST_PROJECT_TYPES,
  UNSTARTED_PROJECT_DIRS,
} from "./flowLayout";

const FS_ROOT = "E:/code/github/poracode/模拟公司电脑文件夹";

describe("测试项目路径构造（三态结构）", () => {
  it("构造年份/状态目录", () => {
    expect(testProjectYearDir(FS_ROOT, "2026")).toBe(`${FS_ROOT}/测试项目/2026`);
    expect(testProjectStateDir(FS_ROOT, "2026", "未开展")).toBe(`${FS_ROOT}/测试项目/2026/未开展`);
  });

  it("未开展 / 进行中：不按软件类型分层，直接按项目名", () => {
    // typeName 参数对未开展/进行中无效，传任意值都返回「状态/项目名」
    expect(testProjectDir(FS_ROOT, "2026", "未开展", "一系统控制类", "示例项目-A配置项测试")).toBe(
      `${FS_ROOT}/测试项目/2026/未开展/示例项目-A配置项测试`,
    );
    expect(testProjectDir(FS_ROOT, "2026", "进行中", "九外部测试", "示例项目-A配置项测试")).toBe(
      `${FS_ROOT}/测试项目/2026/进行中/示例项目-A配置项测试`,
    );
  });

  it("已完成：先按软件类型分，再按子类分，最后按项目名", () => {
    expect(testProjectTypeDir(FS_ROOT, "2026", "已完成", "一系统控制类")).toBe(
      `${FS_ROOT}/测试项目/2026/已完成/一系统控制类`,
    );
    expect(
      testProjectSubTypeDir(FS_ROOT, "2026", "已完成", "一系统控制类", "一光雷"),
    ).toBe(`${FS_ROOT}/测试项目/2026/已完成/一系统控制类/一光雷`);
    expect(
      testProjectDir(FS_ROOT, "2026", "已完成", "一系统控制类", "项目A", "一光雷"),
    ).toBe(`${FS_ROOT}/测试项目/2026/已完成/一系统控制类/一光雷/项目A`);
  });

  it("已完成：九/十类不带子类层", () => {
    expect(testProjectDir(FS_ROOT, "2026", "已完成", "九外部测试", "项目B")).toBe(
      `${FS_ROOT}/测试项目/2026/已完成/九外部测试/项目B`,
    );
  });

  it("类型表包含十类、一~八类含五子类（汉语大写数字）", () => {
    expect(TEST_PROJECT_TYPES).toHaveLength(10);
    expect(isTestProjectType("十搜潜")).toBe(true);
    expect(isTestProjectSubType("一光雷")).toBe(true);
    expect(isTestProjectSubType("五地防")).toBe(true);
    expect(isTestProjectSubType("1光雷")).toBe(false);
    expect(isTestProjectSubType("其他")).toBe(false);
  });

  it("三态项目内部结构常量", () => {
    expect(UNSTARTED_PROJECT_DIRS).toEqual(["1组织资产", "2参考项目资料", "3本项目资料"]);
    expect(P0_APPLICATION_DIRS).toEqual(["组织资产", "参考资料", "本项目资料"]);
    expect(COMPLETED_PROJECT_DIRS).toEqual(["1测试申请文件", "2测试过程文件", "3测试结果文件"]);
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
  it("解析未开展项目（直接按项目名，无类型层）", () => {
    const parsed = parseTestProjectPath(
      `${FS_ROOT}/测试项目/2026/未开展/示例项目-A配置项测试`,
    );
    expect(parsed).toEqual({
      fsRoot: FS_ROOT,
      year: "2026",
      state: "未开展",
      projectName: "示例项目-A配置项测试",
    });
  });

  it("解析进行中项目（直接按项目名，无类型层）", () => {
    const parsed = parseTestProjectPath(`${FS_ROOT}/测试项目/2026/进行中/示例项目-A配置项测试`);
    expect(parsed).toEqual({
      fsRoot: FS_ROOT,
      year: "2026",
      state: "进行中",
      projectName: "示例项目-A配置项测试",
    });
  });

  it("解析已完成项目（一~八类带子类）", () => {
    const parsed = parseTestProjectPath(
      `${FS_ROOT}/测试项目/2026/已完成/一系统控制类/一光雷/项目A`,
    );
    expect(parsed).toEqual({
      fsRoot: FS_ROOT,
      year: "2026",
      state: "已完成",
      typeName: "一系统控制类",
      subType: "一光雷",
      projectName: "项目A",
    });
  });

  it("解析已完成项目（九/十类无子类）", () => {
    const parsed = parseTestProjectPath(`${FS_ROOT}/测试项目/2026/已完成/九外部测试/项目B`);
    expect(parsed).toEqual({
      fsRoot: FS_ROOT,
      year: "2026",
      state: "已完成",
      typeName: "九外部测试",
      projectName: "项目B",
    });
  });

  it("兼容 Windows 反斜杠路径", () => {
    const parsed = parseTestProjectPath(
      `${FS_ROOT}\\测试项目\\2026\\已完成\\二随动控制类\\二吊舱\\项目C`,
    );
    expect(parsed?.year).toBe("2026");
    expect(parsed?.state).toBe("已完成");
    expect(parsed?.typeName).toBe("二随动控制类");
    expect(parsed?.subType).toBe("二吊舱");
    expect(parsed?.projectName).toBe("项目C");
  });

  it("拒绝非测试项目路径与非法结构", () => {
    expect(parseTestProjectPath(`${FS_ROOT}/开发项目/2026/项目X`)).toBeNull();
    expect(parseTestProjectPath(`${FS_ROOT}/测试项目/2026/其他状态/项目A`)).toBeNull();
    // 未开展/进行中不允许类型层（多出一层即非法）
    expect(
      parseTestProjectPath(`${FS_ROOT}/测试项目/2026/未开展/一系统控制类/项目A`),
    ).toBeNull();
    expect(parseTestProjectPath(`${FS_ROOT}/测试项目/2026/进行中/九外部测试/项目A`)).toBeNull();
    // 已完成：未知类型 / 未知子类 / 缺项目名
    expect(
      parseTestProjectPath(`${FS_ROOT}/测试项目/2026/已完成/未知类型/一光雷/项目A`),
    ).toBeNull();
    expect(
      parseTestProjectPath(`${FS_ROOT}/测试项目/2026/已完成/一系统控制类/未知子类/项目A`),
    ).toBeNull();
    expect(parseTestProjectPath(`${FS_ROOT}/测试项目/2026/已完成/一系统控制类/一光雷`)).toBeNull();
  });
});
