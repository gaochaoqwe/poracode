import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import type { BuiltInMcpServerId, Project, ThreadPresentationMode } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { PluginIcon } from "@/renderer/components/plugins/PluginIcon";
import {
  usePluginMentionItems,
  useSkillSlashCommandState,
} from "@/renderer/components/skills/useSkills";
import type { ScenarioView } from "@/renderer/scenarios/catalog";

interface RailEntry {
  key: string;
  label: string;
  /** Declared by one of the category's own scenarios: shown before the rest. */
  related: boolean;
  icon: ReactNode;
  inject: () => void;
}

/**
 * The skills and plugins that suit the selected task category, as a horizontal
 * rail under the scenario cards. Picking one seeds the composer with that
 * skill's `/name` token, which the composer turns into a bound skill chip — the
 * same path scenarios use for their leading skill, appended at the caret so
 * anything already typed survives.
 *
 * Ordering is "what this category is about, then everything else": entries the
 * category's own scenarios declare come first, and the remaining available ones
 * fill the rail.
 */
export function WelcomeSkillRail(props: {
  project: Project;
  scenarios: readonly ScenarioView[];
  agentKind: string;
  presentationMode: ThreadPresentationMode;
}) {
  const { project, scenarios, agentKind, presentationMode } = props;
  const { commands } = useSkillSlashCommandState(project.location, agentKind, presentationMode);
  const plugins = usePluginMentionItems(project.location, agentKind, presentationMode);

  const relatedSkillIds = new Set<string>();
  const relatedPluginIds = new Set<string>();
  for (const scenario of scenarios) {
    if (scenario.leadingSkillId) relatedSkillIds.add(scenario.leadingSkillId);
    for (const id of scenario.relatedSkillIds ?? []) relatedSkillIds.add(id);
    for (const id of scenario.relatedPluginIds ?? []) relatedPluginIds.add(id);
  }

  const pluginEntries: RailEntry[] = plugins.map((plugin) => ({
    key: `plugin:${plugin.id}`,
    label: plugin.name,
    related: relatedPluginIds.has(plugin.id),
    icon: <PluginIcon pluginId={plugin.id} className="size-3.5" />,
    inject: () =>
      useAppStore.getState().setComposerSeed(project.id, `/${plugin.command.id}`, {
        bindLeadingSkill: true,
        leadingSkillPluginId: plugin.id,
        ...(plugin.enablesMcpServerIds?.length
          ? // The manifest schema constrains these to the built-in server ids
            // (`extensions.ts`), but the mention item carries them as plain
            // strings; the composer seed is the stricter consumer.
            { enableMcpServerIds: plugin.enablesMcpServerIds as readonly BuiltInMcpServerId[] }
          : {}),
      }),
  }));

  // A plugin's core skill reaches the composer through the plugin entry, so it
  // never appears twice in the rail.
  const pluginSkillIds = new Set(plugins.map((plugin) => plugin.command.id));
  const skillEntries: RailEntry[] = commands
    .filter((command) => !command.pluginId && !pluginSkillIds.has(command.id))
    .map((command) => ({
      key: `skill:${command.id}`,
      // `label` is built as "<name> — <description>"; the rail shows the name.
      label: command.description
        ? command.label.replace(` — ${command.description}`, "")
        : command.label,
      related: relatedSkillIds.has(command.id),
      icon: <Sparkles aria-hidden className="size-3.5" />,
      inject: () =>
        useAppStore.getState().setComposerSeed(project.id, `/${command.id}`, {
          bindLeadingSkill: true,
        }),
    }));

  const all = [...pluginEntries, ...skillEntries];
  const entries = [
    ...all.filter((entry) => entry.related),
    ...all.filter((entry) => !entry.related),
  ];

  if (entries.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-[11px] font-medium text-muted">
        {/* Same wording as the sidebar entry, so both read as one place. */}
        <Trans>Skills · Plugins</Trans>
      </span>
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {entries.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={entry.inject}
            title={entry.label}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/40 px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-border hover:bg-[var(--row-hover)] hover:text-foreground"
          >
            {entry.icon}
            <span className="max-w-[10rem] truncate">{entry.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
