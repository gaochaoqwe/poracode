import { describe, expect, it } from "vitest";
import { routeTaskBySource } from "./taskRouting";
import { dispatchChiefStewardTool, type ChiefStewardDeps } from "./chiefSteward";
import type { SharedSettings } from "@/shared/settings";

function testDeps(): ChiefStewardDeps {
  const settings = { workspaces: [], teams: [] } as unknown as SharedSettings;
  return {
    readSettings: () => settings,
    emitSettingsWrite: () => {},
    dispatchTeamTask: async () =>
      ({
        taskId: "x",
        policy: "free-for-all",
        targets: [],
      }) as never,
    stewardIdentity: () => ({ agentKind: "codex", model: "gpt-5" }),
    requestTaskCreate: () => {},
  };
}

describe("routeTaskBySource", () => {
  it("routes test-line tasks to org-test-lead", () => {
    const route = routeTaskBySource("把登录模块的测试用例整理进动态测试阶段");
    expect(route.targetWorkspaceId).toBe("org-test-lead");
    expect(route.needsClarification).toBe(false);
  });

  it("routes OA tasks to org-oa", () => {
    const route = routeTaskBySource("质量部要报季度材料，需要一份汇报公文");
    expect(route.targetWorkspaceId).toBe("org-oa");
    expect(route.matchedKeywords).toEqual(expect.arrayContaining(["质量部", "材料"]));
  });

  it("explicit OA prefix wins over a test keyword", () => {
    const route = routeTaskBySource("OA：帮我出一份项目季度汇报");
    expect(route.targetWorkspaceId).toBe("org-oa");
  });

  it("explicit test prefix wins", () => {
    const route = routeTaskBySource("测试：推进到需求分析阶段");
    expect(route.targetWorkspaceId).toBe("org-test-lead");
  });

  it("ambiguous text needs clarification", () => {
    const route = routeTaskBySource("今天下午三点开会");
    expect(route.targetWorkspaceId).toBeNull();
    expect(route.needsClarification).toBe(true);
  });

  it("empty text degrades", () => {
    expect(routeTaskBySource("").targetWorkspaceId).toBeNull();
    expect(routeTaskBySource("   ").needsClarification).toBe(true);
  });
});

describe("route_inbox_task tool", () => {
  it("suggests the test lead for a testing task", async () => {
    const result = await dispatchChiefStewardTool(
      "route_inbox_task",
      { text: "流水线该推进到用例表导入了" },
      testDeps(),
    );
    const body = JSON.parse(result.content[0]!.text);
    expect(body.suggestion).toBe("org-test-lead");
    expect(body.matchedKeywords).toEqual(expect.arrayContaining(["流水线"]));
  });

  it("asks for clarification when nothing matches", async () => {
    const result = await dispatchChiefStewardTool(
      "route_inbox_task",
      { text: "记得取快递" },
      testDeps(),
    );
    const body = JSON.parse(result.content[0]!.text);
    expect(body.suggestion).toBeNull();
    expect(body.prompt).toContain("追问");
  });
});
