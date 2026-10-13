import { Button, Surface } from "@heroui/react";
import { Sparkles, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ScenarioView } from "@/renderer/scenarios/catalog";

/**
 * Dismissible guide shown above a draft's composer when the draft was started
 * from a scenario: the scenario name plus its usage steps, in order. The steps
 * are the same ones baked into the prefilled prompt, so the user can follow
 * them while reviewing before sending.
 */
export function ScenarioGuideCard(props: { scenario: ScenarioView; onDismiss: () => void }) {
  const { i18n, t } = useLingui();
  const { scenario, onDismiss } = props;
  return (
    <Surface variant="secondary" className="mb-2 rounded-xl">
      <div className="flex items-start gap-2 px-4 py-3">
        <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{i18n._(scenario.title)}</span>
          <div className="text-xs text-muted">
            <Trans>Steps</Trans>
          </div>
          <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs text-muted">
            {scenario.steps.map((step, index) => (
              <li key={index}>{i18n._(step)}</li>
            ))}
          </ol>
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="tertiary"
          aria-label={t`Close`}
          onPress={onDismiss}
          className="shrink-0"
        >
          <X className="size-4" />
        </Button>
      </div>
    </Surface>
  );
}
