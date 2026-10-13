import { FolderPlus, Globe, PanelLeftClose, Search } from "lucide-react";
import { Button, Dropdown, Label, Tooltip } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { AnimatedTerminalIcon } from "@/renderer/components/common/AnimatedTerminalIcon";
import { useIsPanelTabVisible } from "@/renderer/state/panelDockSelectors";
import { usePanelStore } from "@/renderer/state/panelStore";
import { toggleBrowserPanel } from "@/renderer/actions/panelActions";
import { openTerminal } from "@/renderer/actions/terminalActions";
import {
  useCurrentProjectId,
  useIsProjectTerminalActive,
  useIsProjectTerminalBusy,
  useIsProjectTerminalOpen,
} from "@/renderer/hooks/uiSelectors";
import { useSidebar } from "@/renderer/views/MainView/parts/AppShell/AppShell";
import {
  type ThreadSortMode,
  sortModeOrder,
  sortModeIcon,
  sortModeLabel,
} from "@/renderer/views/MainView/parts/Sidebar/parts/sortMode";
import { CreateProjectMenu } from "@/renderer/views/MainView/parts/CreateProject/CreateProjectMenu";

/** Opens (or focuses) the active project's terminal; hidden when no project is active. */
function HeaderTerminalButton(props: { projectId: string }) {
  const { t } = useLingui();
  const hasTerminal = useIsProjectTerminalOpen(props.projectId);
  const isActiveTerminal = useIsProjectTerminalActive(props.projectId);
  const isBusy = useIsProjectTerminalBusy(props.projectId);
  const stateClass = isActiveTerminal
    ? "text-accent"
    : hasTerminal
      ? "text-foreground"
      : "text-muted hover:text-foreground";

  return (
    <Tooltip delay={150}>
      <Tooltip.Trigger>
        <Button
          isIconOnly
          aria-label={t`Terminal`}
          size="sm"
          variant="ghost"
          className={`size-6 min-w-0 ${stateClass}`}
          onPress={() => openTerminal(props.projectId)}
        >
          <AnimatedTerminalIcon className="size-3.5" isBusy={isBusy} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="bottom">
        <Trans>Terminal</Trans>
      </Tooltip.Content>
    </Tooltip>
  );
}

export function SidebarHeaderControls() {
  const { t } = useLingui();
  const { collapse } = useSidebar();
  const threadSortMode = usePanelStore((s) => s.threadSortMode);
  const browserPanelOpen = usePanelStore((s) => s.browserPanelOpen);
  const browserOnScreen = useIsPanelTabVisible("browser");
  const browserVisible = browserPanelOpen && browserOnScreen;
  const currentProjectId = useCurrentProjectId();

  return (
    <div className="agentemployee-overlay-header__controls flex items-center gap-1.5">
      <Tooltip delay={150}>
        <Tooltip.Trigger>
          <Button
            isIconOnly
            aria-label={t`Search`}
            size="sm"
            variant="ghost"
            className="size-6 min-w-0 text-muted hover:text-foreground"
            onPress={() => usePanelStore.getState().openThreadSearch()}
          >
            <Search className="size-3.5" />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content placement="bottom">
          <Trans>Search</Trans>
        </Tooltip.Content>
      </Tooltip>
      <CreateProjectMenu>
        <Button
          isIconOnly
          aria-label={t`Add project`}
          size="sm"
          variant="ghost"
          className="size-6 min-w-0 text-muted hover:text-foreground"
        >
          <FolderPlus className="size-3.5" />
        </Button>
      </CreateProjectMenu>
      <Dropdown>
        <Button
          isIconOnly
          aria-label={t`List options`}
          size="sm"
          variant="ghost"
          className="size-6 min-w-0 text-muted hover:text-foreground"
        >
          {(() => {
            const Icon = sortModeIcon[threadSortMode];
            return <Icon className="size-3.5" />;
          })()}
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            aria-label={t`Thread list options`}
            selectionMode="single"
            selectedKeys={[threadSortMode]}
            onAction={(key) => usePanelStore.getState().setThreadSortMode(key as ThreadSortMode)}
          >
            {sortModeOrder.map((mode) => {
              const Icon = sortModeIcon[mode];
              const label = t(sortModeLabel[mode]);
              return (
                <Dropdown.Item key={mode} id={mode} textValue={label}>
                  <Icon className="size-4 shrink-0 text-muted" />
                  <Label>{label}</Label>
                  <Dropdown.ItemIndicator />
                </Dropdown.Item>
              );
            })}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <Tooltip delay={150}>
        <Tooltip.Trigger>
          <Button
            isIconOnly
            aria-label={browserVisible ? t`Hide browser` : t`Open browser`}
            size="sm"
            variant="ghost"
            className="size-6 min-w-0 text-muted hover:text-foreground"
            onPress={toggleBrowserPanel}
          >
            <Globe className="size-3.5" />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content placement="bottom">
          <Trans>Browser</Trans>
        </Tooltip.Content>
      </Tooltip>
      {currentProjectId ? <HeaderTerminalButton projectId={currentProjectId} /> : null}
      <Tooltip delay={150}>
        <Tooltip.Trigger>
          <Button
            isIconOnly
            aria-label={t`Hide sidebar`}
            size="sm"
            variant="ghost"
            className="size-6 min-w-0 text-muted hover:text-foreground"
            onPress={collapse}
          >
            <PanelLeftClose className="size-3.5" />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content placement="bottom">
          <Trans>Hide sidebar</Trans>
        </Tooltip.Content>
      </Tooltip>
    </div>
  );
}
