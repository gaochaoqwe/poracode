import { i18n } from "@/renderer/i18n/i18n";
import type { ScenarioView } from "./catalog";

/**
 * Whether the draft has any `code`-kind input chosen. Drives which output mode
 * the scenario recommends, so the shared picker never hardcodes an input id.
 */
export function hasReferenceCodeSelection(
  scenario: ScenarioView | undefined,
  codeSelections: Readonly<Record<string, { dir: string } | undefined>> | undefined,
): boolean {
  return Boolean(
    scenario?.requiredInputs?.some(
      (input) => input.kind === "code" && codeSelections?.[input.id]?.dir,
    ),
  );
}

/**
 * The active output-mode id: the user's stored choice when the scenario still
 * declares it, otherwise the mode recommended for the current reference-code
 * state. Undefined for scenarios that declare no output modes.
 */
export function resolveScenarioOutputMode(
  scenario: ScenarioView | undefined,
  storedMode: string | undefined,
  hasReferenceCode: boolean,
): string | undefined {
  const modes = scenario?.outputModes;
  if (!modes?.length) return undefined;
  if (storedMode && modes.some((mode) => mode.id === storedMode)) return storedMode;
  const recommended = modes.find(
    (mode) => mode.recommendedWhenReferenceSelected === hasReferenceCode,
  );
  return (recommended ?? modes[0])?.id;
}

/**
 * Prompt block for the active output mode: how the agent should prepare the
 * output directory. Empty when the scenario declares no modes (or the id does
 * not resolve), so non-mode scenarios are unaffected.
 */
export function scenarioOutputModePromptBlock(
  scenario: ScenarioView | undefined,
  modeId: string | undefined,
): string {
  const mode = scenario?.outputModes?.find((entry) => entry.id === modeId);
  return mode ? i18n._(mode.agentInstruction) : "";
}
