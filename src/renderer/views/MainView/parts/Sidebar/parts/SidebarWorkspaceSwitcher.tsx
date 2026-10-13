import { useState, type ReactNode } from "react";
import { Dropdown, Label, Tooltip } from "@heroui/react";
import { Check, ChevronRight, ChevronsUpDown } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Workspace } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import {
  ResponsiveMenuSurface,
  useResponsiveMenu,
} from "@/renderer/components/common/ResponsiveMenuSurface";
import { WorkspaceIcon } from "@/renderer/components/workspace/WorkspaceIcon";
import {
  parseWorkspaceMenuKey,
  workspaceMenuKey,
} from "@/renderer/components/workspace/workspaceMenuKeys";
import { sidebarRowClass } from "@/renderer/components/common/SidebarButton";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useActiveWorkspaceId, useWorkspaceStore } from "@/renderer/state/workspaceStore";
import {
  primaryContainerOf,
  primaryWorkspaces,
  secondaryEmployeeCount,
  teamWorkspaces,
  roleRankLabel,
  type SecondaryRankGroup,
} from "@/renderer/state/workspaceHierarchy";
import {
  aggregateRole,
  resolveRoleNavigation,
} from "@/renderer/views/MainView/parts/EmployeeDockBar";

interface MenuEntry {
  key: string;
  label: string;
  icon: ReactNode;
  /** Only workspace rows carry a selected state. */
  isSelected?: boolean;
}

/** Hover hint on the switcher row, matching the guidance in Settings → Workspaces. */
function WorkspaceSwitcherTooltip() {
  return <Trans>You can customize workspaces in Settings → Workspaces</Trans>;
}

/**
 * Navigate to a secondary employee: open its live thread, or set it active and
 * start a new Home draft — the same routing the employee dock uses.
 */
function openSecondaryEmployee(workspace: Workspace): void {
  const app = useAppStore.getState();
  const agg = aggregateRole(app.threads, app.projects, workspace.id, app.runtimeContextByThread);
  const nav = resolveRoleNavigation(agg);
  if (nav.type === "thread") {
    app.openThread(nav.threadId);
  } else {
    useWorkspaceStore.getState().setActiveWorkspaceId(workspace.id);
    app.openDraft(HOME_PROJECT_ID);
  }
}

/** Renders one rank-group block: rank header + employee rows. */
function RankGroupList(props: {
  ranks: SecondaryRankGroup[];
  depth: number;
  activeWorkspaceId: string | null;
  onSelect: (workspace: Workspace) => void;
}) {
  const { t } = useLingui();
  const indent = props.depth;
  return (
    <>
      {props.ranks.map(({ rank, employees }) => (
        <div key={rank}>
          <div
            className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted"
            style={{ paddingLeft: `${indent * 0.75 + 0.5}rem` }}
          >
            {t(roleRankLabel(rank))}
          </div>
          {employees.map((employee) => {
            const isActive = employee.id === props.activeWorkspaceId;
            return (
              <button
                key={employee.id}
                type="button"
                data-testid={`workspace-secondary:${employee.id}`}
                aria-current={isActive ? "true" : undefined}
                title={employee.persona ?? employee.name}
                onClick={() => props.onSelect(employee)}
                className={`flex w-full items-center gap-2 rounded py-1 pr-2 text-left text-[13px] outline-none transition-colors hover:bg-[var(--row-hover)] focus-visible:focus-ring ${
                  isActive ? "bg-[var(--accent)]/5 text-accent" : "hover:text-foreground"
                }`}
                style={{ paddingLeft: `${indent * 0.75 + 1.5}rem` }}
              >
                <span className="min-w-0 flex-1 truncate">{employee.name}</span>
                {employee.persona ? (
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted/70">
                    {employee.persona}
                  </span>
                ) : null}
                {isActive ? <Check className="size-3.5 shrink-0 text-accent" /> : null}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

/**
 * Hierarchical body shared by the desktop popover and mobile sheet. Three levels:
 * primary container → team (click toggles expand only) → employees grouped by
 * management rank. Employees with no team land in an "Ungrouped" bucket.
 *
 * A primary row is **two** targets: the chevron discloses its members, while the
 * rest of the row switches the active 岗位 to that container. Tying the switch to
 * the whole row was the bug — clicking a post only expanded it, so the picker
 * looked dead. The selected container is marked so the switch is visible.
 *
 * Expansion is *derived* rather than stored: `overrides` only records the
 * branches the user explicitly opened or closed, and anything else defaults to
 * "open when it holds the current selection". So the branch you are in is always
 * revealed without an effect syncing state after render, and switching posts
 * expands the new one for free.
 */
function WorkspaceHierarchyList(props: {
  expandedOverrides: ReadonlyMap<string, boolean>;
  activeWorkspaceId: string | null;
  activeContainerId: string | null;
  onToggle: (primaryId: string) => void;
  onSelectPrimary: (workspace: Workspace) => void;
  onSelectSecondary: (workspace: Workspace) => void;
}) {
  const { t } = useLingui();
  const workspaces = useSharedSettings((state) => state.workspaces);
  const teams = useSharedSettings((state) => state.teams);
  const primaries = primaryWorkspaces(workspaces);
  const [bucketOverrides, setBucketOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());

  // The bucket holding the active employee defaults open, so the current
  // position is on screen instead of hidden two levels down.
  const activeEmployee = workspaces.find(
    (workspace) => workspace.id === props.activeWorkspaceId && workspace.roleRank !== undefined,
  );
  const activeBucketKey = activeEmployee?.parentWorkspaceId
    ? activeEmployee.teamId
      ? `team:${activeEmployee.teamId}`
      : `ungrouped:${activeEmployee.parentWorkspaceId}`
    : null;

  const isBucketOpen = (key: string) => bucketOverrides.get(key) ?? key === activeBucketKey;

  function toggleBucket(key: string) {
    setBucketOverrides((prev) => new Map(prev).set(key, !isBucketOpen(key)));
  }

  return (
    <div className="flex flex-col gap-0.5">
      {primaries.map((primary) => {
        const isOpen =
          props.expandedOverrides.get(primary.id) ?? primary.id === props.activeContainerId;
        const isActive = primary.id === props.activeWorkspaceId;
        const count = secondaryEmployeeCount(workspaces, primary.id);
        const grouped = teamWorkspaces(workspaces, teams, primary.id);
        const hasContent = grouped.teams.length > 0 || grouped.ungrouped.length > 0;
        return (
          <div key={primary.id}>
            <div
              className={`flex w-full items-center gap-0.5 rounded pr-1 transition-colors ${
                isActive
                  ? "bg-[var(--accent)]/5 text-accent"
                  : "text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
              }`}
            >
              <button
                type="button"
                data-testid={`workspace-primary-toggle:${primary.id}`}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? t`Collapse` : t`Expand`} ${primary.name}`}
                onClick={() => props.onToggle(primary.id)}
                className="shrink-0 rounded p-1.5 outline-none hover:text-foreground focus-visible:focus-ring"
              >
                <ChevronRight
                  className={`size-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
              </button>
              <button
                type="button"
                data-testid={`workspace-primary:${primary.id}`}
                aria-current={isActive ? "true" : undefined}
                onClick={() => props.onSelectPrimary(primary)}
                title={primary.name}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm outline-none focus-visible:focus-ring"
              >
                <WorkspaceIcon icon={primary.icon} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{primary.name}</span>
                <span className={`shrink-0 text-xs ${isActive ? "" : "text-muted/60"}`}>
                  {count}
                </span>
                {isActive ? <Check className="size-3.5 shrink-0" /> : null}
              </button>
            </div>
            {isOpen ? (
              !hasContent ? (
                <p className="px-2 py-1 pl-9 text-xs text-muted">
                  <Trans>No teams or members</Trans>
                </p>
              ) : (
                <>
                  {grouped.teams.map(({ team, ranks }) => {
                    const bucketKey = `team:${team.id}`;
                    const bucketOpen = isBucketOpen(bucketKey);
                    const memberCount = ranks.reduce((sum, r) => sum + r.employees.length, 0);
                    return (
                      <div key={team.id}>
                        <button
                          type="button"
                          data-testid={`workspace-team:${team.id}`}
                          aria-expanded={bucketOpen}
                          onClick={() => toggleBucket(bucketKey)}
                          className="flex w-full items-center gap-1.5 rounded py-1 pl-6 pr-2 text-left text-xs text-muted outline-none transition-colors hover:bg-[var(--row-hover)] hover:text-foreground focus-visible:focus-ring"
                        >
                          <ChevronRight
                            className={`size-3 shrink-0 transition-transform ${bucketOpen ? "rotate-90" : ""}`}
                          />
                          <span className="min-w-0 flex-1 truncate">{team.name}</span>
                          <span className="shrink-0 text-[11px] text-muted/60">{memberCount}</span>
                        </button>
                        {bucketOpen ? (
                          <RankGroupList
                            ranks={ranks}
                            depth={2}
                            activeWorkspaceId={props.activeWorkspaceId}
                            onSelect={props.onSelectSecondary}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                  {grouped.ungrouped.length > 0 ? (
                    <div>
                      <button
                        type="button"
                        data-testid={`workspace-ungrouped:${primary.id}`}
                        aria-expanded={isBucketOpen(`ungrouped:${primary.id}`)}
                        onClick={() => toggleBucket(`ungrouped:${primary.id}`)}
                        className="flex w-full items-center gap-1.5 rounded py-1 pl-6 pr-2 text-left text-xs text-muted outline-none transition-colors hover:bg-[var(--row-hover)] hover:text-foreground focus-visible:focus-ring"
                      >
                        <ChevronRight
                          className={`size-3 shrink-0 transition-transform ${
                            isBucketOpen(`ungrouped:${primary.id}`) ? "rotate-90" : ""
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <Trans>Ungrouped</Trans>
                        </span>
                      </button>
                      {isBucketOpen(`ungrouped:${primary.id}`) ? (
                        <RankGroupList
                          ranks={grouped.ungrouped}
                          depth={2}
                          activeWorkspaceId={props.activeWorkspaceId}
                          onSelect={props.onSelectSecondary}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </>
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Switches which workspace the sidebar (and the tasks / pull-request views)
 * is scoped to. Lives at the top of the sidebar footer nav so it reads as
 * ambient context for the navigation below it rather than another destination.
 *
 * With the two-tier role model, the picker lists only the primary category
 * containers; expanding one reveals its secondary employees, which navigate to
 * that role's thread. Legacy flat workspaces (no rank on any entry) keep the
 * original flat picker.
 */
export function SidebarWorkspaceSwitcher() {
  const { t } = useLingui();
  const workspaces = useSharedSettings((state) => state.workspaces);
  const activeWorkspaceId = useActiveWorkspaceId();
  const { mobile } = useResponsiveMenu();
  const [isOpen, setIsOpen] = useState(false);
  // Only the user's explicit expand/collapse choices live in state; everything
  // else is derived, so the branch holding the selection stays revealed without
  // syncing state from an effect (see `WorkspaceHierarchyList`).
  const [expandedOverrides, setExpandedOverrides] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );

  // `useActiveWorkspaceId` falls back to the first workspace, so this resolves
  // whenever at least one workspace exists (guarded on `active` below).
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];
  // The trigger always presents the owning primary (一级) container so the button
  // reads as a stable category ("软件测试岗"…) instead of a specific secondary
  // employee's name when one is active.
  const activeContainer = active
    ? (primaryContainerOf(workspaces, active.id) ?? active)
    : undefined;
  const activeContainerId = activeContainer?.id ?? null;

  // With fewer than two workspaces there is nothing to switch, so keep the
  // footer uncluttered instead of showing a dead context row.
  if (workspaces.length < 2 || !active || !activeContainer) return null;

  const hasHierarchy = workspaces.some((w) => w.roleRank !== undefined);

  function togglePrimary(primaryId: string) {
    setExpandedOverrides((prev) => {
      const current = prev.get(primaryId) ?? primaryId === activeContainerId;
      return new Map(prev).set(primaryId, !current);
    });
  }

  function handleFlatAction(key: string) {
    setIsOpen(false);
    const selection = parseWorkspaceMenuKey(key);
    if (selection?.kind === "workspace") {
      useWorkspaceStore.getState().setActiveWorkspaceId(selection.workspaceId);
    }
  }

  function handleSelectSecondary(workspace: Workspace) {
    setIsOpen(false);
    openSecondaryEmployee(workspace);
  }

  /**
   * Selecting a post container scopes the app to that 岗位 *and its employees*
   * (see `workspaceScopeIds`). The menu stays open, and the branch reveals itself
   * because the freshly selected post is what the derived expansion defaults to —
   * so the user can drop straight into one of its employees.
   */
  function handleSelectPrimary(workspace: Workspace) {
    useWorkspaceStore.getState().setActiveWorkspaceId(workspace.id);
  }

  // Built once so the desktop menu and the mobile sheet can never drift apart.
  const workspaceEntries: MenuEntry[] = workspaces.map((workspace) => ({
    key: workspaceMenuKey(workspace.id),
    label: workspace.name,
    icon: <WorkspaceIcon icon={workspace.icon} className="size-4 text-muted" />,
    isSelected: workspace.id === active.id,
  }));

  const triggerContent = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <WorkspaceIcon icon={activeContainer.icon} className="size-4 text-muted" />
      </span>
      <div className="min-w-0">
        <span className="block truncate text-left">{activeContainer.name}</span>
      </div>
      {workspaces.length > 1 ? (
        <span className="flex shrink-0 items-center">
          <ChevronsUpDown className="size-3.5 text-muted" />
        </span>
      ) : null}
    </>
  );

  // Legacy flat workspaces (pre-two-tier seed) keep the original picker.
  if (!hasHierarchy) {
    if (workspaces.length === 2) {
      const nextWorkspace = workspaces.find((workspace) => workspace.id !== active.id)!;
      const switchToNext = () =>
        useWorkspaceStore.getState().setActiveWorkspaceId(nextWorkspace.id);
      return (
        <Tooltip delay={150}>
          <Tooltip.Trigger className="flex w-full min-h-0 flex-col">
            <button
              type="button"
              aria-label={t`Switch workspace`}
              className={sidebarRowClass()}
              onClick={switchToNext}
            >
              {triggerContent}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content placement="top">
            <WorkspaceSwitcherTooltip />
          </Tooltip.Content>
        </Tooltip>
      );
    }

    if (mobile) {
      return (
        <ResponsiveMenuSurface
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          label={t`Switch workspace`}
          trigger={
            <button
              type="button"
              aria-label={t`Switch workspace`}
              aria-expanded={isOpen}
              className={sidebarRowClass()}
              onClick={() => setIsOpen(true)}
            >
              {triggerContent}
            </button>
          }
        >
          <div className="m-sheet-list">
            {workspaceEntries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="m-sheet-action"
                aria-pressed={entry.isSelected || undefined}
                onClick={() => handleFlatAction(entry.key)}
              >
                {entry.icon}
                <span className="flex-1 truncate">{entry.label}</span>
                {entry.isSelected ? <Check className="size-4 shrink-0 text-accent" /> : null}
              </button>
            ))}
          </div>
        </ResponsiveMenuSurface>
      );
    }

    return (
      <Dropdown isOpen={isOpen} onOpenChange={setIsOpen}>
        <Tooltip delay={150}>
          <Tooltip.Trigger className="flex w-full min-h-0 flex-col">
            <Dropdown.Trigger aria-label={t`Switch workspace`} className={sidebarRowClass()}>
              {triggerContent}
            </Dropdown.Trigger>
          </Tooltip.Trigger>
          <Tooltip.Content placement="top">
            <WorkspaceSwitcherTooltip />
          </Tooltip.Content>
        </Tooltip>
        <Dropdown.Popover placement="top start">
          <Dropdown.Menu
            aria-label={t`Workspaces`}
            className="agentemployee-menu min-w-56"
            selectionMode="single"
            selectedKeys={[workspaceMenuKey(active.id)]}
            onAction={(key) => handleFlatAction(String(key))}
          >
            <Dropdown.Section>
              {workspaceEntries.map((entry) => (
                <Dropdown.Item key={entry.key} id={entry.key} textValue={entry.label}>
                  {entry.icon}
                  <Label>{entry.label}</Label>
                </Dropdown.Item>
              ))}
            </Dropdown.Section>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    );
  }

  // Two-tier hierarchy picker.
  if (mobile) {
    return (
      <ResponsiveMenuSurface
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        label={t`Switch workspace`}
        trigger={
          <button
            type="button"
            aria-label={t`Switch workspace`}
            aria-expanded={isOpen}
            className={sidebarRowClass()}
            onClick={() => setIsOpen(true)}
          >
            {triggerContent}
          </button>
        }
      >
        <div className="m-sheet-list">
          <WorkspaceHierarchyList
            expandedOverrides={expandedOverrides}
            activeContainerId={activeContainerId}
            activeWorkspaceId={active.id}
            onToggle={togglePrimary}
            onSelectPrimary={(workspace) => {
              // A sheet is a full-screen overlay, so picking a post dismisses it
              // (the desktop popover deliberately stays open to allow drilling in).
              setIsOpen(false);
              handleSelectPrimary(workspace);
            }}
            onSelectSecondary={handleSelectSecondary}
          />
        </div>
      </ResponsiveMenuSurface>
    );
  }

  return (
    <Dropdown isOpen={isOpen} onOpenChange={setIsOpen}>
      <Tooltip delay={150}>
        <Tooltip.Trigger className="flex w-full min-h-0 flex-col">
          <Dropdown.Trigger aria-label={t`Switch workspace`} className={sidebarRowClass()}>
            {triggerContent}
          </Dropdown.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Content placement="top">
          <WorkspaceSwitcherTooltip />
        </Tooltip.Content>
      </Tooltip>
      <Dropdown.Popover placement="top start">
        <div className="agentemployee-menu min-w-56 p-1.5">
          <WorkspaceHierarchyList
            expandedOverrides={expandedOverrides}
            activeContainerId={activeContainerId}
            activeWorkspaceId={active.id}
            onToggle={togglePrimary}
            onSelectPrimary={handleSelectPrimary}
            onSelectSecondary={handleSelectSecondary}
          />
        </div>
      </Dropdown.Popover>
    </Dropdown>
  );
}
