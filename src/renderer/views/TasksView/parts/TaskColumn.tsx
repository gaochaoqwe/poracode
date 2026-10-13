import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/react";
import type { TaskColumn as TaskColumnId } from "@/shared/contracts";

/** Every board lane, with the bar tone each header carries. */
const COLUMN_TONE: Record<string, string> = {
  draft: "bg-amber-500/60",
  todo: "bg-muted-foreground/50",
  inProgress: "bg-primary",
  attention: "bg-amber-500",
  done: "bg-emerald-500",
};

interface TaskColumnProps {
  /** A task lane, or `"draft"` for the idea lane (never a drop target). */
  columnId: TaskColumnId | "draft";
  label: string;
  count: number;
  emptyLabel: string;
  /**
   * Accepts dropped task cards — set for the in-progress lane, where a drop
   * starts the task. The hook is always called so this stays a valid component
   * regardless of the flag.
   */
  dropEnabled?: boolean;
  children: ReactNode;
}

export function TaskColumn(props: TaskColumnProps) {
  const { ref } = useDroppable({
    id: `task-column:${props.columnId}`,
    accept: "task-card",
    data: { type: "task-column", column: props.columnId },
    disabled: !props.dropEnabled,
  });
  return (
    // `min-w-0` lets the lane shrink with the grid track instead of holding at
    // its content's intrinsic width, which is what made a card overflow its
    // lane once the window got narrow.
    <div ref={ref} className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex h-6 shrink-0 items-center gap-2 px-0.5">
        <span
          className={`h-3.5 w-[3px] shrink-0 rounded-full ${COLUMN_TONE[props.columnId]}`}
          aria-hidden="true"
        />
        <h2 className="truncate text-xs font-semibold">{props.label}</h2>
        <span className="shrink-0 rounded-full bg-muted/70 px-1.5 py-0.5 text-[0.625rem] font-medium leading-none text-muted-foreground tabular-nums">
          {props.count}
        </span>
      </div>
      {props.count === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 p-4 text-center">
          <p className="text-xs text-muted">{props.emptyLabel}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-0.5 pb-1">
          {props.children}
        </div>
      )}
    </div>
  );
}
