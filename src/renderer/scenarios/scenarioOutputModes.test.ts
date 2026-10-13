import { describe, expect, it } from "vitest";
import type { ScenarioInputRequirement, ScenarioOutputMode, ScenarioView } from "./catalog";
import {
  hasReferenceCodeSelection,
  resolveScenarioOutputMode,
  scenarioOutputModePromptBlock,
} from "./scenarioOutputModes";

const label = { id: "label", message: "Label" } as const;

const modes: ScenarioOutputMode[] = [
  {
    id: "reuse",
    label,
    agentInstruction: { id: "reuse.instruction", message: "Reuse the reference code." },
    recommendedWhenReferenceSelected: true,
  },
  {
    id: "scratch",
    label,
    agentInstruction: { id: "scratch.instruction", message: "Start from scratch." },
    recommendedWhenReferenceSelected: false,
  },
];

const inputs: ScenarioInputRequirement[] = [
  { id: "basis", label, minFiles: 1, required: true },
  { id: "code", label, kind: "code", minFiles: 1, required: false },
];

const scenario = {
  id: "s",
  category: "code",
  title: label,
  description: label,
  steps: [],
  requiredInputs: inputs,
  outputModes: modes,
} as unknown as ScenarioView;

describe("hasReferenceCodeSelection", () => {
  it("is true only when a code-kind input has a chosen directory", () => {
    expect(hasReferenceCodeSelection(scenario, { code: { dir: "/repo/ref" } })).toBe(true);
    expect(hasReferenceCodeSelection(scenario, { basis: { dir: "/repo/ref" } })).toBe(false);
    expect(hasReferenceCodeSelection(scenario, undefined)).toBe(false);
    expect(hasReferenceCodeSelection(undefined, { code: { dir: "/repo/ref" } })).toBe(false);
  });
});

describe("resolveScenarioOutputMode", () => {
  it("is undefined for scenarios that declare no output modes", () => {
    const plain = { id: "plain", requiredInputs: inputs } as unknown as ScenarioView;
    expect(resolveScenarioOutputMode(undefined, undefined, false)).toBeUndefined();
    expect(resolveScenarioOutputMode(plain, "reuse", true)).toBeUndefined();
  });

  it("honours a stored mode that is still declared", () => {
    expect(resolveScenarioOutputMode(scenario, "scratch", true)).toBe("scratch");
  });

  it("falls back to the mode recommended for the reference-code state", () => {
    expect(resolveScenarioOutputMode(scenario, undefined, true)).toBe("reuse");
    expect(resolveScenarioOutputMode(scenario, undefined, false)).toBe("scratch");
    // An unknown stored id (e.g. from an older catalog) is ignored.
    expect(resolveScenarioOutputMode(scenario, "gone", false)).toBe("scratch");
  });
});

describe("scenarioOutputModePromptBlock", () => {
  it("is empty without a scenario or a resolved mode", () => {
    expect(scenarioOutputModePromptBlock(undefined, "reuse")).toBe("");
    expect(scenarioOutputModePromptBlock(scenario, undefined)).toBe("");
    expect(scenarioOutputModePromptBlock(scenario, "gone")).toBe("");
  });

  it("returns the active mode's instruction", () => {
    expect(scenarioOutputModePromptBlock(scenario, "reuse")).toContain("Reuse the reference code.");
    expect(scenarioOutputModePromptBlock(scenario, "scratch")).toContain("Start from scratch.");
  });
});
