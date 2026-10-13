import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  REQUIREMENT_QUALITY_ISSUE_TYPES,
  REQUIREMENT_QUALITY_SCOPES,
  REQUIREMENT_QUALITY_SEVERITIES,
} from "./requirementQuality";

/**
 * Pins the bundled review skill to the shared check catalog. The skill and the
 * app must agree on the fixed issue types; without this the two silently drift
 * and the panel's filters stop matching what the agent emits.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const skillDir = join(repoRoot, "resources", "skills", "requirement-quality-review");

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(skillDir, relativePath), "utf8")) as T;
}

interface CheckCatalog {
  scopes: string[];
  severities: string[];
  issueTypes: { id: string; scope: string; label: string }[];
}

describe("requirement-quality-review skill catalog", () => {
  it("declares the folder name in its frontmatter", () => {
    const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\r?\nname: requirement-quality-review\r?\n/u);
  });

  it("lists exactly the shared issue types, in order", () => {
    const catalog = readJson<CheckCatalog>("references/check-catalog.json");
    expect(catalog.issueTypes.map((entry) => entry.id)).toEqual([...REQUIREMENT_QUALITY_ISSUE_TYPES]);
  });

  it("uses unique ids and the shared scopes/severities", () => {
    const catalog = readJson<CheckCatalog>("references/check-catalog.json");
    const ids = catalog.issueTypes.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(catalog.scopes).toEqual([...REQUIREMENT_QUALITY_SCOPES]);
    expect(catalog.severities).toEqual([...REQUIREMENT_QUALITY_SEVERITIES]);
    for (const entry of catalog.issueTypes) {
      expect(catalog.scopes, `${entry.id} scope`).toContain(entry.scope);
      expect(entry.label.length, `${entry.id} label`).toBeGreaterThan(0);
    }
  });

  it("keeps the JSON schema enums in sync with the shared lists", () => {
    const schema = readJson<{
      properties: {
        issues: { items: { properties: { type: { enum: string[] }; scope: { enum: string[] }; severity: { enum: string[] } } } };
      };
    }>("references/issue-schema.json");
    const props = schema.properties.issues.items.properties;
    expect(props.type.enum).toEqual([...REQUIREMENT_QUALITY_ISSUE_TYPES]);
    expect(props.scope.enum).toEqual([...REQUIREMENT_QUALITY_SCOPES]);
    expect(props.severity.enum).toEqual([...REQUIREMENT_QUALITY_SEVERITIES]);
  });
});
