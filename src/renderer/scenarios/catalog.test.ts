import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCENARIO_CATEGORIES } from "@/shared/contracts";
import {
  DEFAULT_SCENARIO_IDS_BY_CATEGORY,
  DEFAULT_WORKSPACE_CATEGORIES,
  SCENARIOS,
  SCENARIO_SUBGROUP_LABELS,
  SCENARIO_SUBGROUPS,
  groupScenariosForDisplay,
  scenarioById,
  scenariosByCategory,
} from "./catalog";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Every skill folder name the app can lead a scenario with (bundled + plugin-contributed). */
function availableSkillNames(): Set<string> {
  const names = new Set<string>();
  const addDirs = (root: string) => {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) names.add(entry.name);
    }
  };
  addDirs(join(repoRoot, "resources", "skills"));
  const pluginsRoot = join(repoRoot, "resources", "plugins");
  for (const plugin of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue;
    const skillsRoot = join(pluginsRoot, plugin.name, "skills");
    try {
      addDirs(skillsRoot);
    } catch {
      // A plugin with no skills folder contributes none.
    }
  }
  return names;
}

describe("scenario catalog", () => {
  it("has unique ids and in-range categories", () => {
    const ids = SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scenario of SCENARIOS) {
      expect(SCENARIO_CATEGORIES).toContain(scenario.category);
      expect(scenario.title.message).toBeTruthy();
      expect(scenario.description.message).toBeTruthy();
      // A scenario authored without a prompt opens an empty composer (see the
      // "empty composer" test); any scenario that has one must carry copy.
      expect(scenario.prompt === undefined || (scenario.prompt.message?.length ?? 0) > 0).toBe(
        true,
      );
    }
  });

  it("gives every scenario a non-empty usage step list", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.steps.length).toBeGreaterThan(0);
      for (const step of scenario.steps) {
        expect((step.message ?? "").trim()).toBeTruthy();
      }
    }
  });

  it("groups every scenario and back-indexes by id", () => {
    expect([...scenariosByCategory().values()].flat()).toHaveLength(SCENARIOS.length);
    for (const scenario of SCENARIOS) {
      expect(scenarioById(scenario.id)).toBe(scenario);
    }
    expect(scenarioById("does-not-exist")).toBeUndefined();
  });

  it("seeds only ids that exist in the catalog", () => {
    for (const ids of Object.values(DEFAULT_SCENARIO_IDS_BY_CATEGORY)) {
      for (const id of ids) {
        expect(scenarioById(id)).toBeDefined();
      }
    }
  });

  it("points every leadingSkillId at a skill folder that actually exists", () => {
    const available = availableSkillNames();
    for (const scenario of SCENARIOS) {
      if (!scenario.leadingSkillId) continue;
      expect(
        available.has(scenario.leadingSkillId),
        `${scenario.id} -> ${scenario.leadingSkillId}`,
      ).toBe(true);
    }
  });

  it("maps each default workspace to a distinct valid category", () => {
    expect(new Set(DEFAULT_WORKSPACE_CATEGORIES).size).toBe(DEFAULT_WORKSPACE_CATEGORIES.length);
    for (const category of DEFAULT_WORKSPACE_CATEGORIES) {
      expect(SCENARIO_CATEGORIES).toContain(category);
    }
  });

  it("splits the document-writing and software-coding scenarios into named sub-groups", () => {
    const docs = SCENARIOS.filter((scenario) => scenario.category === "docs");
    expect(docs.length).toBeGreaterThan(0);
    for (const scenario of docs) {
      expect(scenario.subgroup, `${scenario.id} has no sub-group`).toBeDefined();
    }
    expect([...new Set(docs.map((scenario) => scenario.subgroup))].sort()).toEqual([
      "change",
      "design",
      "requirements",
    ]);

    const code = SCENARIOS.filter((scenario) => scenario.category === "code");
    expect(code.length).toBeGreaterThan(0);
    for (const scenario of code) {
      expect(scenario.subgroup, `${scenario.id} has no sub-group`).toBeDefined();
    }
    expect([...new Set(code.map((scenario) => scenario.subgroup))].sort()).toEqual([
      "code-generation",
      "code-maintenance",
      "unit-test",
    ]);

    for (const subgroup of SCENARIO_SUBGROUPS) {
      expect(SCENARIO_SUBGROUP_LABELS[subgroup].message).toBeTruthy();
    }
    // Only docs and code sub-divide; the remaining categories render flat.
    expect(
      SCENARIOS.filter(
        (scenario) =>
          scenario.category !== "docs" &&
          scenario.category !== "code" &&
          scenario.subgroup !== undefined,
      ),
    ).toHaveLength(0);
  });

  it("groups a scenario list by sub-group in first-seen order", () => {
    const groups = groupScenariosForDisplay(SCENARIOS);
    expect(groups.map((group) => group.key)).toEqual([
      "requirements",
      "design",
      "change",
      "code-generation",
      "code-maintenance",
      "unit-test",
      "flat",
    ]);
    expect(groups.flatMap((group) => group.scenarios)).toHaveLength(SCENARIOS.length);
    expect(groups.find((group) => group.key === "flat")!.label).toBeNull();
  });

  it("dropped the merged diagram and reverse-derivation scenarios", () => {
    expect(scenarioById("generate-diagram")).toBeUndefined();
    expect(scenarioById("derive-from-design")).toBeUndefined();
    expect(scenarioById("derive-from-code")).toBeUndefined();
    expect(scenarioById("derive-requirements-from-design")).toBeUndefined();
    expect(scenarioById("derive-design-from-code")).toBeUndefined();
  });

  it("dropped the trimmed software-coding scenarios", () => {
    for (const id of [
      "generate-function",
      "analyze-impact",
      "trace-code",
      "export-changeset",
      "import-interface",
    ]) {
      expect(scenarioById(id), `${id} should be gone`).toBeUndefined();
    }
  });

  it("opens an empty composer for the scenarios authored without a prompt", () => {
    const manual = SCENARIOS.filter((scenario) => !scenario.prompt)
      .map((scenario) => scenario.id)
      .sort();
    expect(manual).toEqual(["modify-project-code"]);
  });

  it("scaffolds from a reference directory or into src-new/, and takes a reference source directory", () => {
    const scaffold = scenarioById("scaffold-project")!;
    // Still gates on its basis document.
    expect(scaffold.requiredInputs?.some((input) => input.required)).toBe(true);
    // The output location is mode-specific, so the scenario pins none globally.
    expect(scaffold.fileOutputDir).toBeUndefined();
    // The reference implementation is a project directory, not file uploads.
    const reference = scaffold.requiredInputs?.find((input) => input.id === "reference-software");
    expect(reference?.kind).toBe("code");
    // Two output modes: edit the reference in place, or start from scratch.
    expect(scaffold.outputModes?.map((mode) => mode.id)).toEqual(["reuse", "scratch"]);
    for (const mode of scaffold.outputModes ?? []) {
      expect(mode.label.message).toBeTruthy();
      expect(mode.agentInstruction.message).toBeTruthy();
    }
    const reuse = scaffold.outputModes!.find((mode) => mode.id === "reuse")!;
    const scratch = scaffold.outputModes!.find((mode) => mode.id === "scratch")!;
    // Reuse edits the reference in place; scratch creates src-new/.
    expect(reuse.agentInstruction.message).toContain("in place");
    expect(scratch.agentInstruction.message).toContain("Create an empty src-new/");
  });
});
