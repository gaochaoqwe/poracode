import { GitPullRequest, SquareKanban, Workflow } from "lucide-react";
import { startTransition, type ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { useCurrentProjectId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import type { SidebarShortcutId } from "@/shared/settings";

export interface SidebarShortcutEntry {
  id: "pullRequests" | "githubActions" | "tasks";
  icon: ReactNode;
  label: string;
  isActive: boolean;
  onPress: () => void;
}

/**
 * The configurable sidebar destinations (Settings → General can hide or
 * reorder them). Consumed by the top action cluster (SidebarPrimaryActions),
 * shared by the expanded sidebar and the collapsed icon rail so both surfaces
 * resolve order, visibility, and active state the same way.
 */
export function useSidebarShortcuts(): SidebarShortcutEntry[] {
  const { t } = useLingui();
  const currentProjectId = useCurrentProjectId();
  const sidebarHiddenShortcuts = useSharedSettings((s) => s.sidebarHiddenShortcuts);
  const sidebarShortcutOrder = useSharedSettings((s) => s.sidebarShortcutOrder);
  const appView = useAppStore((s) => s.view);
  const openPullRequests = useAppStore((s) => s.openPullRequests);
  const openGitHubActions = useAppStore((s) => s.openGitHubActions);
  const openWorkbench = useAppStore((s) => s.openWorkbench);
  const githubActionsOpen = usePanelStore((s) => s.githubActionsContext !== null);

  // Keyed by the persisted setting's id, which still lists the retired
  // "schedules" shortcut: dropping it from the enum would fail the settings
  // schema and reset a user's stored order/visibility. A missing entry simply
  // filters out, so the retired id disappears from both sidebars.
  const sidebarShortcutsById = new Map<SidebarShortcutId, Omit<SidebarShortcutEntry, "isActive">>([
    [
      "pullRequests",
      {
        id: "pullRequests",
        icon: <GitPullRequest className="size-4" />,
        label: t`Pull requests`,
        onPress: () => startTransition(() => openPullRequests()),
      },
    ],
    [
      "githubActions",
      {
        id: "githubActions",
        icon: <Workflow className="size-4" />,
        label: t`GitHub Actions`,
        onPress: () => startTransition(() => openGitHubActions(currentProjectId)),
      },
    ],
    [
      "tasks",
      {
        id: "tasks",
        icon: <SquareKanban className="size-4" />,
        label: t`Workbench`,
        onPress: () => startTransition(() => openWorkbench("tasks")),
      },
    ],
  ]);

  return sidebarShortcutOrder
    .map((id) => sidebarShortcutsById.get(id))
    .filter(
      (shortcut): shortcut is NonNullable<typeof shortcut> =>
        shortcut !== undefined && !sidebarHiddenShortcuts.includes(shortcut.id),
    )
    .map((shortcut) => ({
      ...shortcut,
      isActive:
        shortcut.id === "githubActions"
          ? githubActionsOpen
          : // The shortcut id is still "tasks" (it is persisted in settings), but
            // it now highlights for the whole Workbench module.
            shortcut.id === "tasks"
            ? appView.kind === "workbench"
            : appView.kind === shortcut.id,
    }));
}
