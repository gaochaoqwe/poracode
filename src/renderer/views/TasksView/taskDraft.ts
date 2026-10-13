import type { ProjectTaskSettings, Task, TaskInput, TaskIsolation } from "@/shared/contracts";
import { normalizeTaskCategory } from "@/shared/contracts";
import type { EmployeeBinding } from "./employeeBinding";

/** `none` = a plain manual task with no schedule. */
export type RepeatMode = "none" | "hourly" | "daily" | "weekdays" | "weekly" | "custom" | "once";

export interface TaskDraftForm {
  id?: string;
  title: string;
  /** Free-form category label; `""` means uncategorized. */
  category: string;
  prompt: string;
  /**
   * The digital employee the task is handed to. The employee owns the
   * provider/model binding, so the editor no longer asks for an agent directly.
   * `""` means the user hasn't chosen one yet (the editor blocks saving).
   */
  employeeId: string;
  /** Target project for the run's thread; `null` = the built-in "Home" scope. */
  projectId: string | null;
  isolation: TaskIsolation;
  repeatMode: RepeatMode;
  days: number[];
  time: string;
  runAt: string;
}

function localDateTimeInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Localized short weekday names indexed by JS day-of-week (0 = Sunday).
 * 2026-01-04 is a Sunday, so day 0..6 maps to Sun..Sat.
 */
export function weekdayShortNames(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  return Array.from({ length: 7 }, (_, day) => formatter.format(new Date(2026, 0, 4 + day)));
}

export interface NewTaskDefaults {
  /** The board's filtered project, or `null` for the Home scope. */
  projectId?: string | null;
  /** The project's saved task defaults, when it has any. */
  settings?: ProjectTaskSettings;
  /** Employee to preselect (e.g. when the board is scoped to one). */
  employeeId?: string;
}

/**
 * A fresh draft for the New-task dialog. The employee carries the provider
 * binding, so the caller seeds `employeeId`; everything else is either the
 * project's saved defaults or a sensible literal.
 */
export function newTaskDraft(defaults?: NewTaskDefaults): TaskDraftForm {
  const settings = defaults?.settings;
  const projectId = defaults?.projectId ?? null;
  // The Home scope has no git repo, so a worktree is impossible there.
  const isolation: TaskIsolation =
    projectId == null ? "project" : (settings?.isolation ?? "project");
  return {
    title: "",
    category: "",
    prompt: "",
    employeeId: defaults?.employeeId ?? "",
    projectId,
    isolation,
    repeatMode: "none",
    days: [1, 2, 3, 4, 5],
    time: "08:00",
    runAt: localDateTimeInputValue(new Date(Date.now() + 60 * 60 * 1000)),
  };
}

function repeatModeForTask(task: Task): RepeatMode {
  const recurrence = task.recurrence;
  if (!recurrence) return "none";
  if (recurrence.kind === "hourly") return "hourly";
  if (recurrence.kind === "once") return "once";
  if (recurrence.days.length === 7) return "daily";
  if (recurrence.days.join(",") === "1,2,3,4,5") return "weekdays";
  if (recurrence.days.length === 1) return "weekly";
  return "custom";
}

export function taskDraftFromTask(task: Task): TaskDraftForm {
  const recurrence = task.recurrence;
  return {
    id: task.id,
    title: task.title,
    category: task.category ?? "",
    prompt: task.prompt,
    employeeId: task.employeeId ?? "",
    projectId: task.projectId ?? null,
    isolation: task.isolation,
    repeatMode: repeatModeForTask(task),
    days: recurrence?.kind === "weekly" ? recurrence.days : [1, 2, 3, 4, 5],
    time:
      recurrence?.kind === "weekly"
        ? recurrence.time
        : recurrence?.kind === "hourly"
          ? `00:${String(recurrence.minute).padStart(2, "0")}`
          : "08:00",
    runAt:
      recurrence?.kind === "once"
        ? localDateTimeInputValue(new Date(recurrence.runAt))
        : localDateTimeInputValue(new Date(Date.now() + 60 * 60 * 1000)),
  };
}

function daysForMode(draft: TaskDraftForm): number[] {
  if (draft.repeatMode === "daily") return [0, 1, 2, 3, 4, 5, 6];
  if (draft.repeatMode === "weekdays") return [1, 2, 3, 4, 5];
  if (draft.repeatMode === "weekly") return [draft.days[0] ?? 1];
  return draft.days;
}

/**
 * Draft → `TaskInput`. The employee owns the provider binding, so the caller
 * passes the resolved employee map; a draft whose employee vanished (or has no
 * provider) can't be converted and the caller blocks saving first. An existing
 * task keeps its stored `agentKind`/`config` when the employee no longer
 * resolves, so editing an old task never silently rewrites its provider.
 */
export function taskDraftInput(
  draft: TaskDraftForm,
  employees: ReadonlyMap<string, EmployeeBinding>,
  fallback?: { agentKind: string; model: string; effort?: string; fast?: boolean },
): TaskInput {
  const recurrence =
    draft.repeatMode === "none"
      ? null
      : draft.repeatMode === "once"
        ? ({ kind: "once", runAt: new Date(draft.runAt).toISOString() } as const)
        : draft.repeatMode === "hourly"
          ? ({ kind: "hourly", minute: Number(draft.time.slice(3, 5)) } as const)
          : ({ kind: "weekly", days: daysForMode(draft), time: draft.time } as const);
  const binding = employees.get(draft.employeeId) ?? fallback;
  const agentKind = binding?.agentKind ?? "";
  const model = binding?.model ?? "";
  const effort = binding?.effort ?? "";
  const fast = binding?.fast ?? false;
  return {
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
    employeeId: draft.employeeId || null,
    agentKind,
    category: normalizeTaskCategory(draft.category),
    projectId: draft.projectId,
    isolation: draft.isolation,
    recurrence,
    scheduleEnabled: recurrence !== null,
    config: {
      model,
      ...(effort ? { effort } : {}),
      ...(fast ? { fast: true } : {}),
    },
  };
}

/**
 * A draft can be saved only when it has the content a run needs: a title, a
 * prompt, a category (the board groups every lane by it), an employee that
 * resolves to a provider + model, and valid schedule parameters. The employee
 * check is what replaces the old agent/model check.
 */
export function taskDraftIsValid(
  draft: TaskDraftForm,
  employees: ReadonlyMap<string, EmployeeBinding>,
): boolean {
  return Boolean(
    draft.title.trim() &&
    draft.prompt.trim() &&
    normalizeTaskCategory(draft.category) !== null &&
    employees.has(draft.employeeId) &&
    (draft.repeatMode === "none" ||
      (draft.repeatMode === "once"
        ? Number.isFinite(new Date(draft.runAt).getTime())
        : draft.repeatMode === "custom" || draft.repeatMode === "weekly"
          ? draft.days.length > 0 && draft.time
          : draft.time)),
  );
}
