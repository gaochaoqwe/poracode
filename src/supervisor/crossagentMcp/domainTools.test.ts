import { describe, expect, it } from "vitest";
import {
  DOMAIN_TOOL_NAMES,
  TestPipelineRegistry,
  dispatchDomainTool,
  nextTestPhase,
} from "./domainTools";

describe("test pipeline phase state machine", () => {
  it("advances one step forward and stops at done", () => {
    expect(nextTestPhase("planning")).toBe("requirements");
    expect(nextTestPhase("report")).toBe("done");
    expect(nextTestPhase("done")).toBe("done");
  });

  it("registry advances and remembers the project phase", async () => {
    const registry = new TestPipelineRegistry();
    const first = await dispatchDomainTool("test_phase_advance", { projectId: "p1" }, registry);
    expect(first.isError).toBeUndefined();
    expect(JSON.parse(first.content[0]!.text)).toMatchObject({
      phase: "requirements",
      phaseLabel: "需求分析",
    });
    expect(registry.get("p1")?.phase).toBe("requirements");
  });

  it("rejects missing projectId", async () => {
    const result = await dispatchDomainTool("test_phase_advance", {});
    expect(result.isError).toBe(true);
  });
});

describe("test workbook model", () => {
  it("emits the five canonical sheets", async () => {
    const result = await dispatchDomainTool("build_test_workbook", {
      project: { id: "p1", name: "系统测试" },
      cases: [{ id: "TC-001" }],
    });
    const model = JSON.parse(result.content[0]!.text);
    expect(model.sheets.map((sheet: { name: string }) => sheet.name)).toEqual([
      "项目信息表",
      "策划表",
      "需求分析表",
      "用例表",
      "问题报告单",
    ]);
    expect(model.sheets[3].rows).toHaveLength(1);
  });
});

describe("test execution designer tools", () => {
  it("generates case rows from requirements", async () => {
    const result = await dispatchDomainTool("generate_test_cases", {
      requirements: ["登录功能", "导出功能"],
    });
    const model = JSON.parse(result.content[0]!.text);
    expect(model.cases).toHaveLength(2);
    expect(model.cases[0].caseId).toBe("TC-001");
  });

  it("aggregates run results", async () => {
    const result = await dispatchDomainTool("collect_test_results", {
      runs: [
        { caseId: "TC-001", result: "passed" },
        { caseId: "TC-002", result: "failed" },
        { caseId: "TC-003", result: "blocked" },
      ],
    });
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      total: 3,
      passed: 1,
      failed: 1,
      blocked: 1,
    });
  });

  it("review_document_form reports missing checklist items", async () => {
    const result = await dispatchDomainTool("review_document_form", {
      documentKind: "docx",
      checklist: ["测试范围", "通过准则"],
      extractedText: "本文档说明测试范围与方法。",
    });
    expect(JSON.parse(result.content[0]!.text).missing).toEqual(["通过准则"]);
  });
});

describe("OA tools", () => {
  it("builds a submission package for a known unit", async () => {
    const result = await dispatchDomainTool("oa_submission_package", {
      unit: "质量部",
      title: "季度质量报告",
    });
    const model = JSON.parse(result.content[0]!.text);
    expect(model.archive).toBe("质量部_季度质量报告.zip");
    expect(model.files).toContain("汇总.xlsx");
  });

  it("rejects unknown units", async () => {
    const result = await dispatchDomainTool("oa_material_skeleton", { unit: "后勤部" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("未知机关部门");
  });

  it("oa_material_skeleton returns per-unit sections", async () => {
    const result = await dispatchDomainTool("oa_material_skeleton", { unit: "部办" });
    expect(JSON.parse(result.content[0]!.text).sections).toContain("重点事项办理");
  });
});

describe("boundary", () => {
  it("refuses unknown tool names", async () => {
    const result = await dispatchDomainTool("launch_missiles", {});
    expect(result.isError).toBe(true);
  });

  it("every spec name is in the tool-name set", () => {
    expect(DOMAIN_TOOL_NAMES.has("test_phase_advance")).toBe(true);
  });
});
