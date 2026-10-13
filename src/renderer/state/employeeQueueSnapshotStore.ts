import { create } from "zustand";
import { readBridge } from "@/renderer/bridge";

/**
 * One staged/queued task in front of an employee. The authoritative supervisor
 * emits these; fields are all tolerant so a partial future payload degrades
 * gracefully instead of throwing.
 */
export interface EmployeeQueueTask {
  prompt: string;
  projectId?: string | undefined;
  projectName?: string | undefined;
  deadline?: string | undefined;
  enqueuedAt?: string | undefined;
}

export interface EmployeeQueueSnapshotEntry {
  employeeId: string;
  busy: boolean;
  currentTask?: EmployeeQueueTask | undefined;
  queue: EmployeeQueueTask[];
}

/** Authoritative per-employee queue snapshot broadcast by the supervisor. */
export interface EmployeeQueueSnapshot {
  updatedAt: string;
  employees: EmployeeQueueSnapshotEntry[];
}

interface EmployeeQueueSnapshotState {
  snapshot: EmployeeQueueSnapshot | null;
  set: (snapshot: EmployeeQueueSnapshot) => void;
  reset: () => void;
}

/**
 * Latest authoritative employee-queue snapshot. Populated by the main-window
 * bridge subscription (see `installEmployeeQueueSnapshotSync`); the schedule
 * view reads it through a narrow selector and falls back to thread-derived
 * state while no snapshot has arrived.
 */
export const useEmployeeQueueSnapshotStore = create<EmployeeQueueSnapshotState>((set) => ({
  snapshot: null,
  set: (snapshot) => set({ snapshot }),
  reset: () => set({ snapshot: null }),
}));

/**
 * Tolerant subscription to the supervisor's `onEmployeeQueueSnapshot` broadcast.
 * The channel may not exist on the bridge type yet (landed by the supervisor
 * workstream); the listener registers optimistically and becomes a direct typed
 * call once it ships. Returns an unsubscribe.
 */
export function installEmployeeQueueSnapshotSync(): () => void {
  const bridge = readBridge() as {
    onEmployeeQueueSnapshot?: (listener: (snapshot: EmployeeQueueSnapshot) => void) => () => void;
  };
  return (
    bridge.onEmployeeQueueSnapshot?.((snapshot) => {
      useEmployeeQueueSnapshotStore.getState().set(snapshot);
    }) ?? (() => undefined)
  );
}
