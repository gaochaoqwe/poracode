import { beforeEach, describe, expect, it } from "vitest";
import { useSharedSettings } from "./sharedSettingsStore";
import {
  EMPLOYEE_TEMPLATES,
  applyEmployeeTemplate,
  buildTemplateFromWorkspace,
  parseTemplate,
  serializeTemplate,
} from "./employeeTemplates";

describe("employeeTemplates", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({
      workspaces: [
        { id: "w1", name: "Work", createdAt: "2026-01-01T00:00:00.000Z", icon: "briefcase" },
      ],
    });
  });

  it("ships built-in role templates with persona + capabilities", () => {
    expect(EMPLOYEE_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const template of EMPLOYEE_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.persona.length).toBeGreaterThan(0);
      expect(template.responsibilities.length).toBeGreaterThan(0);
      expect(template.capabilityTags.length).toBeGreaterThan(0);
    }
  });

  it("applies a template to a fresh workspace with the employee fields filled", () => {
    const template = EMPLOYEE_TEMPLATES[0]!;
    const created = applyEmployeeTemplate(`${template.name}（上岗）`, template);

    expect(created).not.toBeNull();
    const ws = useSharedSettings.getState().workspaces.find((w) => w.id === created!.id)!;
    expect(ws.name).toBe(`${template.name}（上岗）`);
    expect(ws.persona).toBe(template.persona);
    expect(ws.responsibilities).toEqual(template.responsibilities);
    expect(ws.skillIds).toEqual(template.skillIds);
    expect(ws.capabilityTags).toEqual(template.capabilityTags);
    // The source workspace is untouched.
    expect(useSharedSettings.getState().workspaces[0]?.name).toBe("Work");
  });

  it("rejects a blank name when applying a template", () => {
    expect(applyEmployeeTemplate("   ", EMPLOYEE_TEMPLATES[0]!)).toBeNull();
    expect(useSharedSettings.getState().workspaces).toHaveLength(1);
  });

  it("round-trips a workspace into a template and back through JSON", () => {
    useSharedSettings.getState().updateWorkspaceProfile("w1", {
      persona: "我是文档编写员工",
      responsibilities: ["需求文档"],
      capabilityTags: ["文档"],
      agentKind: "codex",
      defaultThreadConfig: { model: "gpt-5" },
    });

    const ws = useSharedSettings.getState().workspaces[0]!;
    const exported = buildTemplateFromWorkspace(ws);
    const json = serializeTemplate(exported);
    const parsed = parseTemplate(json);

    expect(parsed).not.toBeNull();
    expect(parsed!.persona).toBe("我是文档编写员工");
    expect(parsed!.responsibilities).toEqual(["需求文档"]);
    expect(parsed!.capabilityTags).toEqual(["文档"]);
    expect(parsed!.defaultThreadConfig).toEqual({ model: "gpt-5" });
  });

  it("rejects malformed template JSON", () => {
    expect(parseTemplate("not json")).toBeNull();
    expect(parseTemplate('{"name": "x"}')).toBeNull();
    expect(parseTemplate("42")).toBeNull();
  });
});
