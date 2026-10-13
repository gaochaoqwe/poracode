import { useState } from "react";
import { Code2, FileText, FlaskConical, Sparkles } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Project, ScenarioCategory, ThreadPresentationMode } from "@/shared/contracts";
import { SCENARIO_CATEGORIES } from "@/shared/contracts";
import { startScenario } from "@/renderer/actions/scenarioActions";
import { LightballTabs, type LightballTab } from "@/renderer/components/common/LightballTabs";
import { SCENARIO_CATEGORY_ACCENTS } from "@/renderer/components/scenarios/scenarioAccents";
import { SCENARIO_CATEGORY_LABELS, scenariosByCategory } from "@/renderer/scenarios/catalog";
import { useActiveWorkspaceCategory } from "@/renderer/state/workspaceSelectors";
import { WelcomeScenarioRail } from "./WelcomeScenarioRail";
import { WelcomeSkillRail } from "./WelcomeSkillRail";

const CATEGORY_ICONS: Record<ScenarioCategory, typeof Sparkles> = {
  general: Sparkles,
  docs: FileText,
  code: Code2,
  test: FlaskConical,
};

/**
 * The panel's own mark: an accent-gradient tile with the spark knocked out of
 * it, echoing the brand's accent dot. Drawn here rather than shipped as an
 * asset so it follows the theme accent like the rest of the app.
 */
function WelcomeMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className="size-9"
      style={{
        filter: "drop-shadow(0 6px 14px color-mix(in oklab, var(--accent) 28%, transparent))",
      }}
    >
      <defs>
        <linearGradient id="agentemployee-welcome-mark" x1="0" y1="0" x2="1" y2="1">
          <stop
            offset="0%"
            style={{ stopColor: "color-mix(in oklab, var(--accent) 60%, var(--foreground))" }}
          />
          <stop offset="100%" style={{ stopColor: "var(--accent)" }} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="10" fill="url(#agentemployee-welcome-mark)" />
      <path
        d="M16 6.4c1.08 5.19 3.33 7.44 8.52 8.52-5.19 1.08-7.44 3.33-8.52 8.52-1.08-5.19-3.33-7.44-8.52-8.52 5.19-1.08 7.44-3.33 8.52-8.52Z"
        fill="var(--background)"
      />
      <circle cx="24.6" cy="23.4" r="2.2" fill="var(--background)" />
    </svg>
  );
}

/**
 * The empty draft's welcome panel: a greeting, one tab per task category, the
 * category's scenario cards, and a rail of the skills and plugins that fit it.
 * Modelled on the reference project's welcome screen.
 *
 * Picking a card starts the scenario (prefilled draft, never auto-sent), which
 * records it as this project's active scenario — at that point the panel steps
 * aside and the draft shows the scenario's own guide card and input panel
 * instead. Rendering it is therefore the caller's "no scenario chosen yet" case.
 */
export function DraftWelcomePanel(props: {
  project: Project;
  agentKind: string;
  presentationMode: ThreadPresentationMode;
}) {
  const { i18n, t } = useLingui();
  const { project, agentKind, presentationMode } = props;
  const workspaceCategory = useActiveWorkspaceCategory();
  const [pickedCategory, setPickedCategory] = useState<ScenarioCategory | undefined>(undefined);

  // Every category is offered here, not just the workspace's curated list: the
  // tabs *are* the category switcher, so hiding a category would leave the row
  // with nothing to switch to. The workspace still picks the opening tab.
  const byCategory = scenariosByCategory();
  const visibleCategories = SCENARIO_CATEGORIES.map((id) => ({
    id,
    scenarios: byCategory.get(id) ?? [],
  })).filter((entry) => entry.scenarios.length > 0);

  const fallbackCategory =
    visibleCategories.find((entry) => entry.id === workspaceCategory)?.id ??
    visibleCategories[0]?.id;
  const activeCategory = visibleCategories.some((entry) => entry.id === pickedCategory)
    ? pickedCategory
    : fallbackCategory;
  if (!activeCategory) return null;

  const activeScenarios =
    visibleCategories.find((entry) => entry.id === activeCategory)?.scenarios ?? [];
  const tabs: LightballTab<ScenarioCategory>[] = visibleCategories.map((entry) => {
    const Icon = CATEGORY_ICONS[entry.id];
    return {
      id: entry.id,
      label: i18n._(SCENARIO_CATEGORY_LABELS[entry.id]),
      icon: <Icon aria-hidden className={`size-3 ${SCENARIO_CATEGORY_ACCENTS[entry.id]}`} />,
    };
  });

  return (
    <div data-draft-welcome="" className="mb-4 flex flex-col gap-3">
      <div className="flex flex-col items-center gap-2">
        <WelcomeMark />
        <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground">
          <Trans>
            What would you like to{" "}
            <span className="bg-clip-text text-transparent [background-image:linear-gradient(135deg,var(--foreground)_0%,color-mix(in_oklab,var(--accent)_75%,var(--foreground))_100%)] [background-size:100%_100%]">
              do today
            </span>
            ?
          </Trans>
        </h1>
      </div>
      <div className="flex justify-center">
        <LightballTabs
          tabs={tabs}
          active={activeCategory}
          onChange={setPickedCategory}
          ariaLabel={t`Task category`}
          shape="rounded"
          delayActiveText
        />
      </div>
      <WelcomeScenarioRail
        scenarios={activeScenarios}
        onStart={(scenario) => startScenario(scenario, project.id)}
      />
      <WelcomeSkillRail
        project={project}
        scenarios={activeScenarios}
        agentKind={agentKind}
        presentationMode={presentationMode}
      />
    </div>
  );
}
