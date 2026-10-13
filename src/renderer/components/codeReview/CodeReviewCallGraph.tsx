import { useMemo } from "react";
import { ArrowDown, Waypoints } from "lucide-react";
import {
  chainOrderLabel,
  type ReviewCallGraph,
} from "@/renderer/state/codeReviewReport";

const NODE_W = 136;
const NODE_H = 30;
const GAP_X = 60;
const GAP_Y = 16;
const PAD = 16;

interface LaidOut {
  id: string;
  label: string;
  type: "file" | "function";
  x: number;
  y: number;
}

/**
 * 按「入度为 0 的节点是根」做分层（BFS）布局：同一层横向排一列、层间左→右。
 * 有环或找不到根时按最大深度循环次数兜底，保证所有节点都有位置（不会漏画）。
 */
function layoutGraph(graph: ReviewCallGraph): { nodes: LaidOut[]; width: number; height: number } {
  const ids = graph.nodes.map((node) => node.id);
  const idSet = new Set(ids);
  const incoming = new Map<string, number>();
  for (const id of ids) incoming.set(id, 0);
  const out = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    const list = out.get(edge.from);
    if (list) list.push(edge.to);
    else out.set(edge.from, [edge.to]);
  }
  const depth = new Map<string, number>();
  const roots = ids.filter((id) => (incoming.get(id) ?? 0) === 0);
  const queue: string[] = roots.length > 0 ? [...roots] : ids.slice(0, 1);
  for (const id of queue) depth.set(id, 0);
  let guard = 0;
  while (queue.length > 0 && guard < ids.length * ids.length + ids.length + 8) {
    guard += 1;
    const current = queue.shift();
    if (!current) break;
    const base = depth.get(current) ?? 0;
    for (const next of out.get(current) ?? []) {
      const nextDepth = base + 1;
      if (!depth.has(next) || nextDepth > (depth.get(next) ?? 0)) {
        depth.set(next, nextDepth);
        queue.push(next);
      }
    }
  }
  for (const id of ids) if (!depth.has(id)) depth.set(id, 0);

  const byDepth = new Map<number, string[]>();
  for (const id of ids) {
    const d = depth.get(id) ?? 0;
    const list = byDepth.get(d);
    if (list) list.push(id);
    else byDepth.set(d, [id]);
  }
  const labelOf = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes: LaidOut[] = [];
  let maxColumn = 0;
  for (const [d, column] of byDepth) {
    maxColumn = Math.max(maxColumn, column.length);
    column.forEach((id, index) => {
      const meta = labelOf.get(id);
      nodes.push({
        id,
        label: meta?.label ?? id,
        type: meta?.type ?? "function",
        x: PAD + d * (NODE_W + GAP_X),
        y: PAD + index * (NODE_H + GAP_Y),
      });
    });
  }
  return {
    nodes,
    width: PAD * 2 + (byDepth.size > 0 ? (byDepth.size - 1) * (NODE_W + GAP_X) + NODE_W : NODE_W),
    height: PAD * 2 + Math.max(1, maxColumn) * NODE_H + Math.max(0, maxColumn - 1) * GAP_Y,
  };
}

/**
 * 链路审查第二栏「调用关系」标签页。
 *
 * - 报告带 `callgraph` 时按分层布局画调用图（节点 = 文件 / 函数，边 = 调用）；
 * - 没有调用图但有 `chain_order` 时，退化为按顺序展示的**链路走向**（入口 → … → 末端），
 *   信息量与源项目一致、且不编造调用边；
 * - 两者都没有时显示空态。
 */
export function CodeReviewCallGraph(props: {
  graph: ReviewCallGraph | null;
  chainOrder: readonly string[];
}) {
  const { graph, chainOrder } = props;
  const view = useMemo(() => (graph && graph.nodes.length > 0 ? layoutGraph(graph) : null), [graph]);

  if (view) {
    const pos = new Map(view.nodes.map((node) => [node.id, node]));
    return (
      <div className="h-full w-full overflow-auto p-2">
        <svg
          width={view.width}
          height={view.height}
          viewBox={`0 0 ${view.width} ${view.height}`}
          role="img"
          aria-label="调用关系图"
        >
          <defs>
            <marker
              id="cr-call-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
            </marker>
          </defs>
          {graph?.edges.map((edge, index) => {
            const from = pos.get(edge.from);
            const to = pos.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`${edge.from}->${edge.to}#${index}`}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="var(--muted)"
                strokeWidth="1.2"
                markerEnd="url(#cr-call-arrow)"
                opacity="0.8"
              />
            );
          })}
          {view.nodes.map((node) => (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx="6"
                fill="var(--content-background)"
                stroke={node.type === "file" ? "var(--warning)" : "var(--accent)"}
                strokeWidth="1"
              />
              <text
                x={node.x + 10}
                y={node.y + NODE_H / 2}
                dominantBaseline="middle"
                fontSize="11"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fill="var(--foreground)"
              >
                {node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
    );
  }

  if (chainOrder.length > 0) {
    return (
      <div className="flex h-full w-full flex-col gap-1 overflow-y-auto p-2">
        <div className="flex items-center gap-1.5 text-[0.72em] text-muted">
          <Waypoints className="size-3.5" />
          <span>链路走向（按报告给出的 chain_order）</span>
        </div>
        {chainOrder.map((name, index) => (
          <div key={`${name}#${index}`} className="flex flex-col items-start">
            <div className="flex items-center gap-1.5 rounded border border-accent/40 bg-accent/5 px-2 py-1">
              <span className="shrink-0 rounded bg-accent/15 px-1 text-[0.7em] font-semibold text-accent">
                {chainOrderLabel(index)}
              </span>
              <span className="break-all font-mono text-[0.8em] text-foreground">{name}</span>
            </div>
            {index < chainOrder.length - 1 ? (
              <ArrowDown className="my-0.5 ml-3 size-3 text-muted" />
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-4 text-center">
      <Waypoints className="size-5 text-muted" />
      <div className="text-[0.8em] text-muted">
        暂无调用关系数据。报告提供 <code>callgraph</code>（来自索引的调用边）后会在此画出调用图；
        提供 <code>chain_order</code> 时会展示链路走向。
      </div>
    </div>
  );
}
