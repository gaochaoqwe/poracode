/**
 * 数字员工系统 · 身份档案（shared）
 *
 * 为组织种子（organizationSeed.ts）的每个岗位提供一层「人设」身份：
 * 姓名、工号、岗位、部门、职级、人物简介、形象动作、性格、像素风配色、
 * 座右铭与头像文件。头像文件相对 `docs/数字员工身份系统/avatars/` 存放。
 *
 * 工号规则：
 *  - M-00X：管理团队（mgmt-team，永久员工）
 *  - T-1XX：测试执行团队（org-test-team，项目制临时工）
 */

export interface EmployeeIdentity {
  /** 关联 organizationSeed 的角色 id（org-chief-steward 等）。 */
  roleId: string;
  /** 工号，如 "M-001"。 */
  employeeNo: string;
  /** 姓名。 */
  name: string;
  /** 岗位名称（与组织种子一致）。 */
  title: string;
  /** 所属部门。 */
  department: "管理团队" | "测试执行团队";
  /** 职级：1 总主管 / 2 主管 / 3 执行员工。 */
  rank: 1 | 2 | 3;
  /** 人物简介（1-2 句，概括岗位职责与人设）。 */
  bio: string;
  /** 形象动作：标志性姿态/道具（与像素头像对应）。 */
  mannerism: string;
  /** 性格与工作风格。 */
  personality: string;
  /** 主色（像素头像霓虹边光 / 工牌主题色）。 */
  signatureColor: string;
  /** 辅色（工牌点缀色）。 */
  accentColor: string;
  /** 头像文件名（位于 docs/数字员工身份系统/avatars/）。 */
  avatarFile: string;
  /** 座右铭。 */
  motto: string;
}

export const EMPLOYEE_IDENTITIES: readonly EmployeeIdentity[] = [
  {
    roleId: "org-chief-steward",
    employeeNo: "M-001",
    name: "顾衡",
    title: "总主管",
    department: "管理团队",
    rank: 1,
    bio: "数字员工团队的总管家，唯一的对外对接入口。不亲自干活，负责接任务、判归属、分派与验收，向老板汇报。",
    mannerism: "双手交叉胸前，胸别对讲机，威严沉稳。",
    personality: "全局观强、决断快、话不多但句句落在节点上。",
    signatureColor: "#3b6fe0",
    accentColor: "#9fb8f0",
    avatarFile: "01-gu-heng.png",
    motto: "事不过三，责不旁落。",
  },
  {
    roleId: "org-test-lead",
    employeeNo: "M-002",
    name: "苏澜",
    title: "测试主管",
    department: "管理团队",
    rank: 2,
    bio: "测试条线总管。接收测试项目、准备参考资料、负责 P2 测试策划，按 P0~P14 节点文件夹流转推进项目并组织验收。",
    mannerism: "单手高举项目表单，另一手叉腰，指挥姿态。",
    personality: "雷厉风行、条理分明，把每个项目都盯到收官。",
    signatureColor: "#e0343b",
    accentColor: "#f0a0a5",
    avatarFile: "02-su-lan.png",
    motto: "流程走到哪，表单跟到哪。",
  },
  {
    roleId: "org-test-project-lead",
    employeeNo: "M-003",
    name: "严律",
    title: "测试项目主管",
    department: "管理团队",
    rank: 3,
    bio: "执行 P1 准入审查（只审资料齐套性，输出通过/不通过），把控项目在 P0~P14 上的进度与质量，验收 P14 最终报告。",
    mannerism: "金丝眼镜，右手握准入印章举于胸前，严肃审视。",
    personality: "标准至上、一丝不苟，不合格的资料在他这里过不了夜。",
    signatureColor: "#1f7a4d",
    accentColor: "#8fd0b0",
    avatarFile: "03-yan-lv.png",
    motto: "资料不齐，免谈。",
  },
  {
    roleId: "org-dev-lead",
    employeeNo: "M-004",
    name: "贺章",
    title: "开发主管",
    department: "管理团队",
    rank: 2,
    bio: "任务面板台账负责人。承接总管家转派的任务，登记台账、记录来源/状态/交付节点，跟踪面板流转并反馈进展。",
    mannerism: "连帽衫配耳机，面前悬浮像素表格屏，双手敲击键盘。",
    personality: "数据洁癖、安静高效，台账永远比进度先到。",
    signatureColor: "#2fc06a",
    accentColor: "#a0e8c0",
    avatarFile: "04-he-zhang.png",
    motto: "每一条任务都有来处和去处。",
  },
  {
    roleId: "org-oa",
    employeeNo: "M-005",
    name: "祁文珊",
    title: "办公主管",
    department: "管理团队",
    rank: 2,
    bio: "分管办公/机关材料条线。负责信息收发、任务传达、机关材料上报，按模板生成 Word/Excel/PPT 并打包归档。",
    mannerism: "盘发，臂弯抱一摞文件，另一手作盖章动作。",
    personality: "细致周到、行文规范，材料格式从来挑不出毛病。",
    signatureColor: "#c9a24b",
    accentColor: "#f0dfb0",
    avatarFile: "05-qi-wenshan.png",
    motto: "机关材料，格式先行。",
  },
  {
    roleId: "org-test-designer-1",
    employeeNo: "T-101",
    name: "陆阅",
    title: "设计师（文档审查）",
    department: "测试执行团队",
    rank: 3,
    bio: "审查项目组提交的 Word/Excel/PPT 需求与设计文档，对照测试要求找描述不清、遗漏、矛盾之处，登记问题并跟踪闭环。",
    mannerism: "举放大镜贴于眼前，左手持文档，逐行核对。",
    personality: "眼尖心细、耐得住长文档，最擅长挑前后矛盾的措辞。",
    signatureColor: "#8a4fd0",
    accentColor: "#c8a8f0",
    avatarFile: "06-lu-yue.png",
    motto: "每一个含糊的句子都是缺陷的温床。",
  },
  {
    roleId: "org-test-designer-2",
    employeeNo: "T-102",
    name: "柯静",
    title: "设计师（静态分析）",
    department: "测试执行团队",
    rank: 3,
    bio: "不运行程序，对代码/配置/脚本做静态检查：规则扫描、依赖核对、隐患识别，登记静态发现的位置与严重程度。",
    mannerism: "戴投射像素数据流的扫描眼镜，双手抬于胸前，专注扫描。",
    personality: "冷静克制、不问过程只看模式，异常一眼定位。",
    signatureColor: "#2ba8c0",
    accentColor: "#a0e0ec",
    avatarFile: "07-ke-jing.png",
    motto: "代码不运行，问题照样现行。",
  },
  {
    roleId: "org-test-designer-3",
    employeeNo: "T-103",
    name: "秦守拙",
    title: "设计师（代码审查）",
    department: "测试执行团队",
    rank: 3,
    bio: "审查被测代码的实现逻辑、边界处理、异常路径与可维护性，对照需求判断实现是否一致，给出定位与修改建议。",
    mannerism: "托腮盯代码屏幕，另一手持放大镜，审视神情。",
    personality: "老练审慎、喜欢刨根问底，边界条件是他的主场。",
    signatureColor: "#b06a2a",
    accentColor: "#e8c0a0",
    avatarFile: "08-qin-shouzhuo.png",
    motto: "看代码要像看案情。",
  },
  {
    roleId: "org-test-designer-4",
    employeeNo: "T-104",
    name: "谭跃",
    title: "设计师（动态测试）",
    department: "测试执行团队",
    rank: 3,
    bio: "编写动态测试用例并在运行环境逐条执行，记录实际结果与预期差异、复现步骤，汇总执行通过率供报告岗位使用。",
    mannerism: "红头带、身体微微跃起，举测试用例板兴奋打勾。",
    personality: "精力旺盛、手速快，用例执行像一场冲刺。",
    signatureColor: "#e88a1f",
    accentColor: "#f0d0a0",
    avatarFile: "09-tan-yue.png",
    motto: "跑起来才知道哪里会塌。",
  },
  {
    roleId: "org-test-designer-5",
    employeeNo: "T-105",
    name: "叶述",
    title: "设计师（编写报告）",
    department: "测试执行团队",
    rank: 3,
    bio: "汇总各阶段表单与问题报告单形成报告素材，对接后台报告生成系统，核对自动生成结果、补齐结论并产出最终报告。",
    mannerism: "短发别发卡，双手置于像素键盘上，打字书写状。",
    personality: "沉静有条理，能把零散数据织成一份干净的报告。",
    signatureColor: "#3ba8e8",
    accentColor: "#a8d8f0",
    avatarFile: "10-ye-shu.png",
    motto: "报告是给下一个人看的。",
  },
  {
    roleId: "org-test-qa-1",
    employeeNo: "T-106",
    name: "甄齐",
    title: "质量审查（表单）",
    department: "测试执行团队",
    rank: 3,
    bio: "对照标准模板核验各阶段表单：表头字段是否齐全、必填项是否为空、命名口径是否规范、跨表数据是否一致，不合格退回补正。",
    mannerism: "双麻花辫，双手举核对清单逐项打勾。",
    personality: "较真但讲理，退单必附依据，从不含糊。",
    signatureColor: "#d04f9a",
    accentColor: "#f0b8d8",
    avatarFile: "11-zhen-qi.png",
    motto: "表格不齐整，流程不走下一步。",
  },
  {
    roleId: "org-test-qa-2",
    employeeNo: "T-107",
    name: "封鉴",
    title: "质量审查（报告）",
    department: "测试执行团队",
    rank: 3,
    bio: "对照报告模板核验章节结构、结论与问题报告单一致性、用例覆盖与统计吻合度，把关合格后才提交正式报告。",
    mannerism: "右手持印章作盖章动作，微微点头，笃定神情。",
    personality: "笃定稳重、把关从严，盖章之前必先过三遍。",
    signatureColor: "#5a7a9a",
    accentColor: "#b0c8e0",
    avatarFile: "12-feng-jian.png",
    motto: "盖章一时爽，责任一世扛。",
  },
];

/** 按 roleId 查身份档案。 */
export function identityForRole(roleId: string): EmployeeIdentity | undefined {
  return EMPLOYEE_IDENTITIES.find((entry) => entry.roleId === roleId);
}
