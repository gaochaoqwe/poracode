import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rotateLogFile } from "./logFile";

describe("rotateLogFile", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tempLog(): string {
    const dir = mkdtempSync(join(tmpdir(), "agentemployee-log-"));
    dirs.push(dir);
    return join(dir, "agentemployee.log");
  }

  it("leaves a file under the limit untouched", () => {
    const path = tempLog();
    writeFileSync(path, "small", "utf8");
    rotateLogFile(path, 1024, 3);
    expect(existsSync(`${path}.1`)).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("small");
  });

  it("is a no-op when the file does not exist", () => {
    const path = tempLog();
    expect(() => rotateLogFile(path, 1024, 3)).not.toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it("shifts the current file to .1 and ages the older rotations", () => {
    const path = tempLog();
    writeFileSync(path, "x".repeat(2048), "utf8");
    writeFileSync(`${path}.1`, "older", "utf8");

    rotateLogFile(path, 1024, 3);

    expect(existsSync(path)).toBe(false);
    expect(readFileSync(`${path}.1`, "utf8")).toHaveLength(2048);
    expect(readFileSync(`${path}.2`, "utf8")).toBe("older");
  });
});
