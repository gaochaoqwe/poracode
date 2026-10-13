import { homedir } from "node:os";
import { join } from "node:path";
import { type AgentEmployeeChannel, resolveAgentEmployeeChannel, userDataDirNameFor } from "./channel";

export interface AgentEmployeePaths {
  baseDir: string;
  dbPath: string;
  settingsPath: string;
  keybindingsPath: string;
  worktreesDir: string;
  attachmentsDir: string;
  /**
   * Global document templates library. Holds the middle level of the
   * `project → global → built-in` override used by design/requirements document
   * scenarios; projects override with `<project>/.agentemployee/templates/<id>.md`.
   */
  templatesDir: string;
  logsDir: string;
  terminalLogsDir: string;
  cacheDir: string;
  statusCachePath: string;
  /**
   * App-managed per-project knowledge bases. Each project gets one namespace
   * directory (`<projectId>-<hash>`) holding `raw/sources/`, `wiki/`, and the
   * `purpose.md`/`schema.md`/`index.md`/`log.md` files. Kept out of the project
   * tree so it is never committed or shown in the project file browser.
   */
  knowledgeDir: string;
  agentPluginsDir: string;
  /**
   * Writable root for Agent Plugins packages the user installs. Each immediate
   * child directory containing a `plugin.json` is loaded as one package.
   *
   * @see https://agent-plugins.org/client-implementers/loading-and-discovery
   */
  pluginsDir: string;
  /** Parent of the per-plugin `PLUGIN_DATA` directories handed to MCP servers. */
  pluginDataDir: string;
  /**
   * Cache directory for ACP registry agent icons. Icons are downloaded once
   * at install/backfill time, served from disk via the `agentemployee-local://`
   * protocol so the renderer paints them synchronously on app start instead
   * of fetching the CDN URL on every mount.
   */
  acpIconsDir: string;
}

export function resolveAgentEmployeeBaseDir(
  channel: AgentEmployeeChannel = resolveAgentEmployeeChannel(),
  homeDir: string = homedir(),
): string {
  return join(homeDir, userDataDirNameFor(channel));
}

export function resolveAgentEmployeePaths(baseDir: string = resolveAgentEmployeeBaseDir()): AgentEmployeePaths {
  const logsDir = join(baseDir, "logs");
  const cacheDir = join(baseDir, "cache");
  return {
    baseDir,
    dbPath: join(baseDir, "state.sqlite"),
    settingsPath: join(baseDir, "settings.json"),
    keybindingsPath: join(baseDir, "keybindings.json"),
    worktreesDir: join(baseDir, "worktrees"),
    attachmentsDir: join(baseDir, "attachments"),
    templatesDir: join(baseDir, "templates"),
    logsDir,
    terminalLogsDir: join(logsDir, "terminal"),
    cacheDir,
    statusCachePath: join(cacheDir, "agent-status-cache.json"),
    knowledgeDir: join(baseDir, "knowledge"),
    agentPluginsDir: join(baseDir, "agent-plugins"),
    pluginsDir: join(baseDir, "plugins"),
    pluginDataDir: join(baseDir, "plugin-data"),
    acpIconsDir: join(cacheDir, "acp-icons"),
  };
}
