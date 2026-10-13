import { describe, expect, it } from "vitest";
import { highlightCodeForPath } from "./codeHighlight";

function linesToText(segments: ReturnType<typeof highlightCodeForPath>): string[] {
  return segments.map((segs) => segs.map((s) => s.text).join(""));
}

describe("codeHighlight", () => {
  it("tokenizes C keywords, comments, strings and numbers", () => {
    const code = "int x = 42;\n// comment\nreturn \"hi\";\n";
    const lines = highlightCodeForPath(code, "a.c");
    expect(linesToText(lines)).toEqual(["int x = 42;", "// comment", 'return "hi";', ""]);
    // keyword token on first line
    expect(lines[0]?.some((s) => s.cls === "keyword" && s.text === "int")).toBe(true);
    expect(lines[1]?.some((s) => s.cls === "comment")).toBe(true);
    expect(lines[2]?.some((s) => s.cls === "string")).toBe(true);
  });

  it("handles block comments spanning lines", () => {
    const code = "/* start\nstill comment\nend */ code\n";
    const lines = highlightCodeForPath(code, "a.c");
    expect(lines[0]?.every((s) => s.cls === "comment")).toBe(true);
    expect(lines[1]?.every((s) => s.cls === "comment")).toBe(true);
    expect(lines[2]?.map((s) => s.text).join("")).toBe("end */ code");
  });

  it("marks preprocessor directives", () => {
    const code = "#include <stdio.h>\nint main() {}\n";
    const lines = highlightCodeForPath(code, "a.c");
    expect(lines[0]?.every((s) => s.cls === "preprocessor")).toBe(true);
  });

  it("detects function calls for TS", () => {
    const code = "foo();\nconst bar = baz(x);\n";
    const lines = highlightCodeForPath(code, "a.ts");
    expect(lines[0]?.some((s) => s.cls === "function" && s.text === "foo")).toBe(true);
    expect(lines[1]?.some((s) => s.cls === "function" && s.text === "baz")).toBe(true);
  });

  it("handles Verilog sized literals", () => {
    const code = "wire [3:0] w;\nassign w = 4'b1010;\n";
    const lines = highlightCodeForPath(code, "a.v");
    expect(lines[1]?.some((s) => s.cls === "number")).toBe(true);
  });
});
