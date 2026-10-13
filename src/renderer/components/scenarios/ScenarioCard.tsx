import { Surface } from "@heroui/react";
import { ArrowRight } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ScenarioView } from "@/renderer/scenarios/catalog";
import { SCENARIO_CATEGORY_ACCENTS } from "./scenarioAccents";

/**
 * A scenario entry point: mark + title + one-line description, and a "Start"
 * affordance that opens a prefilled draft. Shared by the Settings "Scenarios"
 * page, the Home view, and the empty draft's welcome panel so every surface
 * reads identically.
 */
export function ScenarioCard(props: {
  scenario: ScenarioView;
  onStart: () => void;
  /** Welcome-panel density: the description holds one line and never wraps. */
  compact?: boolean;
}) {
  const { i18n } = useLingui();
  const { scenario, onStart } = props;
  const Icon = scenario.icon;
  return (
    <Surface variant="secondary" className="h-full rounded-xl">
      <button
        type="button"
        onClick={onStart}
        className="group flex h-full w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--row-hover)]"
      >
        <Icon
          aria-hidden
          className={`mt-0.5 size-4 shrink-0 ${SCENARIO_CATEGORY_ACCENTS[scenario.category]}`}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{i18n._(scenario.title)}</span>
          <span className={`text-xs text-muted${props.compact ? " line-clamp-1" : ""}`}>
            {i18n._(scenario.description)}
          </span>
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Trans>Start</Trans>
          <ArrowRight className="size-3.5" />
        </span>
      </button>
    </Surface>
  );
}
