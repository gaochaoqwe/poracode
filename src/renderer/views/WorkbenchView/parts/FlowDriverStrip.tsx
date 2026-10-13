import { Bot, FolderGit2, Loader2 } from "lucide-react";
import { TEST_FLOW_NODES } from "@/shared/digitalEmployee/flowTypes";
import type { NodeState } from "@/shared/digitalEmployee/flowTypes";
import { useFlowDriverSnapshotStore } from "@/renderer/state/flowDriverSnapshotStore";
import type { ProjectFlowPlan } from "@/shared/digitalEmployee/flowSnapshot";

/**
 * 文件系统流转状态条 —— 项目看板顶部的实时流转视图。
 *
 * 数据源：supervisor 文件系统驱动（FlowDriver）每轮扫描-派发后的快照
 * （`flow-driver-snapshot` 事件 → `useFlowDriverSnapshotStore`），不是线程
 * 活动推断：每个进行中的测试项目显示其 P0~P14 节点文件夹的真实状态
 * （未开始 / 进行中 / 已完成 / 等待员工空闲）。
 *
 * 视觉语义（与 ProjectFlowCanvas 一致）：
 *  - 灰 = 未开始（文件尚未流转到该员工）
 *  - 琥珀脉冲 = 进行中（节点文件夹为「[节点-进行中]」）
 *  - 橙 = 等待（前置已完成但员工正忙，文件原地等待）
 *  - 绿 = 已完成（节点文件夹为「[节点-已完成]」）
 */

const NODE_STATE_META: Record<NodeState, { color: string; label: string }> = {
  "not-started": { color: "#94a3b8", label: "未开始" },
  waiting: { color: "#f59e0b", label: "等待员工空闲" },
  "in-progress": { color: "#f97316", label: "进行中" },
  done: { color: "#10b981", label: "已完成" },
};

function projectName(projectDir: string): string {
  const segments = projectDir.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? projectDir;
}

function projectStateLabel(plan: ProjectFlowPlan): string {
  if (plan.done) return "全部节点完成";
  const current = plan.nodes.find((entry) => entry.state === "in-progress");
  if (current) return `进行中：${current.node.label}`;
  const waiting = plan.nodes.find((entry) => entry.state === "waiting");
  if (waiting) return `等待：${waiting.node.label}`;
  const next = plan.nodes.find((entry) => entry.action?.kind === "start");
  if (next) return `待启动：${next.node.label}`;
  return "未开始";
}

/** 单个项目的 P0~P14 节点状态点阵行。 */
function ProjectFlowRow({ plan }: { plan: ProjectFlowPlan }) {
  const stateById = new Map(plan.nodes.map((entry) => [entry.node.id, entry.state]));
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2">
      <span className="flex min-w-0 shrink-0 items-center gap-1.5">
        <FolderGit2 className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
        <span
          className="max-w-44 truncate text-xs font-medium text-foreground"
          title={plan.projectDir}
        >
          {projectName(plan.projectDir)}
        </span>
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.68em] text-muted">
        {projectStateLabel(plan)}
      </span>
      <span className="flex shrink-0 items-center gap-1.5" aria-label="P0~P14 节点状态">
        {TEST_FLOW_NODES.map((node) => {
          const state = stateById.get(node.id) ?? "not-started";
          const meta = NODE_STATE_META[state];
          return (
            <span
              key={node.id}
              title={`${node.id} ${node.label} · ${meta.label}`}
              className={`size-2.5 rounded-full ${state === "in-progress" ? "animate-pulse" : ""}`}
              style={{ background: meta.color }}
            />
          );
        })}
      </span>
    </div>
  );
}

/**
 * 文件系统流转状态条：挂在工作台「项目看板」标签页顶部。
 * 快照尚未到达或没有进行中的测试项目时，显示一条轻提示而不是空白。
 */
export function FlowDriverStrip() {
  const snapshot = useFlowDriverSnapshotStore((s) => s.snapshot);

  if (!snapshot) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-4 py-2 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        文件系统驱动尚未返回扫描结果（数字员工按「模拟公司电脑文件夹」的节点文件夹流转）。
      </div>
    );
  }

  const dispatchedSummary =
    snapshot.dispatched.length > 0
      ? `本轮唤醒 ${snapshot.dispatched.filter((d) => d.status === "spawned").length} 个员工线程 · ${
          snapshot.dispatched.filter((d) => d.status === "skipped").length
        } 跳过 · ${snapshot.dispatched.filter((d) => d.status === "failed").length} 失败`
      : "本轮无唤醒动作";

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-[var(--hairline)] bg-[var(--surface-secondary)]/60 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2 text-[0.68em] text-muted">
        <Bot
          className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <span className="shrink-0 font-medium text-foreground">文件系统流转</span>
        {snapshot.projects.length > 0 ? (
          <span className="shrink-0">
            进行中测试项目{" "}
            <span className="tabular-nums text-foreground">{snapshot.projects.length}</span> 个
          </span>
        ) : null}
        <span className="shrink-0 truncate">{dispatchedSummary}</span>
        <span className="ml-auto shrink-0 tabular-nums" title={snapshot.scannedAt}>
          {new Date(snapshot.scannedAt).toLocaleTimeString()}
        </span>
      </div>
      {snapshot.projects.length === 0 ? (
        <span className="text-xs text-muted">
          暂无进行中的测试项目（把项目放入「模拟公司电脑文件夹/测试项目/年份/进行中」后，驱动会自动扫描并按
          P0~P14 流转）。
        </span>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          {snapshot.projects.map((plan) => (
            <ProjectFlowRow key={plan.projectDir} plan={plan} />
          ))}
        </div>
      )}
    </div>
  );
}
