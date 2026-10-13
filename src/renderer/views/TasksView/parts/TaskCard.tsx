import type { ReactNode } from "react";
import { Button, Chip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import {
  CalendarClock,
  FolderGit2,
  FolderOpen,
  MessagesSquare,
  Pencil,
  Play,
  Square,
  Trash2,
  UserRound,
} from "lucide-react";
import type { Task, TaskRecurrence } from "@/shared/contracts";

export interface TaskCardHandlers {
  onStart: () => void;
  onStop: () => void;
  onOpenSession: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

interface TaskCardProps extends TaskCardHandlers {
  task: Task;
  projectName: string | null;
  /** The assigned employee's display name, or null when the task has none. */
  employeeName: string | null;
  /**
   * Optional node placed before the title — the board passes the drag handle
   * here (a slot rather than a ref prop, which the compiler treats as a ref).
   */
  leading?: ReactNode;
}

function formatDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function TaskCard(props: TaskCardProps) {
  const { t, i18n } = useLingui();
  const { task } = props;
  // An awaiting-input run is still live (its thread is parked on the user), so
  // it offers Stop rather than Start.
  const running = task.status === "in_progress" || task.status === "awaiting_input";
  const canStart = !running;
  const scheduleLabel = task.recurrence ? scheduleSummary(task.recurrence, i18n.locale, t) : null;

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--hairline)] bg-content1 p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        {props.leading}
        <button
          type="button"
          className="min-w-0 flex-1 break-words text-left text-sm font-medium leading-snug hover:underline"
          onClick={props.onEdit}
        >
          {task.title}
        </button>
        {task.status === "failed" && task.lastError ? (
          <Chip size="sm" variant="soft" color="danger">
            {t`Failed`}
          </Chip>
        ) : null}
        {task.status === "awaiting_input" ? (
          <Chip size="sm" variant="soft" className="text-amber-600 dark:text-amber-400">
            {t`Needs you`}
          </Chip>
        ) : null}
        {task.status === "cancelled" ? (
          <Chip size="sm" variant="soft">
            {t`Stopped`}
          </Chip>
        ) : null}
      </div>

      {task.category ? (
        <p className="break-words text-[11px] font-medium uppercase tracking-wide text-muted">
          {task.category}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {props.employeeName ? (
          <span className="inline-flex min-w-0 items-center gap-1 font-medium text-foreground/80">
            <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{props.employeeName}</span>
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          {task.isolation === "worktree" ? (
            <FolderGit2 className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <FolderOpen className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          {task.isolation === "worktree" ? t`Worktree` : t`Project directory`}
        </span>
        {props.projectName ? <span className="min-w-0 truncate">{props.projectName}</span> : null}
        {task.recurrence ? (
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
            {scheduleLabel}
          </span>
        ) : null}
      </div>

      {task.nextRunAt ? (
        <p className="break-words text-xs text-muted">
          {t`Next run: ${formatDateTime(task.nextRunAt, i18n.locale)}`}
        </p>
      ) : null}
      {task.lastError ? (
        <p className="line-clamp-2 break-words text-xs text-danger">{task.lastError}</p>
      ) : null}

      {/* Wraps rather than overflowing: a narrow lane drops the trailing
          icon buttons onto a second line instead of pushing them out of view. */}
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        {running ? (
          <Button size="sm" variant="tertiary" onPress={props.onStop}>
            <Square className="size-3.5" aria-hidden="true" />
            {t`Stop`}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" isDisabled={!canStart} onPress={props.onStart}>
            <Play className="size-3.5" aria-hidden="true" />
            {t`Start`}
          </Button>
        )}
        {task.threadId ? (
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label={t`Open session`}
            onPress={props.onOpenSession}
          >
            <MessagesSquare className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" isIconOnly aria-label={t`Edit`} onPress={props.onEdit}>
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          aria-label={t`Delete`}
          onPress={props.onDelete}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function scheduleSummary(
  recurrence: TaskRecurrence,
  locale: string,
  t: (strings: TemplateStringsArray, ...values: unknown[]) => string,
): string {
  if (recurrence.kind === "once") {
    return t`Once`;
  }
  if (recurrence.kind === "hourly") {
    return t`Hourly`;
  }
  const weekdays = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const days = recurrence.days.map((day) => weekdays.format(new Date(2026, 0, 4 + day))).join(", ");
  return `${days} ${recurrence.time}`;
}
