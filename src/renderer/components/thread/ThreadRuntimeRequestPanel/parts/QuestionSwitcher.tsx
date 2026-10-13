import { Check } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { UserInputFormAnswer, UserInputFormQuestion } from "../userInputForm";
import { questionHasAnswer } from "../userInputForm";

export function QuestionSwitcher(props: {
  questions: readonly UserInputFormQuestion[];
  answers: Record<string, UserInputFormAnswer>;
  customAnswers: Record<string, string>;
  activeIndex: number;
  isDisabled: boolean;
  onSelect: (index: number) => void;
}) {
  const { questions, answers, customAnswers, activeIndex, isDisabled, onSelect } = props;
  const { t } = useLingui();
  if (questions.length <= 1) return null;
  return (
    <div role="tablist" aria-label={t`Questions`} className="flex gap-1 overflow-x-auto">
      {questions.map((question, index) => {
        const isActive = index === activeIndex;
        const hasAnswer = questionHasAnswer(question, answers, customAnswers);
        return (
          <button
            key={question.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={isDisabled}
            onClick={() => onSelect(index)}
            className={`flex min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors disabled:opacity-60 ${
              isActive
                ? "bg-[var(--content-background)] font-medium text-foreground shadow-sm"
                : "text-[color:var(--muted)] hover:bg-foreground/5 hover:text-foreground"
            }`}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-foreground/20 text-[9px] [font-variant-numeric:tabular-nums]">
              {hasAnswer ? <Check className="size-2.5" /> : index + 1}
            </span>
            <span className="max-w-32 truncate">{question.header}</span>
          </button>
        );
      })}
    </div>
  );
}
