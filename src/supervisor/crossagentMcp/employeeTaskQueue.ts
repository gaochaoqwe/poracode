import type { ProjectLocation, ThreadConfig, TerminalSize } from "@/shared/contracts";
import type { EmployeeQueueSnapshot } from "@/shared/ipc/events";

/**
 * P2-13 — employee-level serial queue.
 *
 * Every employee (workspace) runs at most one task at a time. When the
 * dispatcher picks a target employee who is already busy, the task is parked on
 * that employee's own FIFO line instead of being dispatched; when the running
 * member thread settles, the dispatcher pops the next parked task and dispatches
 * it. Tasks from different projects interleave naturally by arrival order — the
 * queue is per employee, not per project.
 *
 * Tie-breaking: optional ISO deadline sorts earlier first; same deadline (or
 * none) falls back to arrival order. No auto-reassignment to a sibling member of
 * equal capability — that strategy is deliberately out of scope (a comment,
 * not code).
 */

export interface EmployeeQueuedTask {
  employeeId: string;
  teamId: string;
  prompt: string;
  projectLocation: ProjectLocation;
  config: ThreadConfig;
  initialSize: TerminalSize;
  enqueuedAt: string;
  deadline?: string;
}

function urgency(task: EmployeeQueuedTask): number {
  // Earlier deadline sorts first; no deadline sorts last.
  return task.deadline ? Date.parse(task.deadline) : Number.POSITIVE_INFINITY;
}

export class EmployeeTaskQueue {
  private readonly busyEmployees = new Set<string>();
  /** employeeId → currently running task, for the snapshot's currentTask field. */
  private readonly currentTasks = new Map<string, EmployeeQueuedTask>();
  /** employeeId → parked tasks, sorted by deadline urgency then arrival order. */
  private readonly queues = new Map<string, EmployeeQueuedTask[]>();

  isBusy(employeeId: string): boolean {
    return this.busyEmployees.has(employeeId);
  }

  markBusy(employeeId: string, task: EmployeeQueuedTask): void {
    this.busyEmployees.add(employeeId);
    this.currentTasks.set(employeeId, task);
  }

  /** Free an employee; returns the next parked task (deadline-earliest) or undefined. */
  markIdle(employeeId: string): EmployeeQueuedTask | undefined {
    this.busyEmployees.delete(employeeId);
    this.currentTasks.delete(employeeId);
    return this.popNext(employeeId);
  }

  /** Park a task on the employee's line; keeps the list deadline-ordered. */
  enqueue(employeeId: string, task: EmployeeQueuedTask): void {
    const line = this.queues.get(employeeId) ?? [];
    line.push(task);
    line.sort((a, b) => urgency(a) - urgency(b) || a.enqueuedAt.localeCompare(b.enqueuedAt));
    this.queues.set(employeeId, line);
  }

  /** Parked tasks waiting on this employee (diagnostics / tests). */
  pendingFor(employeeId: string): readonly EmployeeQueuedTask[] {
    return this.queues.get(employeeId) ?? [];
  }

  /** Full snapshot: every employee we track (busy or with a parked line). */
  snapshot(): EmployeeQueueSnapshot {
    const ids = new Set<string>([...this.busyEmployees, ...this.queues.keys()]);
    return {
      updatedAt: new Date().toISOString(),
      employees: [...ids].map((employeeId) => {
        const current = this.currentTasks.get(employeeId);
        return {
          employeeId,
          busy: this.busyEmployees.has(employeeId),
          ...(current ? { currentTask: { prompt: current.prompt } } : {}),
          queue: (this.queues.get(employeeId) ?? []).map((task) => ({
            prompt: task.prompt,
            enqueuedAt: task.enqueuedAt,
            ...(task.deadline ? { deadline: task.deadline } : {}),
          })),
        };
      }),
    };
  }

  private popNext(employeeId: string): EmployeeQueuedTask | undefined {
    const line = this.queues.get(employeeId);
    if (!line || line.length === 0) return undefined;
    const next = line.shift()!;
    if (line.length === 0) this.queues.delete(employeeId);
    return next;
  }
}
