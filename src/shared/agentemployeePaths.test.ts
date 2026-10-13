import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgentEmployeeBaseDir, resolveAgentEmployeePaths } from "./agentemployeePaths";

describe("agentemployeePaths", () => {
  it("derives the default base dir under the user home", () => {
    expect(resolveAgentEmployeeBaseDir("stable")).toBe(join(homedir(), ".agentemployee"));
  });

  it("returns the nightly base dir when the channel is nightly", () => {
    expect(resolveAgentEmployeeBaseDir("nightly")).toBe(join(homedir(), ".agentemployee-nightly"));
  });

  it("derives all persisted paths from the provided base dir", () => {
    const baseDir = join("tmp", "agentemployee");
    expect(resolveAgentEmployeePaths(baseDir)).toEqual({
      baseDir,
      dbPath: join(baseDir, "state.sqlite"),
      settingsPath: join(baseDir, "settings.json"),
      keybindingsPath: join(baseDir, "keybindings.json"),
      knowledgeDir: join(baseDir, "knowledge"),
      worktreesDir: join(baseDir, "worktrees"),
      attachmentsDir: join(baseDir, "attachments"),
      templatesDir: join(baseDir, "templates"),
      logsDir: join(baseDir, "logs"),
      terminalLogsDir: join(baseDir, "logs", "terminal"),
      cacheDir: join(baseDir, "cache"),
      statusCachePath: join(baseDir, "cache", "agent-status-cache.json"),
      agentPluginsDir: join(baseDir, "agent-plugins"),
      pluginsDir: join(baseDir, "plugins"),
      pluginDataDir: join(baseDir, "plugin-data"),
      acpIconsDir: join(baseDir, "cache", "acp-icons"),
    });
  });
});
