import { describe, expect, it } from "vitest";
import {
  isProjectFlowDone,
  nodesOwnedByRole,
  planFlow,
  scanProjectFlow,
  type NodeScan,
  type PlannedNode,
} from "./flowEngine";
import { nodeFolderName, TEST_FLOW_NODES } from "./flowTypes";

const PROJECT_DIR = "E:/模拟/测试项目/2026/进行中/项目A";

/** 由条目名列表构造扫描结果（等价于 scanProjectFlow 的输出形态）。 */
function scanFromEntries(entries: readonly string[]): NodeScan[] {
  return scanProjectFlow(TEST_FLOW_NODES, () => entries, PROJECT_DIR);
}

function statesOf(planned: readonly PlannedNode[]): Record<string, string> {
  return Object.fromEntries(planned.map((entry) => [entry.node.id, entry.state]));
}

function actionsOf(planned: readonly PlannedNode[]): Record<string, string> {
  return Object.fromEntries(
    planned
      .filter((entry) => entry.action)
      .map((entry) => [entry.node.id, entry.action!.kind]),
  );
}

describe("scanProjectFlow 扫描", () => {
  it("空目录：所有节点未开始", () => {
    const scans = scanFromEntries([]);
    expect(scans.every((scan) => scan.folderState === null)).toBe(true);
  });

  it("识别进行中/已完成/骨架目录", () => {
    const scans = scanFromEntries([
      "[P0-测试申请文件-已完成]",
      "[P1-准入审查-进行中]",
      "P2-测试策划", // 骨架目录 = 未开始
    ]);
    const byId = new Map(scans.map((scan) => [scan.node.id, scan]));
    expect(byId.get("P0")!.folderState).toBe("已完成");
    expect(byId.get("P1")!.folderState).toBe("进行中");
    expect(byId.get("P2")!.folderState).toBeNull();
  });
});

describe("planFlow 流转规划", () => {
  it("空项目：P0 建议 start（测试主管空闲），其余等待前置", () => {
    const planned = planFlow(TEST_FLOW_NODES, scanFromEntries([]), {}, PROJECT_DIR);
    expect(statesOf(planned)["P0"]).toBe("not-started");
    expect(actionsOf(planned)["P0"]).toBe("start");
    expect(planned.find((entry) => entry.node.id === "P0")!.action!.targetFolderName).toBe(
      nodeFolderName(TEST_FLOW_NODES[0]!, "进行中"),
    );
    // P1 前置 P0 未完成：无动作
    expect(actionsOf(planned)["P1"]).toBeUndefined();
    expect(statesOf(planned)["P1"]).toBe("not-started");
  });

  it("P0 完成后：P1 建议 start", () => {
    const entries = ["[P0-测试申请文件-已完成]"];
    const planned = planFlow(TEST_FLOW_NODES, scanFromEntries(entries), {}, PROJECT_DIR);
    expect(statesOf(planned)["P0"]).toBe("done");
    expect(actionsOf(planned)["P1"]).toBe("start");
  });

  it("前置完成但执行员工正忙：waiting + wait 动作，不创建进行中", () => {
    const entries = ["[P0-测试申请文件-已完成]"];
    // P1 归属 org-test-project-lead，置为忙碌
    const planned = planFlow(
      TEST_FLOW_NODES,
      scanFromEntries(entries),
      { "org-test-project-lead": true },
      PROJECT_DIR,
    );
    expect(statesOf(planned)["P1"]).toBe("waiting");
    expect(actionsOf(planned)["P1"]).toBe("wait");
  });

  it("进行中节点保持 in-progress，无动作", () => {
    const entries = ["[P1-准入审查-进行中]"];
    const planned = planFlow(TEST_FLOW_NODES, scanFromEntries(entries), {}, PROJECT_DIR);
    expect(statesOf(planned)["P1"]).toBe("in-progress");
    expect(actionsOf(planned)["P1"]).toBeUndefined();
  });

  it("P2 完成后 P3~P6 并行 start（多路并行流转）", () => {
    const entries = ["[P0-测试申请文件-已完成]", "[P1-准入审查-已完成]", "[P2-测试策划-已完成]"];
    const planned = planFlow(TEST_FLOW_NODES, scanFromEntries(entries), {}, PROJECT_DIR);
    for (const id of ["P3", "P4", "P5", "P6"]) {
      expect(actionsOf(planned)[id]).toBe("start");
    }
    // P7 依赖 P6，等待
    expect(actionsOf(planned)["P7"]).toBeUndefined();
  });

  it("全部节点完成：项目流转完成", () => {
    const entries = TEST_FLOW_NODES.map((node) => nodeFolderName(node, "已完成"));
    const planned = planFlow(TEST_FLOW_NODES, scanFromEntries(entries), {}, PROJECT_DIR);
    expect(isProjectFlowDone(planned)).toBe(true);
    expect(Object.values(statesOf(planned)).every((state) => state === "done")).toBe(true);
  });

  it("前置未完成时无任何动作产生（文件未流转）", () => {
    const entries = ["[P0-测试申请文件-进行中]"];
    const planned = planFlow(TEST_FLOW_NODES, scanFromEntries(entries), {}, PROJECT_DIR);
    expect(Object.values(actionsOf(planned)).filter((kind) => kind === "start")).toHaveLength(0);
  });
});

describe("nodesOwnedByRole", () => {
  it("返回某员工负责的进行中或待启动节点", () => {
    const entries = [
      "[P0-测试申请文件-已完成]",
      "[P1-准入审查-已完成]",
      "[P2-测试策划-已完成]",
    ];
    const planned = planFlow(TEST_FLOW_NODES, scanFromEntries(entries), {}, PROJECT_DIR);
    // P3 归属 org-test-designer-1 且待启动
    const owned = nodesOwnedByRole(planned, "org-test-designer-1");
    expect(owned.map((entry) => entry.node.id)).toEqual(["P3"]);
  });
});
