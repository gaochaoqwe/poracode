import { ArrowLeft, Box, Cable, Compass, PanelLeft, PanelLeftClose } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import {
  overlaySidebarColumnClass,
  overlaySidebarSurfaceClass,
  sidebarBodyScrollClass,
  sidebarFooterNavClass,
  sidebarIconRailFooterClass,
} from "@/renderer/components/layout/sidebarChrome";
import { SidebarButton } from "@/renderer/components/common";
import { useSidebar } from "@/renderer/views/MainView/parts/AppShell/AppShell";
import type { CapabilityTab } from "@/renderer/state/panelStore";

/**
 * The three switchable views of the Capabilities page. Order here is the order
 * in both the expanded sidebar and the collapsed icon rail.
 */
export function CapabilitiesSidebar(props: {
  activeTab: CapabilityTab;
  onTabChange: (tab: CapabilityTab) => void;
  onClose: () => void;
}) {
  const { activeTab, onTabChange, onClose } = props;
  const { t } = useLingui();
  const { isCollapsed, collapse, expand } = useSidebar();

  const tabs: { id: CapabilityTab; icon: React.ReactNode; label: string }[] = [
    { id: "scenarios", icon: <Compass className="size-4" />, label: t`Scenarios` },
    { id: "skills", icon: <Box className="size-4" />, label: t`Skills` },
    { id: "connectors", icon: <Cable className="size-4" />, label: t`Connectors` },
  ];

  return (
    <div className={`relative h-full ${overlaySidebarSurfaceClass}`}>
      {isCollapsed && (
        <div className="absolute inset-0 z-10 flex h-full min-h-0 flex-col items-start gap-3 pl-2 pb-1 pt-0">
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {tabs.map((tab) => (
              <SidebarButton
                key={tab.id}
                iconOnly
                icon={tab.icon}
                label={tab.label}
                isActive={activeTab === tab.id}
                onPress={() => onTabChange(tab.id)}
              />
            ))}
          </div>
          <div className={sidebarIconRailFooterClass}>
            <SidebarButton
              iconOnly
              icon={<ArrowLeft className="size-4" />}
              label={t`Return to app`}
              onPress={onClose}
            />
            <SidebarButton
              iconOnly
              icon={<PanelLeft className="size-4" />}
              label={t`Show sidebar`}
              onPress={expand}
            />
          </div>
        </div>
      )}

      <div
        className={`${overlaySidebarColumnClass} transition-opacity duration-150 ${isCollapsed ? "invisible opacity-0" : "opacity-100 delay-100"}`}
      >
        <div className={sidebarBodyScrollClass()}>
          <div className="space-y-0.5">
            {tabs.map((tab) => (
              <SidebarButton
                key={tab.id}
                icon={tab.icon}
                label={tab.label}
                isActive={activeTab === tab.id}
                onPress={() => onTabChange(tab.id)}
              />
            ))}
          </div>
        </div>

        <div className={sidebarFooterNavClass}>
          <SidebarButton
            icon={<ArrowLeft className="size-4" />}
            label={t`Return to app`}
            onPress={onClose}
          />
          <SidebarButton
            icon={<PanelLeftClose className="size-4" />}
            label={t`Hide sidebar`}
            onPress={collapse}
          />
        </div>
      </div>
    </div>
  );
}
