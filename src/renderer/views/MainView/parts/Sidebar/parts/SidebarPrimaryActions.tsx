import { Boxes, Library, Plus } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import { DeferredCapabilitiesOverlay } from "@/renderer/deferredFeatures";
import { openKnowledgeBase } from "@/renderer/actions/knowledgeActions";
import { openCapabilities } from "@/renderer/actions/panelActions";
import { openNewThread } from "@/renderer/actions/threadActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useKnowledgeBaseStore } from "@/renderer/state/knowledgeBaseStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSidebarShortcuts } from "./sidebarShortcuts";
import { SidebarScenarioList } from "./SidebarScenarioList";

function prewarmCapabilities(): void {
  void DeferredCapabilitiesOverlay.preload();
}

/**
 * The sidebar's primary actions, pinned at the top of the expanded column and
 * mirrored in the collapsed rail: New thread, then the configurable shortcuts
 * (default: Workbench), then the Capabilities page (Scenarios · Skills ·
 * Connectors). Shared by both surfaces so their order and visibility can't
 * drift.
 */
export function SidebarPrimaryActions(props: { iconOnly?: boolean }) {
  const { iconOnly = false } = props;
  const { t } = useLingui();
  const appView = useAppStore((s) => s.view);
  const capabilitiesOpen = usePanelStore((s) => s.capabilitiesOpen);
  const knowledgeBaseOpen = useKnowledgeBaseStore((s) => s.open);
  const sidebarShortcuts = useSidebarShortcuts();

  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <SidebarButton
        iconOnly={iconOnly}
        icon={<Plus className="size-4" />}
        label={t`New thread`}
        isActive={appView.kind === "draft"}
        onPress={() => openNewThread()}
      />
      {sidebarShortcuts.map((shortcut) => (
        <SidebarButton
          key={shortcut.id}
          iconOnly={iconOnly}
          icon={shortcut.icon}
          label={shortcut.label}
          isActive={shortcut.isActive}
          onPress={shortcut.onPress}
        />
      ))}
      <SidebarButton
        iconOnly={iconOnly}
        icon={<Boxes className="size-4" />}
        label={t`Scenarios · Skills · Connectors`}
        isActive={capabilitiesOpen}
        onPreload={prewarmCapabilities}
        onPress={() => openCapabilities()}
      />
      <SidebarButton
        iconOnly={iconOnly}
        icon={<Library className="size-4" />}
        label={t`Knowledge Base`}
        isActive={knowledgeBaseOpen}
        onPress={openKnowledgeBase}
      />
      {!iconOnly ? <SidebarScenarioList /> : null}
    </div>
  );
}
