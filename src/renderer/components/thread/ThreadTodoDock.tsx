import { useEffect, useRef } from "react";
import { Check, ChevronDown, ListChecks, X } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { ThreadDocksPlacement } from "@/shared/settings";
import { ThreadDocksPlacementToggle } from "./ThreadDocksPlacementToggle";
import { AnimatedFraction } from "@/renderer/components/common/AnimatedNumber";
import type { ThreadTodoDockState, ThreadTodoStepStatus } from "./threadTodoState";
import {
  ThreadDockHeader,
  ThreadDockIconButton,
  ThreadDockList,
  ThreadDockRow,
  ThreadDockSection,
} from "./ThreadDockUI";

interface ThreadTodoDockProps {
  state: ThreadTodoDockState;
  placement: ThreadDocksPlacement;
  collapsed: boolean;
  showPlacementToggle?: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onRetire: () => void;
}

export function ThreadTodoDock(props: ThreadTodoDockProps) {
  const {
    state,
    placement,
    collapsed,
    showPlacementToggle = false,
    onCollapsedChange,
    onRetire,
  } = props;
  const { t } = useLingui();
  const activeRowRef = useRef<HTMLLIElement>(null);
  // Identity of the row the ref below attaches to (mirrors the row keys in
  // the list). Scrolling looks the row up by this key, so every identity
  // change re-arms the scroll for the new row.
  const activeRowKey = `${state.sourceItemId}:${state.activeIndex}`;

  useEffect(() => {
    if (collapsed) return;
    // No rows, no active row to reveal.
    if (state.steps.length === 0) return;
    const list = activeRowRef.current?.parentElement;
    const row = list?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(activeRowKey)}"]`);
    if (typeof row?.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [collapsed, activeRowKey, state.steps.length]);

  const inProgressStepIndices = state.steps
    .map((s, i) => (s.status === "in_progress" ? i : -1))
    .filter((i) => i !== -1);

  const displayedStepIndices = collapsed
    ? inProgressStepIndices.length > 0
      ? inProgressStepIndices
      : [state.activeIndex]
    : state.steps.map((_, i) => i);

  if (displayedStepIndices.length === 0) return null;

  const completedCount = state.steps.reduce(
    (count, step) => (step.status === "completed" ? count + 1 : count),
    0,
  );
  const countLabel = <AnimatedFraction value={completedCount} total={state.steps.length} />;

  return (
    <ThreadDockSection ariaLabel={t`Thread todo dock`} placement={placement} collapsed={collapsed}>
      <ThreadDockHeader
        icon={ListChecks}
        title={t`Plan`}
        countLabel={countLabel}
        actions={
          <>
            {showPlacementToggle ? <ThreadDocksPlacementToggle placement="composer" /> : null}
            <ThreadDockIconButton
              label={collapsed ? t`Expand todo dock` : t`Collapse todo dock`}
              tooltip={collapsed ? t`Expand` : t`Collapse`}
              onPress={() => onCollapsedChange(!collapsed)}
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${collapsed ? "-rotate-90" : "rotate-0"}`}
              />
            </ThreadDockIconButton>
            <ThreadDockIconButton label={t`Close plan`} danger onPress={onRetire}>
              <X className="size-3.5" />
            </ThreadDockIconButton>
          </>
        }
      />

      <ThreadDockList placement={placement} collapsed={collapsed}>
        {displayedStepIndices.map((index) => {
          const step = state.steps[index];
          if (!step) return null;
          const isActive = index === state.activeIndex;
          const isDone = step.status === "completed";
          return (
            <ThreadDockRow
              key={`${state.sourceItemId}:${index}`}
              ref={isActive ? activeRowRef : undefined}
              rowKey={`${state.sourceItemId}:${index}`}
              isActive={isActive}
              isDone={isDone}
              title={step.text}
            >
              <StatusIcon status={step.status} />
              <span
                className={`min-w-0 flex-1 truncate leading-5 ${
                  isDone
                    ? "text-foreground-muted line-through decoration-foreground-muted/60"
                    : "text-foreground"
                }`}
              >
                {step.text}
              </span>
            </ThreadDockRow>
          );
        })}
      </ThreadDockList>
    </ThreadDockSection>
  );
}

function StatusIcon({ status }: { status: ThreadTodoStepStatus }) {
  const { t } = useLingui();
  switch (status) {
    case "completed":
      return (
        <span
          role="img"
          aria-label={t`completed`}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
        >
          <Check className="size-3" strokeWidth={2.5} aria-hidden />
        </span>
      );
    case "in_progress":
      return (
        <span
          role="img"
          aria-label={t`In progress`}
          className="size-5 shrink-0 rounded-full border-2 border-foreground/20 border-t-accent motion-safe:animate-spin motion-reduce:animate-none"
        />
      );
    default:
      return (
        <span
          role="img"
          aria-label={t`pending`}
          className="size-5 shrink-0 rounded-full border-[1.5px] border-foreground/25"
        />
      );
  }
}
