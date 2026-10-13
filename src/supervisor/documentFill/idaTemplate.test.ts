import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fillDocument } from "./fill";
import { readZip } from "./zip";

const root = process.cwd();
const DIR = join(root, "resources", "plugins", "gjb438c-ida", "skills", "gjb438c-ida");

function fillIda(): string {
  const output = fillDocument({
    template: new Uint8Array(readFileSync(join(DIR, "documents", "影响域分析报告.docx"))),
    rules: JSON.parse(readFileSync(join(DIR, "templates", "rules.json"), "utf8")),
    config: JSON.parse(readFileSync(join(DIR, "templates", "config.json"), "utf8")),
    project: JSON.parse(readFileSync(join(DIR, "templates", "project.json"), "utf8")),
  });
  const entry = readZip(output).find((candidate) => candidate.name === "word/document.xml");
  if (!entry) throw new Error("no document.xml");
  return new TextDecoder().decode(entry.data);
}

/**
 * The IDA template reuses the SRS shell (cover, identity, TOC) and pins the
 * chapter-3 dynamic regions: 3.1/3.2/3.3 clone their change items from in-region
 * prototypes, which must be cleaned out of the output.
 */
describe("IDA template", () => {
  it("fills the fixed sections and clones the dynamic change items", () => {
    const xml = fillIda();
    // cover + identity
    expect(xml).toContain("影响域分析报告");
    expect(xml).toContain("BYQ-IDA-V2.0");
    // fixed chapters
    expect(xml).toContain("基本信息");
    expect(xml).toContain("依据文件");
    expect(xml).toContain("对其他关联软硬件的影响");
    expect(xml).toContain("测试验证情况");
    expect(xml).toContain("其他事项");
    // dynamic requirement changes (3.1): no description sub-section; the
    // impact sub-sections are 对关联需求(=无) / 对关联设计 / 对关联编码.
    expect(xml).toContain("3.1.1 新增转义字符处理需求");
    expect(xml).toContain("3.1.1.1 对关联需求的影响");
    expect(xml).toContain("3.1.1.3 对关联编码的影响");
    expect(xml).toContain("3.1.2 修改词法分析性能指标");
    // code locations are listed concretely
    expect(xml).toContain("src/lexer/escape.c");
    // dynamic design changes (3.2)
    expect(xml).toContain("3.2.1 新增转义状态处理子设计");
    expect(xml).toContain("3.2.1.2 对关联编码的影响");
    // dynamic code changes (3.3)
    expect(xml).toContain("3.3.1 新增转义处理代码");
    expect(xml).toContain("3.3.2 修改扫描函数");
    // table headers (locator rows) survive
    expect(xml).toContain("变更类型");
    expect(xml).toContain("影响范围");
    // prototypes are gone
    expect(xml).not.toContain("3.1.X <变更需求>");
    expect(xml).not.toContain("3.1.X.Y <子节>");
    expect(xml).not.toContain("3.2.X <变更设计>");
    expect(xml).not.toContain("3.3.X <变更代码>");
  });
});
