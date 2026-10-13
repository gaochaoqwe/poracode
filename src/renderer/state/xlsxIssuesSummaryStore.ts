import { useEffect } from "react";
import { create } from "zustand";
import type { ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import {
  parseXlsxIssuesSummary,
  XLSX_ISSUES_SUMMARY_PATH,
  type XlsxIssuesSummary,
} from "./xlsxIssuesSummary";

/**
 * Ref-counted poller for the `xlsx-issues` skill's `summary.json`, so the
 * issue-fix scenario panel shows live per-rule progress without a bespoke IPC.
 * One poll loop per project
 * (keyed by projectId), started by the right-panel host and stopped when the
 * last subscriber unmounts. We poll rather than watch because project watchers
 * are not guaranteed to be running; the file is tiny (an aggregate), so a slow
 * fixed interval is cheap.
 */

const ACTIVE_POLL_MS = 2000;

interface PollerState {
  location: ProjectLocation;
  refCount: number;
  timer: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
}

interface SummaryEntry {
  summary: XlsxIssuesSummary | null;
  loading: boolean;
}

interface XlsxIssuesSummaryStore {
  byProjectId: Record<string, SummaryEntry>;
  /** Begin a ref-counted subscription. Caller MUST invoke the returned dispose. */
  subscribe: (projectId: string, location: ProjectLocation) => () => void;
}

const pollers = new Map<string, PollerState>();

export const useXlsxIssuesSummaryStore = create<XlsxIssuesSummaryStore>((set, get) => {
  function setEntry(projectId: string, patch: Partial<SummaryEntry>): void {
    set((state) => {
      const previous = state.byProjectId[projectId] ?? { summary: null, loading: true };
      return { byProjectId: { ...state.byProjectId, [projectId]: { ...previous, ...patch } } };
    });
  }

  async function tick(projectId: string): Promise<void> {
    const poller = pollers.get(projectId);
    if (!poller || poller.cancelled) return;
    let summary: XlsxIssuesSummary | null = null;
    try {
      const result = await readBridge().readProjectFile({
        projectLocation: poller.location,
        path: XLSX_ISSUES_SUMMARY_PATH,
      });
      if (poller.cancelled) return;
      if (result.status === "ready") summary = parseXlsxIssuesSummary(result.content);
    } catch {
      // Missing file (the skill hasn't started or has no progress yet) or a
      // transient read error both mean "nothing to show".
      summary = null;
    }
    if (poller.cancelled) return;
    setEntry(projectId, { summary, loading: false });
    // The summary appears/disappears over a long task's lifetime, so keep
    // polling while subscribed instead of stopping at a terminal state.
    poller.timer = setTimeout(() => void tick(projectId), ACTIVE_POLL_MS);
  }

  return {
    byProjectId: {},
    subscribe(projectId, location) {
      const poller = pollers.get(projectId);
      if (poller) {
        poller.refCount += 1;
        if (!poller.timer) poller.timer = setTimeout(() => void tick(projectId), 0);
      } else {
        pollers.set(projectId, { location, refCount: 1, timer: null, cancelled: false });
        if (!get().byProjectId[projectId]) setEntry(projectId, { summary: null, loading: true });
        const created = pollers.get(projectId);
        if (created) created.timer = setTimeout(() => void tick(projectId), 0);
      }
      return () => {
        const active = pollers.get(projectId);
        if (!active) return;
        active.refCount = Math.max(0, active.refCount - 1);
        if (active.refCount === 0) {
          active.cancelled = true;
          if (active.timer) {
            clearTimeout(active.timer);
            active.timer = null;
          }
          pollers.delete(projectId);
        }
      };
    },
  };
});

export function selectXlsxIssuesSummary(
  state: XlsxIssuesSummaryStore,
  projectId: string | null | undefined,
): XlsxIssuesSummary | null {
  return projectId ? (state.byProjectId[projectId]?.summary ?? null) : null;
}

/** Live summary for a project (subscribes to updates), or null when absent. */
export function useXlsxIssuesSummary(
  projectId: string | null | undefined,
): XlsxIssuesSummary | null {
  return useXlsxIssuesSummaryStore((state) => selectXlsxIssuesSummary(state, projectId));
}

/** Start (ref-counted) polling for a project's summary while mounted. */
export function useXlsxIssuesSummaryPoll(
  projectId: string | null | undefined,
  location: ProjectLocation | undefined,
): void {
  const subscribe = useXlsxIssuesSummaryStore((s) => s.subscribe);
  useEffect(() => {
    if (!projectId || !location) return;
    const unsubscribe = subscribe(projectId, location);
    return unsubscribe;
  }, [projectId, location, subscribe]);
}
