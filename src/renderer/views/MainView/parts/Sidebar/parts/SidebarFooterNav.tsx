import { Settings2 } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import { sidebarFooterNavClass } from "@/renderer/components/layout/sidebarChrome";
import { DeferredSettingsOverlay } from "@/renderer/deferredFeatures";
import { openRemoteAccessSettings, openSettings } from "@/renderer/actions/panelActions";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  RemoteAccessSidebarIcon,
  type RemoteAccessSidebarStatus,
  RemoteAccessSidebarTooltip,
} from "@/renderer/views/MainView/parts/Sidebar/parts/RemoteAccessSidebarIcon";
import { SidebarWorkspaceSwitcher } from "@/renderer/views/MainView/parts/Sidebar/parts/SidebarWorkspaceSwitcher";
import { UpdateButtons } from "@/renderer/views/MainView/parts/Sidebar/parts/UpdateButtons";
import { WhatsNewButton } from "@/renderer/views/MainView/parts/Sidebar/parts/WhatsNewButton";

function prewarmSettings(): void {
  void DeferredSettingsOverlay.preload();
}

/**
 * Sticky footer nav of the expanded sidebar: workspace switcher, optional
 * update/changelog entries, and Settings/Remote Access. The configurable
 * shortcuts and the Capabilities page (Scenarios · Skills · Connectors) live in
 * the top action cluster (`SidebarPrimaryActions`); hiding the sidebar lives in
 * the top header cluster instead.
 */
export function SidebarFooterNav(props: { remoteAccessStatus: RemoteAccessSidebarStatus }) {
  const { remoteAccessStatus } = props;
  const { t } = useLingui();
  const settingsOpen = usePanelStore((s) => s.settingsOpen);
  const settingsSection = usePanelStore((s) => s.settingsSection);
  const remoteAccessSettingsActive = settingsOpen && settingsSection === "remoteAccess";
  // Remote Access has its own sidebar entry, so the generic Settings button
  // lights up for every other section.
  const otherSettingsActive = settingsOpen && !remoteAccessSettingsActive;

  return (
    <div className={sidebarFooterNavClass}>
      <SidebarWorkspaceSwitcher />
      <UpdateButtons />
      <WhatsNewButton />
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <SidebarButton
            icon={<Settings2 className="size-4" />}
            label={t`Settings`}
            isActive={otherSettingsActive}
            onPreload={prewarmSettings}
            onPress={openSettings}
          />
        </div>
        <SidebarButton
          iconOnly
          icon={<RemoteAccessSidebarIcon status={remoteAccessStatus} />}
          label={t`Remote Access`}
          tooltip={<RemoteAccessSidebarTooltip status={remoteAccessStatus} />}
          isActive={remoteAccessSettingsActive}
          onPreload={prewarmSettings}
          onPress={openRemoteAccessSettings}
        />
      </div>
    </div>
  );
}
