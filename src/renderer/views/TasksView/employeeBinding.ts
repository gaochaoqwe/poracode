import type { Workspace } from "@/shared/contracts";

/**
 * The provider/model binding a task inherits from its assigned employee. The
 * employee (a workspace) is the single source of truth for "who runs this
 * work", so the task editor reads the binding from here instead of asking the
 * user to pick an agent.
 */
export interface EmployeeBinding {
  agentKind: string;
  model: string;
  effort: string;
  fast: boolean;
}

/**
 * Resolve an employee's provider/model binding, or `null` when the employee
 * cannot run work yet (no provider configured, or no model resolved). A task
 * assigned to such an employee can't be saved, which surfaces the gap at
 * creation time rather than as a failed run later.
 */
export function employeeBinding(employee: Workspace | undefined): EmployeeBinding | null {
  if (!employee?.agentKind) return null;
  const model = employee.defaultThreadConfig?.model;
  if (!model) return null;
  return {
    agentKind: employee.agentKind,
    model,
    effort: employee.defaultThreadConfig?.effort ?? "",
    fast: employee.defaultThreadConfig?.fast ?? false,
  };
}

/**
 * Split a workspace list into the employees that can run tasks and those that
 * cannot, so the picker can disable the latter with an explanation instead of
 * hiding them (a hidden employee looks like a bug).
 */
export function partitionEmployees(workspaces: readonly Workspace[]): {
  runnable: Workspace[];
  blocked: Workspace[];
} {
  const runnable: Workspace[] = [];
  const blocked: Workspace[] = [];
  for (const workspace of workspaces) {
    if (employeeBinding(workspace)) runnable.push(workspace);
    else blocked.push(workspace);
  }
  return { runnable, blocked };
}
