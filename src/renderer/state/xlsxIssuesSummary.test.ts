import { describe, expect, it } from "vitest";
import { parseXlsxIssuesSummary } from "./xlsxIssuesSummary";

describe("parseXlsxIssuesSummary", () => {
  it("parses a well-formed summary", () => {
    const summary = parseXlsxIssuesSummary(
      JSON.stringify({
        schemaVersion: 1,
        sheet: "问题单",
        total: 5,
        done: 2,
        byStatus: { done: 2, pending: 3 },
        byRule: [
          { rule: "no-unused-vars", total: 3, done: 2, pending: 1 },
          { rule: "eqeqeq", total: 2, done: 0, pending: 2 },
        ],
      }),
    );
    expect(summary).not.toBeNull();
    expect(summary?.total).toBe(5);
    expect(summary?.done).toBe(2);
    expect(summary?.sheet).toBe("问题单");
    expect(summary?.byRule).toHaveLength(2);
    expect(summary?.byStatus).toEqual({ done: 2, pending: 3 });
  });

  it("returns null for empty, non-JSON, or non-object input", () => {
    expect(parseXlsxIssuesSummary(null)).toBeNull();
    expect(parseXlsxIssuesSummary(undefined)).toBeNull();
    expect(parseXlsxIssuesSummary("")).toBeNull();
    expect(parseXlsxIssuesSummary("not json")).toBeNull();
    expect(parseXlsxIssuesSummary("42")).toBeNull();
    expect(parseXlsxIssuesSummary('"a string"')).toBeNull();
  });

  it("returns null when there is nothing to show", () => {
    expect(parseXlsxIssuesSummary(JSON.stringify({ total: 0, byRule: [] }))).toBeNull();
  });

  it("is tolerant of missing and extra fields", () => {
    const summary = parseXlsxIssuesSummary(
      JSON.stringify({
        byRule: [{ rule: "eqeqeq", total: 4, done: 1 }],
        unknownFutureField: true,
      }),
    );
    expect(summary).not.toBeNull();
    // `total` derives from byRule when the top-level field is absent.
    expect(summary?.total).toBe(4);
    expect(summary?.done).toBe(0);
    expect(summary?.schemaVersion).toBe(1);
    expect(summary?.sheet).toBeNull();
    expect(summary?.byRule[0]).toEqual({ rule: "eqeqeq", total: 4, done: 1, pending: 0 });
  });

  it("falls back to a placeholder rule name and drops malformed rows", () => {
    const summary = parseXlsxIssuesSummary(
      JSON.stringify({
        total: 3,
        byRule: [{ total: 3 }, null, "x", { rule: "", total: -1 }],
      }),
    );
    expect(summary?.byRule).toEqual([{ rule: "(unknown)", total: 3, done: 0, pending: 0 }]);
  });

  it("parses attention items and defaults to empty when absent", () => {
    const absent = parseXlsxIssuesSummary(JSON.stringify({ total: 1 }));
    expect(absent?.attention).toEqual([]);
    expect(absent?.attentionTotal).toBe(0);

    const summary = parseXlsxIssuesSummary(
      JSON.stringify({
        total: 5,
        attentionTotal: 2,
        attention: [
          {
            row: 7,
            rule: "eqeqeq",
            file: "src/a.ts",
            status: "needs-review",
            note: "no file given",
          },
          { row: 9, rule: "no-unused-vars", status: "failed" },
        ],
      }),
    );
    expect(summary?.attention).toEqual([
      { row: 7, rule: "eqeqeq", file: "src/a.ts", status: "needs-review", note: "no file given" },
      { row: 9, rule: "no-unused-vars", file: null, status: "failed", note: null },
    ]);
    expect(summary?.attentionTotal).toBe(2);
  });

  it("drops malformed attention rows and keeps the total", () => {
    const summary = parseXlsxIssuesSummary(
      JSON.stringify({
        total: 3,
        attentionTotal: 99,
        attention: [
          { row: 2, status: "done" }, // not an attention status
          { status: "skipped" }, // no row
          "x",
          { row: 4, rule: "", status: "skipped" },
        ],
      }),
    );
    expect(summary?.attention).toEqual([
      { row: 4, rule: "(unknown)", file: null, status: "skipped", note: null },
    ]);
    expect(summary?.attentionTotal).toBe(99);
  });
});
