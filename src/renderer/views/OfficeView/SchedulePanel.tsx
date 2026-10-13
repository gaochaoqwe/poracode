import { Trans, useLingui } from "@lingui/react/macro";
import type { Project, Thread, ThreadFollowUpQueueState } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useThreadFollowUpQueueStore } from "@/renderer/state/threadFollowUpQueueStore";
import {
  useEmployeeQueueSnapshotStore,
  type EmployeeQueueSnapshot,
} from "@/renderer/state/employeeQueueSnapshotStore";
import { aggregateRole } from "@/renderer/views/MainView/parts/EmployeeDockBar";
import { employeeWorkspaces, hiddenTeamIds } from "./hierarchy";
import { PixelPanel } from "./pixel";

const BUSY_STATUSES = new Set(["working", "launching"] as const);

export interface ScheduleRow {
  workspaceId: string;
  name: string;
  busy: boolean;
  statusLabel: string;
  activeThreadTitle?: string;
  queuedCount: number;
  deadline?: string;
}

/**
 * Fallback rows derived from observed thread state + the per-thread follow-up
 * queue. Used only until the authoritative supervisor snapshot arrives.
 */
export function buildScheduleRows(
  employees: readonly { id: string; name: string }[],
  threads: readonly Thread[],
  projects: readonly Project[],
  contextByThread: Readonly<Record<string, unknown>>,
  queueByThread: Readonly<Record<string, { queue: ThreadFollowUpQueueState | null } | undefined>>,
): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  for (const employee of employees) {
    const agg = aggregateRole(threads, projects, employee.id, contextByThread as never);
    const active = agg.active;
    const busy = active !== undefined && BUSY_STATUSES.has(agg.status as "working");
    const queuedCount = active ? (queueByThread[active.id]?.queue?.items.length ?? 0) : 0;
    rows.push({
      workspaceId: employee.id,
      name: employee.name,
      busy,
      statusLabel: agg.status,
      ...(active?.title ? { activeThreadTitle: active.title } : {}),
      queuedCount,
    });
  }
  return rows.sort((a, b) => Number(b.busy) - Number(a.busy) || b.queuedCount - a.queuedCount);
}

/**
 * Authoritative rows from the supervisor's per-employee queue snapshot. Employee
 * names resolve through the workspace map; the snapshot is the single source of
 * truth for busy / current task / queue order / deadline.
 */
export function buildScheduleRowsFromSnapshot(
  snapshot: EmployeeQueueSnapshot,
  workspaceById: ReadonlyMap<string, { name: string }>,
): ScheduleRow[] {
  const rows = snapshot.employees.map((entry) => ({
    workspaceId: entry.employeeId,
    name: workspaceById.get(entry.employeeId)?.name ?? entry.employeeId,
    busy: entry.busy,
    statusLabel: entry.busy ? "working" : "idle",
    ...(entry.currentTask?.prompt ? { activeThreadTitle: entry.currentTask.prompt } : {}),
    queuedCount: entry.queue.length,
    ...(entry.queue[0]?.deadline ? { deadline: entry.queue[0].deadline } : {}),
  }));
  return rows.sort((a, b) => Number(b.busy) - Number(a.busy) || b.queuedCount - a.queuedCount);
}

/**
 * Dispatch / queue view: who is running, who is idle, and what is queued behind
 * them. Prefers the authoritative supervisor snapshot; while none has arrived it
 * falls back to observed thread state so the view is never blank.
 */
export function SchedulePanel() {
  const { t } = useLingui();
  const workspaces = useSharedSettings((s) => s.workspaces);
  const teams = useSharedSettings((s) => s.teams);
  const threads = useAppStore((s) => s.threads);
  const projects = useAppStore((s) => s.projects);
  const contextByThread = useAppStore((s) => s.runtimeContextByThread);
  const queueByThread = useThreadFollowUpQueueStore((s) => s.byThread);
  const snapshot = useEmployeeQueueSnapshotStore((s) => s.snapshot);

  const employees = employeeWorkspaces(workspaces, hiddenTeamIds(teams));
  const workspaceById = new Map(workspaces.map((w) => [w.id, w] as const));

  const useAuthoritative = snapshot !== null && snapshot.employees.length > 0;
  const rows = useAuthoritative
    ? buildScheduleRowsFromSnapshot(snapshot, workspaceById)
    : buildScheduleRows(employees, threads, projects, contextByThread, queueByThread);
  const busyCount = rows.filter((r) => r.busy).length;

  return (
    <PixelPanel title="schedule">
      <div className="mb-2 text-[11px] text-muted">
        <Trans>
          {busyCount} of {rows.length} busy
        </Trans>
      </div>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted">
          <Trans>No employees yet</Trans>
        </div>
      ) : (
        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {rows.map((row) => (
            <div
              key={row.workspaceId}
              className="flex items-center gap-2 border border-[var(--hairline)] p-1.5"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: row.busy ? "var(--accent)" : "var(--hairline)",
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">{row.name}</div>
                <div className="truncate text-[11px] text-muted">
                  {row.activeThreadTitle ?? t`Idle`}
                </div>
              </div>
              {row.deadline ? (
                <span className="shrink-0 text-[10px] text-amber-600">{row.deadline}</span>
              ) : null}
              <span className="shrink-0 text-[10px] text-muted/70">
                {row.queuedCount > 0 ? t`queue: ${row.queuedCount}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 text-[10px] text-muted/60">
        {useAuthoritative ? (
          <Trans>Authoritative supervisor queue snapshot</Trans>
        ) : (
          <Trans>Authoritative supervisor queue pending channel; shows observed threads.</Trans>
        )}
      </div>
    </PixelPanel>
  );
}
