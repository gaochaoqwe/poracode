import { useLingui } from "@lingui/react/macro";
import { SCENARIO_CATEGORIES } from "@/shared/contracts";
import { startScenario } from "@/renderer/actions/scenarioActions";
import { ScenarioCard } from "@/renderer/components/scenarios/ScenarioCard";
import { SCENARIO_CATEGORY_LABELS, scenariosByCategory } from "@/renderer/scenarios/catalog";
import { SettingsPage } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";

/**
 * Browse the bundled scenario catalog, grouped by task domain. Starting a card
 * opens a draft with the prompt prefilled. Shows the *whole* catalog (unlike the
 * Home view, which narrows to the active workspace's defaults) so this is the
 * one place to see everything AgentEmployee can help with.
 */
export function ScenariosPanel() {
  const { t, i18n } = useLingui();
  const byCategory = scenariosByCategory();

  return (
    <SettingsPage
      title={t`Scenarios`}
      description={t`Task-oriented entry points. Starting one opens a draft with the prompt filled in for you to review before sending.`}
      bodyClassName="space-y-6"
    >
      {SCENARIO_CATEGORIES.map((category) => {
        const scenarios = byCategory.get(category) ?? [];
        if (scenarios.length === 0) return null;
        return (
          <section key={category} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              {i18n._(SCENARIO_CATEGORY_LABELS[category])}
            </h2>
            <div className="space-y-2">
              {scenarios.map((scenario) => (
                <ScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  onStart={() => startScenario(scenario)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </SettingsPage>
  );
}
