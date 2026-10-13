import appControls from "../../../resources/plugins/app-controls/plugin.json";
import browserTools from "../../../resources/plugins/browser-tools/plugin.json";
import chromeTools from "../../../resources/plugins/chrome-tools/plugin.json";
import codeReview from "../../../resources/plugins/code-review/plugin.json";
import computerUse from "../../../resources/plugins/computer-use/plugin.json";
import gjb438cIda from "../../../resources/plugins/gjb438c-ida/plugin.json";
import gjb438cSdd from "../../../resources/plugins/gjb438c-sdd/plugin.json";
import gjb438cSrs from "../../../resources/plugins/gjb438c-srs/plugin.json";
import github from "../../../resources/plugins/github/plugin.json";
import knowledge from "../../../resources/plugins/knowledge/plugin.json";
import officecli from "../../../resources/plugins/officecli/plugin.json";
import outlook from "../../../resources/plugins/outlook/plugin.json";
import subagentDelegation from "../../../resources/plugins/subagent-delegation/plugin.json";
import terminal from "../../../resources/plugins/terminal/plugin.json";
import { type BuiltInMcpServerId } from "../contracts/mcpServer";
import { parsePluginManifest, parseAgentEmployeeExtension } from "./spec";

/**
 * Bundled `resources/plugins` packages. A new folder there must be imported
 * here — the companion test compares this list to the disk.
 */
export const BUNDLED_PLUGIN_MANIFESTS = [
  appControls,
  browserTools,
  chromeTools,
  codeReview,
  computerUse,
  gjb438cIda,
  gjb438cSdd,
  gjb438cSrs,
  github,
  knowledge,
  officecli,
  outlook,
  subagentDelegation,
  terminal,
] as const;

export interface BundledPluginCoreSkill {
  pluginName: string;
  coreSkill: string;
  builtInMcpServerIds: readonly BuiltInMcpServerId[];
}

function readBundledCoreSkill(raw: unknown): BundledPluginCoreSkill {
  const parsed = parsePluginManifest(raw);
  if (!parsed.manifest) {
    throw new Error("bundled plugin.json is not a valid agent plugin manifest");
  }
  const { extension } = parseAgentEmployeeExtension(parsed.manifest);
  if (!extension.coreSkill) {
    throw new Error(`${parsed.manifest.name} plugin.json is missing com.agentemployee.client.coreSkill`);
  }
  return {
    pluginName: parsed.manifest.name,
    coreSkill: extension.coreSkill,
    builtInMcpServerIds: extension.builtInMcpServerIds,
  };
}

/** Every shipped package and the core skill its mention / MCP must load. */
export const BUNDLED_PLUGIN_CORE_SKILLS: readonly BundledPluginCoreSkill[] =
  BUNDLED_PLUGIN_MANIFESTS.map(readBundledCoreSkill).sort((left, right) =>
    left.pluginName.localeCompare(right.pluginName),
  );

/** Core skills of every bundled plugin that binds this AgentEmployee-owned MCP. */
export function coreSkillsForBuiltInMcp(id: BuiltInMcpServerId): readonly string[] {
  return BUNDLED_PLUGIN_CORE_SKILLS.filter((plugin) => plugin.builtInMcpServerIds.includes(id)).map(
    (plugin) => plugin.coreSkill,
  );
}

/**
 * The one core skill for an MCP bound to a single plugin.
 * `app-controls` is shared by AgentEmployee and Terminal — use
 * {@link coreSkillsForBuiltInMcp} there.
 */
export function uniqueCoreSkillForBuiltInMcp(id: BuiltInMcpServerId): string {
  const skills = coreSkillsForBuiltInMcp(id);
  if (skills.length !== 1) {
    throw new Error(
      `built-in MCP '${id}' must bind exactly one plugin core skill, got ${
        skills.join(", ") || "none"
      }`,
    );
  }
  return skills[0]!;
}

/** Phrase initialize instructions use so a rename in plugin.json stays in sync. */
export function loadPluginCoreSkillPhrase(skill: string): string {
  return `load the ${skill} skill by name`;
}
