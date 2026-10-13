import { describe, expect, it } from "vitest";
import type { ScenarioInputRequirement } from "./catalog";
import {
  buildScenarioInputState,
  missingScenarioInputs,
  scenarioInputsPromptBlock,
  type ScenarioInputState,
} from "./scenarioInputs";

const label = { id: "label", message: "Label" } as const;

const inputs: ScenarioInputRequirement[] = [
  { id: "requirements", label, minFiles: 1, required: true },
  { id: "code", label, kind: "code", minFiles: 1, required: false },
  { id: "source", label, kind: "code", minFiles: 1, required: true },
];

const state = (
  filesByInput: Record<string, number> = {},
  codeByInput: Record<string, string | undefined> = {},
): ScenarioInputState => ({ filesByInput, codeByInput });

describe("missingScenarioInputs", () => {
  it("returns nothing for a scenario without required inputs", () => {
    expect(missingScenarioInputs(undefined, state())).toEqual([]);
    expect(missingScenarioInputs({}, state())).toEqual([]);
  });

  it("gates each required input independently", () => {
    expect(missingScenarioInputs({ requiredInputs: inputs }, state())).toHaveLength(2);
    expect(
      missingScenarioInputs({ requiredInputs: inputs }, state({ requirements: 1 })),
    ).toHaveLength(1);
    expect(
      missingScenarioInputs(
        { requiredInputs: inputs },
        state({ requirements: 1 }, { source: "/a" }),
      ),
    ).toEqual([]);
  });

  it("ignores optional inputs", () => {
    const requiredOnly: ScenarioInputRequirement[] = [inputs[0]!];
    expect(missingScenarioInputs({ requiredInputs: requiredOnly }, state())).toHaveLength(1);
    expect(
      missingScenarioInputs({ requiredInputs: requiredOnly }, state({ requirements: 1 })),
    ).toEqual([]);
  });

  it("counts files per input id, not globally", () => {
    expect(
      missingScenarioInputs({ requiredInputs: [inputs[0]!] }, state({ other: 5 })),
    ).toHaveLength(1);
  });
});

describe("buildScenarioInputState", () => {
  const fileInput: ScenarioInputRequirement = {
    id: "material",
    label,
    minFiles: 1,
    required: true,
  };
  const codeInput: ScenarioInputRequirement = {
    id: "code",
    label,
    kind: "code",
    minFiles: 1,
    required: false,
  };

  it("counts strictly once attachments are tagged", () => {
    const built = buildScenarioInputState(
      [fileInput, codeInput],
      [{ inputId: "material" }, { inputId: "material" }],
      { code: { dir: "/repo/src" } },
    );
    expect(built.filesByInput).toEqual({ material: 2 });
    expect(built.codeByInput).toEqual({ code: "/repo/src" });
  });

  it("credits untagged attachments to file inputs while nothing is tagged", () => {
    const built = buildScenarioInputState([fileInput], [{}, {}], undefined);
    expect(built.filesByInput).toEqual({ material: 2 });
  });
});

describe("scenarioInputsPromptBlock", () => {
  const codeInput: ScenarioInputRequirement = {
    id: "code",
    label,
    kind: "code",
    minFiles: 1,
    required: false,
  };

  it("is empty without a chosen code directory", () => {
    expect(scenarioInputsPromptBlock({ requiredInputs: [codeInput] }, undefined)).toBe("");
  });

  it("includes the directory and the exclusion declaration", () => {
    const block = scenarioInputsPromptBlock(
      { requiredInputs: [codeInput] },
      { code: { dir: "/repo/src", excludedDirs: ["third_party", "vendor"] } },
    );
    expect(block).toContain("/repo/src");
    expect(block).toContain("third_party, vendor");
  });
});
