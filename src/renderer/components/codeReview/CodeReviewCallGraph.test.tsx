import { describe, expect, it } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { ReviewCallGraph } from "@/renderer/state/codeReviewReport";
import { CodeReviewCallGraph } from "./CodeReviewCallGraph";

/** 链路审查第二栏「调用关系」标签页：有调用图就画图，没有就退化为链路走向。 */

const GRAPH: ReviewCallGraph = {
  taskId: "t1",
  nodes: [
    { id: "route_ok", label: "route_ok", type: "function", file: "src/nav.c" },
    { id: "normalize", label: "normalize", type: "function", file: "src/normalize.c" },
    { id: "distance_km", label: "distance_km", type: "function", file: "src/nav.c" },
  ],
  edges: [
    { from: "route_ok", to: "normalize" },
    { from: "route_ok", to: "distance_km" },
  ],
};

describe("CodeReviewCallGraph", () => {
  it("draws one rect + label per node and one edge path per edge", () => {
    const { container } = render(<CodeReviewCallGraph graph={GRAPH} chainOrder={[]} />);
    const svg = container.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("rect")).toHaveLength(3);
    // 只数真正的调用边（箭头 marker 自身也是一条 path，故按 marker-end 过滤）。
    expect(svg?.querySelectorAll("path[marker-end]")).toHaveLength(2);
    expect(container.textContent).toContain("route_ok");
    expect(container.textContent).toContain("distance_km");
  });

  it("ignores edges that point at unknown nodes", () => {
    const { container } = render(
      <CodeReviewCallGraph
        graph={{ ...GRAPH, edges: [{ from: "route_ok", to: "missing" }] }}
        chainOrder={[]}
      />,
    );
    expect(container.querySelectorAll('svg[role="img"] path[marker-end]')).toHaveLength(0);
  });

  it("falls back to the chain-order flow when there is no callgraph", () => {
    const { container } = render(
      <CodeReviewCallGraph graph={null} chainOrder={["route_ok", "normalize"]} />,
    );
    expect(container.querySelector('svg[role="img"]')).toBeNull();
    expect(container.textContent).toContain("链路走向");
    expect(container.textContent).toContain("route_ok");
    expect(container.textContent).toContain("normalize");
    // 链路顺序角标 A / B
    expect(container.textContent).toContain("A");
    expect(container.textContent).toContain("B");
  });

  it("shows an empty state when there is neither a graph nor a chain order", () => {
    const { container } = render(<CodeReviewCallGraph graph={null} chainOrder={[]} />);
    expect(container.textContent).toContain("暂无调用关系数据");
  });
});
