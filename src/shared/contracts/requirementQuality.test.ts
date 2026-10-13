import { describe, expect, it } from "vitest";
import {
  REQUIREMENT_QUALITY_REPORT_KIND,
  REQUIREMENT_QUALITY_REPORT_VERSION,
  issueFingerprint,
  parseRequirementQualityReport,
  requirementQualityReportSchema,
  type RequirementQualityIssue,
} from "./requirementQuality";

function issue(overrides: Partial<RequirementQualityIssue> = {}): RequirementQualityIssue {
  return {
    id: "Q-1",
    source: { file: "docs/srs.md", section: "3.7.3", itemId: "REQ-AGENT-QA-001" },
    type: "ambiguity",
    scope: "item",
    severity: "high",
    relatedItemIds: [],
    summary: "“较快” is subjective.",
    suggestion: "Replace with a measurable threshold.",
    ...overrides,
  };
}

function reportJson(issues: RequirementQualityIssue[]): string {
  return JSON.stringify({
    kind: REQUIREMENT_QUALITY_REPORT_KIND,
    version: REQUIREMENT_QUALITY_REPORT_VERSION,
    issues,
  });
}

function fence(body: string): string {
  return "```json\n" + body + "\n```";
}

describe("parseRequirementQualityReport", () => {
  it("extracts a report from surrounding prose", () => {
    const text = `Here is the review.\n\n${fence(reportJson([issue()]))}\n\nDone.`;
    const report = parseRequirementQualityReport(text);
    expect(report?.issues).toHaveLength(1);
    expect(report?.issues[0]?.type).toBe("ambiguity");
  });

  it("defaults relatedItemIds when the agent omits it", () => {
    const body = JSON.stringify({
      kind: REQUIREMENT_QUALITY_REPORT_KIND,
      version: REQUIREMENT_QUALITY_REPORT_VERSION,
      issues: [
        {
          id: "Q-1",
          source: { file: "a.md" },
          type: "conflict",
          scope: "cross",
          severity: "medium",
          summary: "s",
          suggestion: "g",
        },
      ],
    });
    const report = parseRequirementQualityReport(fence(body));
    expect(report?.issues[0]?.relatedItemIds).toEqual([]);
  });

  it("ignores non-report json fences and keeps the last valid report", () => {
    const first = fence(reportJson([issue({ id: "Q-1" })]));
    const noise = fence(JSON.stringify({ hello: "world" }));
    const second = fence(reportJson([issue({ id: "Q-2" }), issue({ id: "Q-3" })]));
    const report = parseRequirementQualityReport([first, noise, second].join("\n"));
    expect(report?.issues.map((i) => i.id)).toEqual(["Q-2", "Q-3"]);
  });

  it("returns null for an unclosed (streaming) fence", () => {
    const text = "Reviewing…\n```json\n" + reportJson([issue()]);
    expect(parseRequirementQualityReport(text)).toBeNull();
  });

  it("returns null when the payload fails schema validation", () => {
    const bad = fence(
      JSON.stringify({
        kind: REQUIREMENT_QUALITY_REPORT_KIND,
        version: REQUIREMENT_QUALITY_REPORT_VERSION,
        issues: [{ ...issue(), type: "not-a-real-type" }],
      }),
    );
    expect(parseRequirementQualityReport(bad)).toBeNull();
  });

  it("returns null when the version is unknown", () => {
    const bad = fence(
      JSON.stringify({
        kind: REQUIREMENT_QUALITY_REPORT_KIND,
        version: 999,
        issues: [],
      }),
    );
    expect(parseRequirementQualityReport(bad)).toBeNull();
  });

  it("returns null for plain text with no fence", () => {
    expect(parseRequirementQualityReport("no report here")).toBeNull();
  });
});

describe("report schema", () => {
  it("rejects an empty-file source", () => {
    const parsed = requirementQualityReportSchema.safeParse({
      kind: REQUIREMENT_QUALITY_REPORT_KIND,
      version: REQUIREMENT_QUALITY_REPORT_VERSION,
      issues: [{ ...issue(), source: { file: "" } }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("issueFingerprint", () => {
  it("is stable across paraphrase, id, severity, and related-item changes", () => {
    const base = issue();
    const revised = issue({
      id: "Q-9",
      severity: "low",
      relatedItemIds: ["REQ-OTHER"],
      summary: "totally reworded",
      suggestion: "totally reworded",
    });
    expect(issueFingerprint(revised)).toBe(issueFingerprint(base));
  });

  it("changes when the locator changes", () => {
    const base = issue();
    const moved = issue({ source: { file: "docs/srs.md", itemId: "REQ-AGENT-QA-002" } });
    expect(issueFingerprint(moved)).not.toBe(issueFingerprint(base));
  });

  it("changes when the type changes", () => {
    expect(issueFingerprint(issue({ type: "conflict" }))).not.toBe(issueFingerprint(issue()));
  });

  it("normalizes case and whitespace in the locator", () => {
    const a = issue({ source: { file: "Docs/SRS.md", section: "3.7.3", anchor: "Foo  Bar" } });
    const b = issue({ source: { file: "docs/srs.md", section: " 3.7.3 ", anchor: "foo bar" } });
    expect(issueFingerprint(a)).toBe(issueFingerprint(b));
  });

  it("prefers itemId over file/section when present", () => {
    const withItem = issue({ source: { file: "a.md", section: "s", itemId: "REQ-1" } });
    const otherFile = issue({ source: { file: "b.md", section: "t", itemId: "REQ-1" } });
    expect(issueFingerprint(withItem)).toBe(issueFingerprint(otherFile));
  });
});
