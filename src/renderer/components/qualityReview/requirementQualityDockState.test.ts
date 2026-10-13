import { describe, expect, it } from "vitest";
import {
  REQUIREMENT_QUALITY_ISSUE_TYPES,
  REQUIREMENT_QUALITY_SEVERITIES,
  REQUIREMENT_QUALITY_STATUSES,
  issueFingerprint,
  type RequirementQualityIssue,
} from "@/shared/contracts";
import { ISSUE_TYPE_LABELS, SEVERITY_LABELS, STATUS_LABELS } from "./issueCatalog";
import {
  filterRequirementQualityIssues,
  requirementQualitySections,
  sortRequirementQualityIssues,
  statusOfIssue,
  type RequirementQualityFilters,
} from "./requirementQualityDockState";

function issue(overrides: Partial<RequirementQualityIssue> = {}): RequirementQualityIssue {
  return {
    id: "Q-1",
    source: { file: "docs/srs.md", section: "3.7", itemId: "REQ-1" },
    type: "ambiguity",
    scope: "item",
    severity: "high",
    relatedItemIds: [],
    summary: "summary",
    suggestion: "suggestion",
    ...overrides,
  };
}

const ALL: RequirementQualityFilters = { severity: "all", type: "all", status: "all", section: "all" };

describe("issue catalog labels", () => {
  it("labels every shared issue type, severity, and status", () => {
    for (const type of REQUIREMENT_QUALITY_ISSUE_TYPES) {
      expect(ISSUE_TYPE_LABELS[type]).toBeDefined();
    }
    for (const severity of REQUIREMENT_QUALITY_SEVERITIES) {
      expect(SEVERITY_LABELS[severity]).toBeDefined();
    }
    for (const status of REQUIREMENT_QUALITY_STATUSES) {
      expect(STATUS_LABELS[status]).toBeDefined();
    }
  });
});

describe("sortRequirementQualityIssues", () => {
  it("orders high → medium → low", () => {
    const sorted = sortRequirementQualityIssues([
      issue({ id: "low", severity: "low" }),
      issue({ id: "high", severity: "high" }),
      issue({ id: "medium", severity: "medium" }),
    ]);
    expect(sorted.map((i) => i.severity)).toEqual(["high", "medium", "low"]);
  });
});

describe("filterRequirementQualityIssues", () => {
  it("filters by severity, type, and section", () => {
    const issues = [
      issue({ id: "a", severity: "high", type: "conflict", source: { file: "f", section: "1" } }),
      issue({ id: "b", severity: "low", type: "ambiguity", source: { file: "f", section: "2" } }),
    ];
    expect(filterRequirementQualityIssues(issues, { ...ALL, severity: "high" }, undefined)).toHaveLength(1);
    expect(filterRequirementQualityIssues(issues, { ...ALL, type: "ambiguity" }, undefined)).toHaveLength(1);
    expect(filterRequirementQualityIssues(issues, { ...ALL, section: "2" }, undefined)).toHaveLength(1);
  });

  it("filters by decision status, defaulting to open", () => {
    const decided = issue({ id: "a" });
    const other = issue({ id: "b", source: { file: "f", itemId: "REQ-2" } });
    const decisions = { [issueFingerprint(decided)]: { status: "rejected" as const, updatedAt: "t" } };

    expect(filterRequirementQualityIssues([decided, other], { ...ALL, status: "rejected" }, decisions)).toEqual([
      decided,
    ]);
    expect(filterRequirementQualityIssues([decided, other], { ...ALL, status: "open" }, decisions)).toEqual([
      other,
    ]);
  });
});

describe("requirementQualitySections", () => {
  it("returns distinct non-empty sections in first-seen order", () => {
    expect(
      requirementQualitySections([
        issue({ source: { file: "f", section: "2" } }),
        issue({ source: { file: "f", section: "1" } }),
        issue({ source: { file: "f", section: "2" } }),
        issue({ source: { file: "f" } }),
      ]),
    ).toEqual(["2", "1"]);
  });
});

describe("statusOfIssue", () => {
  it("defaults to open without a decision", () => {
    expect(statusOfIssue(undefined, issue())).toBe("open");
    expect(statusOfIssue({}, issue())).toBe("open");
  });
});
