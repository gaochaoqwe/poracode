import { z } from "zod";
import type { BuiltInMcpServerId } from "./mcpServer";

/**
 * Task domains a scenario (and a workspace) can belong to. Deliberately
 * provider-agnostic: it names what the user is *doing* (writing docs, coding,
 * testing), never which agent runs it.
 */
export const SCENARIO_CATEGORIES = ["general", "docs", "code", "test"] as const;
export const scenarioCategorySchema = z.enum(SCENARIO_CATEGORIES);
export type ScenarioCategory = z.infer<typeof scenarioCategorySchema>;

/**
 * Provider-agnostic shape of a scenario. Carries no user-facing strings — the
 * localized title/description/prompt live in the renderer catalog
 * (`src/renderer/scenarios/catalog.ts`) so Lingui can extract them. This split
 * lets the workspace's `defaultScenarioIds` be validated in shared code without
 * pulling translations into the shared layer.
 */
export interface ScenarioDefinition {
  /** Stable id; workspace `defaultScenarioIds` reference it. */
  id: string;
  category: ScenarioCategory;
  /** Skill ids this scenario relies on — display only ("uses these"). */
  relatedSkillIds?: readonly string[];
  /** Plugin ids this scenario relies on — display only. */
  relatedPluginIds?: readonly string[];
  /** Built-in MCP servers to switch on for this scenario (e.g. doc parsing). */
  enableMcpServerIds?: readonly BuiltInMcpServerId[];
}
