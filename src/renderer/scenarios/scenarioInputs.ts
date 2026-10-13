import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import type { ScenarioInputRequirement } from "./catalog";

const codeBlockTitle = msg`REFERENCE SOURCE CODE — READ THESE FILES. The concrete details (parameters, interface boundaries, actual behavior) live in this source tree; open the files under it before drafting.`;
const codeDirLabel = msg`Directory`;
const codeExcludeLabel = msg`Library / third-party directories (write no requirements for them)`;
const codeExcludeNone = msg`none declared`;
const codeReadInstruction = msg`Read the source files under this directory with your file tools, skipping the declared library/third-party directories. Cite the file and function each detail comes from. Never write requirements or design items for generated or third-party code.`;

/**
 * Prompt block for chosen `code` inputs: the directory plus the user's
 * declaration of library/third-party directories to exclude. Empty when no
 * code directory was chosen.
 */
export function scenarioInputsPromptBlock(
  scenario: { requiredInputs?: readonly ScenarioInputRequirement[] | undefined } | undefined,
  codeSelections:
    | Readonly<Record<string, { dir: string; excludedDirs?: string[] } | undefined>>
    | undefined,
): string {
  const lines: string[] = [];
  for (const requirement of scenario?.requiredInputs ?? []) {
    if (requirement.kind !== "code") continue;
    const selection = codeSelections?.[requirement.id];
    if (!selection?.dir) continue;
    // Name each directory by its input so a scenario with more than one code
    // source (e.g. pre-change vs current) is unambiguous to the agent.
    const name = i18n._(requirement.label);
    lines.push(`${name} — ${i18n._(codeDirLabel)}: ${selection.dir}`);
    lines.push(
      `${name} — ${i18n._(codeExcludeLabel)}: ${selection.excludedDirs?.join(", ") || i18n._(codeExcludeNone)}`,
    );
  }
  return lines.length > 0
    ? `${i18n._(codeBlockTitle)}\n- ${lines.join("\n- ")}\n${i18n._(codeReadInstruction)}`
    : "";
}

/**
 * Per-input state a scenario draft collects. File inputs are satisfied by the
 * attachments tagged with that input's id; `code` inputs by a directory chosen
 * inside the project. Required-but-unsatisfied inputs gate the send button.
 */
export interface ScenarioInputState {
  /** Attachment count per scenario-input id (attachments carry the input id). */
  filesByInput: Readonly<Record<string, number>>;
  /** Chosen in-project directory per `code`-kind input id. */
  codeByInput: Readonly<Record<string, string | undefined>>;
}

/**
 * Build the per-input state from the draft's attachments and code selections.
 *
 * Transition note: until the scenario input boxes tag attachments with their
 * input id, files with no `inputId` count toward every file input (the previous
 * "any attachment satisfies the required inputs" behavior). Once any attachment
 * is tagged, counting is strict per input.
 */
export function buildScenarioInputState(
  requirements: readonly ScenarioInputRequirement[] | undefined,
  attachments: readonly { inputId?: string }[],
  codeSelections: Readonly<Record<string, { dir: string } | undefined>> | undefined,
): ScenarioInputState {
  const filesByInput: Record<string, number> = {};
  const codeByInput: Record<string, string | undefined> = {};
  if (!requirements?.length) return { filesByInput, codeByInput };

  const anyTagged = attachments.some((attachment) => attachment.inputId);
  const untagged = attachments.filter((attachment) => !attachment.inputId).length;

  for (const requirement of requirements) {
    if (requirement.kind === "code") {
      codeByInput[requirement.id] = codeSelections?.[requirement.id]?.dir;
      continue;
    }
    const tagged = attachments.filter((attachment) => attachment.inputId === requirement.id).length;
    filesByInput[requirement.id] = tagged + (anyTagged ? 0 : untagged);
  }
  return { filesByInput, codeByInput };
}

export function isScenarioInputSatisfied(
  requirement: ScenarioInputRequirement,
  state: ScenarioInputState,
): boolean {
  if (requirement.kind === "code") return Boolean(state.codeByInput[requirement.id]);
  return (state.filesByInput[requirement.id] ?? 0) >= requirement.minFiles;
}

/**
 * Required inputs a scenario's draft is still missing. The composer disables
 * send while this is non-empty, so the user supplies the basis up front.
 */
export function missingScenarioInputs(
  scenario: { requiredInputs?: readonly ScenarioInputRequirement[] | undefined } | undefined,
  state: ScenarioInputState,
): ScenarioInputRequirement[] {
  const requirements = scenario?.requiredInputs;
  if (!requirements?.length) return [];
  return requirements.filter(
    (requirement) => requirement.required && !isScenarioInputSatisfied(requirement, state),
  );
}
