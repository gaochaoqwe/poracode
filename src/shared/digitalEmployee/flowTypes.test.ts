import { describe, expect, it } from "vitest";
import {
  isNodeSkeletonName,
  isProjectLifecycleState,
  nodeFolderName,
  parseNodeFolderName,
  TEST_FLOW_NODE_BY_ID,
  TEST_FLOW_NODES,
} from "./flowTypes";

describe("nodeFolderName / parseNodeFolderName", () => {
  it("生成「[节点-状态]」格式的文件夹名", () => {
    const node = TEST_FLOW_NODE_BY_ID.get("P3")!;
    expect(nodeFolderName(node, "进行中")).toBe("[P3-文档审查-进行中]");
    expect(nodeFolderName(node, "已完成")).toBe("[P3-文档审查-已完成]");
  });

  it("解析合法的状态文件夹名", () => {
    expect(parseNodeFolderName("[P3-文档审查-进行中]")).toEqual({
      nodeId: "P3",
      folderState: "进行中",
    });
    expect(parseNodeFolderName("[P14-最终报告-已完成]")).toEqual({
      nodeId: "P14",
      folderState: "已完成",
    });
  });

  it("拒绝骨架目录名、非法前缀与空串", () => {
    expect(parseNodeFolderName("P3-文档审查")).toBeNull();
    expect(parseNodeFolderName("[P3-文档审查]")).toBeNull();
    expect(parseNodeFolderName("[P3-文档审查-未知]")).toBeNull();
    expect(parseNodeFolderName("")).toBeNull();
    expect(parseNodeFolderName("[p3-文档审查-进行中]")).toBeNull();
  });

  it("骨架目录名判定", () => {
    expect(isNodeSkeletonName("P3-文档审查", "P3")).toBe(true);
    expect(isNodeSkeletonName("[P3-文档审查-进行中]", "P3")).toBe(false);
    expect(isNodeSkeletonName("P4-静态分析", "P3")).toBe(false);
  });
});

describe("TEST_FLOW_NODES 结构", () => {
  it("包含 P0~P14 共 15 个节点", () => {
    expect(TEST_FLOW_NODES).toHaveLength(15);
    expect(TEST_FLOW_NODES[0]!.id).toBe("P0");
    expect(TEST_FLOW_NODES[14]!.id).toBe("P14");
  });

  it("依赖关系无环且前置节点存在于表中", () => {
    const ids = new Set(TEST_FLOW_NODES.map((node) => node.id));
    for (const node of TEST_FLOW_NODES) {
      for (const dep of node.dependsOn) {
        expect(ids.has(dep)).toBe(true);
      }
    }
    // P0 无前置
    expect(TEST_FLOW_NODES[0]!.dependsOn).toEqual([]);
    // P14 完成需要 P13
    expect(TEST_FLOW_NODES[14]!.dependsOn).toEqual(["P13"]);
  });

  it("每个节点都有执行岗位", () => {
    for (const node of TEST_FLOW_NODES) {
      expect(node.ownerRoleId.length).toBeGreaterThan(0);
    }
  });
});

describe("isProjectLifecycleState", () => {
  it("识别三种状态", () => {
    expect(isProjectLifecycleState("未开展")).toBe(true);
    expect(isProjectLifecycleState("进行中")).toBe(true);
    expect(isProjectLifecycleState("已完成")).toBe(true);
    expect(isProjectLifecycleState("其他")).toBe(false);
  });
});
