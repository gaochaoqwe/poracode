import { Bot, ShieldCheck, UserRound } from "lucide-react";
import {
  resolveFlowStepOwner,
  type FlowStepOwner,
  type ProjectFlowEdge,
  type ProjectFlowNode,
  type ProjectFlowPosition,
  type ProjectFlowTemplate,
} from "@/renderer/state/projectFlows";

/**
 * 项目流程图渲染 —— 纯展示 + 点选，不持有业务状态。
 *
 * 布局：模板给每个节点一个 (col,row) 网格坐标，列为主轴、行为并行泳道。
 * 连线走 SVG：同列相邻行之间走竖线，跨列走「右中 → 中折 → 左中」的折线；
 * 虚线表示监督 / 旁路关系。
 *
 * 视觉语义：
 *  - 节点：绿 = 自动（数字员工），琥珀 = 人工（使用人员）；虚线描边 + 盾牌 = 质量门。
 *  - 流转：每条连线都有一条缓慢流动的光带（marching dash）表示数据沿链路流转；
 *    当前正在交接的连线高亮加速，并有光点沿路径穿梭。
 *  - 当前进度：停在节点上时节点带脉冲光环 + 扫描高光 + 聚光背景；在节点之间
 *    交接时对应连线整体发亮。
 *
 * 动画全部走 CSS / SVG 原生（stroke-dashoffset、animateMotion），不占 React
 * 状态；`prefers-reduced-motion` 下自动降级为静态。
 */

export interface FlowSelection {
  type: "node" | "edge";
  id: string;
}

const NODE_W = 180;
const NODE_H = 74;
const COL_GAP = 64;
const ROW_GAP = 50;
const PAD = 28;

const AUTO_COLOR = "#10b981";
const MANUAL_COLOR = "#f59e0b";
const CURRENT_COLOR = "#f97316";
const GATE_COLOR = "#8b5cf6";

function ownerColor(owner: FlowStepOwner): string {
  return owner === "manual" ? MANUAL_COLOR : AUTO_COLOR;
}

/** #rrggbb → rgba(...)，用于按色值生成光晕 / 底衬。 */
function alpha(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function nodeX(col: number): number {
  return PAD + col * (NODE_W + COL_GAP);
}
function nodeY(row: number): number {
  return PAD + row * (NODE_H + ROW_GAP);
}

interface EdgeGeometry {
  d: string;
  labelX: number;
  labelY: number;
}

/** 连线路径：同列走竖线，跨列走折线。 */
function edgeGeometry(
  edge: ProjectFlowEdge,
  nodesById: ReadonlyMap<string, ProjectFlowNode>,
): EdgeGeometry | null {
  const from = nodesById.get(edge.from);
  const to = nodesById.get(edge.to);
  if (!from || !to) return null;
  const fx = nodeX(from.col);
  const fy = nodeY(from.row);
  const tx = nodeX(to.col);
  const ty = nodeY(to.row);
  if (from.col === to.col && from.row !== to.row) {
    const upwards = ty < fy;
    const x = fx + NODE_W / 2;
    const y1 = upwards ? fy : fy + NODE_H;
    const y2 = upwards ? ty + NODE_H : ty;
    return { d: `M ${x} ${y1} L ${x} ${y2}`, labelX: x, labelY: (y1 + y2) / 2 };
  }
  const x1 = fx + NODE_W;
  const y1 = fy + NODE_H / 2;
  const x2 = tx;
  const y2 = ty + NODE_H / 2;
  // 目标在左侧（回环）时绕行：先向右探出再折回。
  if (x2 < x1) {
    const outX = x1 + 28;
    return {
      d: `M ${x1} ${y1} H ${outX} V ${y2} H ${x2}`,
      labelX: outX,
      labelY: (y1 + y2) / 2,
    };
  }
  const midX = x1 + (x2 - x1) / 2;
  const d = y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
  return { d, labelX: midX, labelY: (y1 + y2) / 2 };
}

function OwnerBadge({ owner }: { owner: FlowStepOwner }) {
  const isAuto = owner === "auto";
  const color = ownerColor(owner);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[0.6em] font-medium"
      style={{ background: alpha(color, 0.16), color }}
    >
      {isAuto ? (
        <Bot className="size-3" aria-hidden="true" />
      ) : (
        <UserRound className="size-3" aria-hidden="true" />
      )}
      {isAuto ? "自动" : "人工"}
    </span>
  );
}

const CANVAS_CSS = `
.pf-board-surface {
  background:
    radial-gradient(130% 100% at 8% 0%, color-mix(in oklab, var(--accent) 12%, transparent), transparent 55%),
    radial-gradient(90% 80% at 100% 100%, color-mix(in oklab, var(--accent) 7%, transparent), transparent 62%),
    var(--surface-secondary);
}

.pf-flow { stroke-dasharray: 5 17; animation: pf-flow 3.4s linear infinite; }
.pf-flow-fast { animation-duration: 1.05s; stroke-dasharray: 7 15; }
@keyframes pf-flow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -22; } }
.pf-flow-dashed { stroke-dasharray: 3 5; animation: pf-flow-dashed 2.4s linear infinite; }
@keyframes pf-flow-dashed { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -8; } }

.pf-node {
  position: absolute; z-index: 10; overflow: hidden;
  display: flex; flex-direction: column; justify-content: space-between; gap: 5px;
  border-radius: 12px; border: 1px solid var(--hairline);
  background: color-mix(in oklab, var(--surface) 94%, transparent);
  padding: 8px 10px 7px 12px; text-align: left;
  box-shadow: 0 1px 2px rgba(0,0,0,.05);
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.pf-node:hover { transform: translateY(-1.5px); box-shadow: 0 8px 22px rgba(0,0,0,.16); border-color: var(--hairline-strong); z-index: 16; }
.pf-node-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
.pf-node-idx { position: absolute; right: 7px; top: 5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; line-height: 1; color: var(--muted); opacity: .55; }
.pf-node-body { display: flex; align-items: flex-start; gap: 6px; min-width: 0; pointer-events: none; }
.pf-node-icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 6px; flex-shrink: 0; margin-top: 1px; }
.pf-node-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pf-node-label { font-size: .74em; font-weight: 600; line-height: 1.25; color: var(--foreground); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.pf-node-emp { font-size: .58em; line-height: 1.2; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-node-foot { display: flex; align-items: center; gap: 5px; pointer-events: none; }
.pf-gate-badge { margin-left: auto; display: inline-flex; align-items: center; gap: 3px; font-size: .58em; color: ${GATE_COLOR}; background: ${alpha(GATE_COLOR, 0.14)}; border-radius: 999px; padding: 1px 6px; }
.pf-node-ring { position: absolute; inset: -4px; border-radius: 15px; border: 1.5px solid; pointer-events: none; animation: pf-ring 1.7s ease-out infinite; }
@keyframes pf-ring { 0% { transform: scale(.98); opacity: .9; } 70% { transform: scale(1.07); opacity: 0; } 100% { transform: scale(1.07); opacity: 0; } }
.pf-node-sheen { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, transparent 32%, rgba(255,255,255,.22) 50%, transparent 68%); background-size: 240% 100%; animation: pf-sheen 2.8s linear infinite; }
@keyframes pf-sheen { from { background-position: 160% 0; } to { background-position: -60% 0; } }
.pf-node.is-current { border-color: transparent; }

.pf-legend-flow {
  color: ${AUTO_COLOR};
  background-image: repeating-linear-gradient(90deg, currentColor 0 5px, transparent 5px 12px);
  background-size: 12px 100%;
  animation: pf-legend-flow 1s linear infinite;
}
@keyframes pf-legend-flow { from { background-position-x: 0; } to { background-position-x: 12px; } }

@media (prefers-reduced-motion: reduce) {
  .pf-flow, .pf-flow-fast, .pf-flow-dashed, .pf-node-ring, .pf-node-sheen, .pf-legend-flow { animation: none !important; }
}
`;

export function ProjectFlowCanvas({
  template,
  overrides,
  position,
  selection,
  onSelect,
}: {
  template: ProjectFlowTemplate;
  overrides: Readonly<Record<string, FlowStepOwner>> | undefined;
  position: ProjectFlowPosition | null;
  selection: FlowSelection | null;
  onSelect: (selection: FlowSelection | null) => void;
}) {
  const nodesById = new Map(template.nodes.map((node) => [node.id, node] as const));
  const maxCol = template.nodes.reduce((max, node) => Math.max(max, node.col), 0);
  const maxRow = template.nodes.reduce((max, node) => Math.max(max, node.row), 0);
  const width = PAD * 2 + (maxCol + 1) * NODE_W + maxCol * COL_GAP;
  const height = PAD * 2 + (maxRow + 1) * NODE_H + maxRow * ROW_GAP;

  const currentNode = position?.nodeId ? nodesById.get(position.nodeId) : undefined;
  const currentEdgeId = position?.edgeId;
  const stepIndex = new Map(template.nodes.map((node, index) => [node.id, index + 1] as const));

  const arrowMarkers = [
    ["pf-arrow-auto", AUTO_COLOR],
    ["pf-arrow-manual", MANUAL_COLOR],
    ["pf-arrow-current", CURRENT_COLOR],
  ] as const;

  return (
    <div className="pf-canvas relative" style={{ width, height }}>
      <style>{CANVAS_CSS}</style>

      <svg width={width} height={height} className="absolute left-0 top-0 z-0" aria-hidden="true">
        <defs>
          <pattern id="pf-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1.4" cy="1.4" r="1.2" fill="var(--foreground)" opacity="0.07" />
          </pattern>
          <radialGradient id="pf-spot">
            <stop offset="0%" stopColor={CURRENT_COLOR} stopOpacity="0.26" />
            <stop offset="100%" stopColor={CURRENT_COLOR} stopOpacity="0" />
          </radialGradient>
          <filter id="pf-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {arrowMarkers.map(([id, fill]) => (
            <marker
              key={id}
              id={id}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={fill} />
            </marker>
          ))}
        </defs>

        {/* 点阵底纹 */}
        <rect x="0" y="0" width={width} height={height} fill="url(#pf-grid)" />

        {/* 当前节点聚光 */}
        {currentNode ? (
          <circle
            cx={nodeX(currentNode.col) + NODE_W / 2}
            cy={nodeY(currentNode.row) + NODE_H / 2}
            r={132}
            fill="url(#pf-spot)"
          />
        ) : null}

        {/* 连线：底衬 → 流动光带 → 箭头 */}
        {template.edges.map((edge) => {
          const geometry = edgeGeometry(edge, nodesById);
          if (!geometry) return null;
          const owner = resolveFlowStepOwner(edge.owner, overrides, edge.id);
          const isCurrent = currentEdgeId === edge.id;
          const isSelected = selection?.type === "edge" && selection.id === edge.id;
          const isDashed = edge.dashed === true;
          const color = isCurrent ? CURRENT_COLOR : ownerColor(owner);
          const markerId = isCurrent
            ? "pf-arrow-current"
            : owner === "manual"
              ? "pf-arrow-manual"
              : "pf-arrow-auto";
          const highlight = isCurrent || isSelected;
          return (
            <g key={edge.id}>
              {highlight ? (
                <path
                  d={geometry.d}
                  fill="none"
                  stroke={color}
                  strokeWidth={isCurrent ? 8 : 6}
                  strokeLinecap="round"
                  opacity={isCurrent ? 0.2 : 0.14}
                  filter="url(#pf-glow)"
                />
              ) : null}
              <path
                className={isDashed && !isCurrent ? "pf-flow-dashed" : ""}
                d={geometry.d}
                fill="none"
                stroke={color}
                strokeWidth={isCurrent ? 2.2 : 1.5}
                strokeLinecap="round"
                opacity={isCurrent ? 0.5 : isDashed ? 0.5 : 0.38}
                markerEnd={`url(#${markerId})`}
              />
              {isDashed && !isCurrent ? null : (
                <path
                  className={`pf-flow${isCurrent ? " pf-flow-fast" : ""}`}
                  d={geometry.d}
                  fill="none"
                  stroke={color}
                  strokeWidth={isCurrent ? 2.8 : 1.8}
                  strokeLinecap="round"
                  opacity={isCurrent ? 1 : 0.62}
                />
              )}
              {isCurrent ? (
                <>
                  <circle r="3.6" fill={CURRENT_COLOR} filter="url(#pf-glow)">
                    <animateMotion dur="1.5s" repeatCount="indefinite" path={geometry.d} />
                  </circle>
                  <circle r="2.2" fill="#ffffff" opacity="0.95">
                    <animateMotion
                      dur="1.5s"
                      begin="-0.75s"
                      repeatCount="indefinite"
                      path={geometry.d}
                    />
                  </circle>
                </>
              ) : null}
              <path
                d={geometry.d}
                fill="none"
                stroke="transparent"
                strokeWidth={18}
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={() => onSelect({ type: "edge", id: edge.id })}
              />
            </g>
          );
        })}
      </svg>

      {/* 连线标签：只标注人工环节、当前 / 选中，避免整图噪声 */}
      {template.edges.map((edge) => {
        const geometry = edgeGeometry(edge, nodesById);
        if (!geometry) return null;
        const owner = resolveFlowStepOwner(edge.owner, overrides, edge.id);
        const isCurrent = currentEdgeId === edge.id;
        const isSelected = selection?.type === "edge" && selection.id === edge.id;
        if (owner === "auto" && !isCurrent && !isSelected) return null;
        return (
          <button
            key={`chip-${edge.id}`}
            type="button"
            onClick={() => onSelect({ type: "edge", id: edge.id })}
            title={edge.label ?? (owner === "manual" ? "人工流转" : "自动流转")}
            className={`absolute z-20 flex max-w-40 items-center gap-1 truncate rounded-full border px-1.5 py-px text-[0.62em] font-medium shadow-sm backdrop-blur-sm ${
              isCurrent
                ? "animate-pulse border-orange-400 bg-orange-500 text-white"
                : owner === "manual"
                  ? "border-amber-400 bg-amber-100/95 text-amber-800 dark:bg-amber-950/95 dark:text-amber-300"
                  : "border-[var(--hairline)] bg-content1/95 text-muted"
            }`}
            style={{
              left: geometry.labelX,
              top: geometry.labelY,
              transform: "translate(-50%, -50%)",
            }}
          >
            {edge.label ?? (owner === "manual" ? "人工" : "自动")}
          </button>
        );
      })}

      {/* 节点 */}
      {template.nodes.map((node) => {
        const owner = resolveFlowStepOwner(node.owner, overrides, node.id);
        const isCurrent = position?.nodeId === node.id;
        const isSelected = selection?.type === "node" && selection.id === node.id;
        const color = isCurrent ? CURRENT_COLOR : ownerColor(owner);
        const isGate = node.kind === "gate";
        const Icon = owner === "manual" ? UserRound : Bot;
        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelect({ type: "node", id: node.id })}
            title={node.employeeLabel ? `${node.label} · ${node.employeeLabel}` : node.label}
            className={`pf-node${isCurrent ? " is-current" : ""}`}
            style={{
              left: nodeX(node.col),
              top: nodeY(node.row),
              width: NODE_W,
              height: NODE_H,
              ...(isGate
                ? { borderStyle: "dashed", borderColor: alpha(GATE_COLOR, 0.55) }
                : {}),
              ...(isSelected
                ? {
                    borderColor: color,
                    boxShadow: `0 0 0 2px ${alpha(color, 0.55)}, 0 8px 22px rgba(0,0,0,.18)`,
                  }
                : {}),
              ...(isCurrent ? { boxShadow: `0 0 22px ${alpha(CURRENT_COLOR, 0.4)}` } : {}),
            }}
          >
            {isCurrent ? (
              <span className="pf-node-ring" style={{ borderColor: alpha(CURRENT_COLOR, 0.8) }} />
            ) : null}
            {isCurrent ? <span className="pf-node-sheen" /> : null}
            <span className="pf-node-accent" style={{ background: color }} />
            <span className="pf-node-idx">{stepIndex.get(node.id)}</span>
            <span className="pf-node-body">
              <span className="pf-node-icon" style={{ color, background: alpha(color, 0.14) }}>
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
              <span className="pf-node-text">
                <span className="pf-node-label">{node.label}</span>
                {node.employeeLabel ? <span className="pf-node-emp">{node.employeeLabel}</span> : null}
              </span>
            </span>
            <span className="pf-node-foot">
              <OwnerBadge owner={owner} />
              {isGate ? (
                <span className="pf-gate-badge">
                  <ShieldCheck className="size-2.5" aria-hidden="true" />
                  质量门
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
