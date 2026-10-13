import { Tooltip } from "@heroui/react";
import { Check } from "lucide-react";
import type { UserInputOption } from "@/shared/contracts";

export function QuestionOptionRow(props: {
  index: number;
  option: UserInputOption;
  isDisabled: boolean;
  onClick: () => void;
  /** Single-select forms can mark the saved choice without changing row shape. */
  selected?: boolean;
  /** When defined, the row renders a checkbox marker (multi-select). */
  checked?: boolean;
}) {
  const { isDisabled, option, onClick, selected, checked } = props;
  const isMultiSelect = checked !== undefined;
  const isSelected = isMultiSelect ? checked === true : selected === true;
  const tooltipBody = option.description ? (
    <div className="max-w-[28rem] space-y-1 whitespace-normal break-words">
      <div className="text-xs font-medium text-foreground">{option.label}</div>
      <div className="text-[11px] text-[color:var(--muted)]">{option.description}</div>
    </div>
  ) : null;

  const row = (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      disabled={isDisabled}
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-[background-color,box-shadow] duration-150 focus-visible:outline-none disabled:opacity-60 disabled:hover:shadow-[inset_0_0_0_1px_var(--border)] ${
        isSelected
          ? "bg-[color-mix(in_oklab,var(--accent)_10%,var(--content-background))] shadow-[inset_0_0_0_1.5px_var(--accent)]"
          : "bg-[var(--content-background)] shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[inset_0_0_0_1px_var(--accent)]"
      }`}
    >
      {isMultiSelect ? (
        <span
          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] transition-colors ${
            isSelected
              ? "bg-accent text-accent-foreground"
              : "text-transparent shadow-[inset_0_0_0_1.5px_var(--muted)]"
          }`}
        >
          <Check className="size-2.5" strokeWidth={3} aria-hidden />
        </span>
      ) : (
        <span
          className={`mt-0.5 size-4 shrink-0 rounded-full transition-colors ${
            isSelected
              ? "shadow-[inset_0_0_0_5px_var(--accent)]"
              : "shadow-[inset_0_0_0_1.5px_var(--muted)]"
          }`}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">
          {option.label}
        </span>
        {option.description ? (
          <span className="mt-0.5 block text-xs leading-snug text-[color:var(--muted)]">
            {option.description}
          </span>
        ) : null}
      </span>
    </button>
  );

  if (!tooltipBody) return row;
  return (
    <Tooltip delay={400}>
      <Tooltip.Trigger className="flex w-full min-h-0 flex-col" tabIndex={-1} role="none">
        {row}
      </Tooltip.Trigger>
      <Tooltip.Content placement="right" showArrow className="max-w-[28rem] break-words text-xs">
        {tooltipBody}
      </Tooltip.Content>
    </Tooltip>
  );
}
