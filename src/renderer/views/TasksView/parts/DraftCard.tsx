import type { ReactNode } from "react";
import { Button } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Pencil, SquareArrowOutUpRight, Trash2, UserRound } from "lucide-react";
import type { TaskDraft } from "@/shared/contracts";

export interface DraftCardHandlers {
  onPromote: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

interface DraftCardProps extends DraftCardHandlers {
  draft: TaskDraft;
  /** The assigned employee's display name, or null when the idea has none. */
  employeeName: string | null;
  /** Board-provided drag handle, when reordering is enabled. */
  leading?: ReactNode;
}

export function DraftCard(props: DraftCardProps) {
  const { t } = useLingui();
  const { draft } = props;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-[var(--hairline)] bg-content1/60 p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        {props.leading}
        <button
          type="button"
          className="min-w-0 flex-1 break-words text-left text-sm font-medium leading-snug hover:underline"
          onClick={props.onEdit}
        >
          {draft.title}
        </button>
      </div>
      {draft.category ? (
        <p className="break-words text-[11px] font-medium uppercase tracking-wide text-muted">
          {draft.category}
        </p>
      ) : null}
      {props.employeeName ? (
        <p className="inline-flex min-w-0 items-center gap-1 text-xs text-muted">
          <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{props.employeeName}</span>
        </p>
      ) : null}
      {draft.note ? (
        <p className="line-clamp-3 break-words text-xs text-muted">{draft.note}</p>
      ) : null}
      {/* Wraps so a narrow lane stacks the icon buttons instead of overflowing. */}
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        <Button size="sm" variant="secondary" onPress={props.onPromote}>
          <SquareArrowOutUpRight className="size-3.5" aria-hidden="true" />
          {t`Turn into task`}
        </Button>
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
