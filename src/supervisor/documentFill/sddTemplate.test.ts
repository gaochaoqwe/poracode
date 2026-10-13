import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fillDocument } from "./fill";
import { readZip } from "./zip";

const root = process.cwd();
const DIR = join(root, "resources", "plugins", "gjb438c-sdd", "skills", "gjb438c-sdd");

function fillSdd(): string {
  const output = fillDocument({
    template: new Uint8Array(
      readFileSync(join(DIR, "documents", "[11][SDD] 软件设计说明-438C-2021.docx")),
    ),
    rules: JSON.parse(readFileSync(join(DIR, "templates", "rules.json"), "utf8")),
    config: JSON.parse(readFileSync(join(DIR, "templates", "config.json"), "utf8")),
    project: JSON.parse(readFileSync(join(DIR, "templates", "project.json"), "utf8")),
  });
  const entry = readZip(output).find((candidate) => candidate.name === "word/document.xml");
  if (!entry) throw new Error("no document.xml");
  return new TextDecoder().decode(entry.data);
}

/**
 * The SDD template pins 4.1.1 as a fixed section (its heading + 软件单元列表
 * table are static) while 4.1.2+ are cloned from prototypes. This pins both
 * halves, and that the prototype region is cleaned out of the output.
 */
describe("SDD template", () => {
  it("keeps a fixed 4.1.1 and clones the dynamic 4.1.2+ sub-sections", () => {
    const xml = fillSdd();
    // fixed 4.1.1 (static heading + filled body + list table)
    expect(xml).toContain("软件单元静态关系");
    expect(xml).toContain("各级软件单元的静态关系");
    // dynamic 4.1.2+ (groups) and their sub-units
    expect(xml).toContain("4.1.2 数据处理单元");
    expect(xml).toContain("4.1.2.1 数据解析单元");
    expect(xml).toContain("4.1.2.2 加载数据管理单元");
    expect(xml).toContain("4.1.3 运行支撑单元");
    expect(xml).toContain("4.1.3.1 错误处理单元");
    // allocation tables use the -flat merged header
    expect(xml).toContain("分配给该软件单元的需求和CSCI级设计决策");
    expect(xml).toContain("软件单元的需求");
    // 4.2: fixed 4.2.1 (four parts + figure anchors) and dynamic 4.2.2.x
    expect(xml).toContain("CSCI级执行方案");
    expect(xml).toContain("任务级执行方案");
    expect(xml).toContain("任务并发模型见图");
    expect(xml).toContain("任务时序见图");
    expect(xml).toContain("4.2.2.1 接口处理任务执行方案");
    expect(xml).toContain("4.2.2.2 解算任务执行方案");
    // 4.3: fixed 4.3.1 with sub-parts + two dynamic regions
    expect(xml).toContain("CSCI外部接口组成");
    expect(xml).toContain("CSCI内部单元接口组成");
    expect(xml).toContain("任务接口组成");
    expect(xml).toContain("4.3.1.2.1 词法分析单元内部接口");
    expect(xml).toContain("4.3.2 文件系统输入接口");
    expect(xml).toContain("接口项目标识符");
    // chapter 5: fixed 5.1/5.2/5.3 headings with dynamic children
    expect(xml).toContain("5.1.1 主控任务");
    expect(xml).toContain("任务名称：主控任务");
    expect(xml).toContain("5.2.1 看门狗中断");
    expect(xml).toContain("中断服务程序：ISR_WatchDog");
    expect(xml).toContain("5.3.1 词法分析器");
    expect(xml).toContain("5.3.1.1 入口函数");
    expect(xml).toContain("5.3.1.6 错误或异常处理");
    // prototypes are gone
    expect(xml).not.toContain("4.1.X <软件单元>");
    expect(xml).not.toContain("4.2.X.X <子节>");
    expect(xml).not.toContain("4.3.1.2.X <单元内部接口组成>");
    expect(xml).not.toContain("5.1.X <任务>");
    expect(xml).not.toContain("5.3.X <软件单元>");
  });
});
