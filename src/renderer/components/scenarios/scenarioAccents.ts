import type { ScenarioCategory } from "@/shared/contracts";

/**
 * Accent per task category, used for the category's tab icon and the cards
 * under it. Colors come from the app's project-icon palette, which is defined
 * per theme — so an accent stays legible in light and dark alike. Written out
 * as full class strings on purpose: a template-built class name would not
 * survive Tailwind's scan.
 */
export const SCENARIO_CATEGORY_ACCENTS: Record<ScenarioCategory, string> = {
  general: "text-[color:var(--project-icon-amber)]",
  docs: "text-[color:var(--project-icon-blue)]",
  code: "text-[color:var(--project-icon-green)]",
  test: "text-[color:var(--project-icon-violet)]",
};
