import { describe, expect, it } from "vitest";
import { buildRoleContextBlock } from "./roleMemory";

describe("buildRoleContextBlock", () => {
  it("returns empty for a role with no identity", () => {
    expect(buildRoleContextBlock({ persona: undefined, responsibilities: undefined, capabilityTags: undefined })).toBe("");
  });

  it("ignores whitespace-only persona", () => {
    expect(buildRoleContextBlock({ persona: "   ", responsibilities: undefined, capabilityTags: undefined })).toBe("");
  });

  it("folds persona, responsibilities and capability tags into a block", () => {
    const block = buildRoleContextBlock({
      persona: "文档编写岗员工",
      responsibilities: ["编写需求文档", "设计文档", "验收报告"],
      capabilityTags: ["requirements", "design"],
    });
    expect(block).toContain("文档编写岗员工");
    expect(block).toContain("编写需求文档");
    expect(block).toContain("验收报告");
    expect(block).toContain("requirements, design");
    expect(block).toContain("Role");
    expect(block).toContain("Responsibilities");
    expect(block).toContain("Capabilities");
  });

  it("only includes the sections that are present", () => {
    const block = buildRoleContextBlock({ persona: "测试岗", responsibilities: undefined, capabilityTags: undefined });
    expect(block).toContain("测试岗");
    expect(block).not.toContain("Responsibilities");
    expect(block).not.toContain("Capabilities");
  });
});
