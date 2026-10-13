import { useLingui } from "@lingui/react/macro";
import { usePanelStore } from "@/renderer/state/panelStore";
import { PageLayout } from "@/renderer/components/layout/PageLayout";
import {
  productSurfaceView,
  useProductViewTracking,
} from "@/renderer/analytics/useProductViewTracking";
import { CapabilitiesSidebar } from "./parts/CapabilitiesSidebar";
import { ScenariosPanel } from "./parts/ScenariosPanel";
import { SkillsPanel } from "./parts/SkillsPanel";
import { ConnectorsPanel } from "./parts/ConnectorsPanel";

/**
 * Standalone page behind the sidebar's single "Scenarios · Skills · Connectors"
 * entry. Its own sidebar switches between the three views; the content column
 * renders the active one. This is the one home for these capabilities — the
 * matching sections were removed from Settings.
 */
export function CapabilitiesOverlay(props: { onClose: () => void }) {
  const { onClose } = props;
  const { t } = useLingui();
  const activeTab = usePanelStore((s) => s.capabilitiesTab);
  const setCapabilitiesTab = usePanelStore((s) => s.setCapabilitiesTab);

  // One surface per view so the three read apart in analytics, matching how the
  // editor reports `editor_<mode>` rather than a single generic surface.
  useProductViewTracking(
    productSurfaceView(`capabilities_${activeTab}`, "overlay"),
    "capabilities",
  );

  return (
    <PageLayout
      title={t`Scenarios · Skills · Connectors`}
      sidebar={
        <CapabilitiesSidebar
          activeTab={activeTab}
          onTabChange={setCapabilitiesTab}
          onClose={onClose}
        />
      }
      content={
        <div
          key={activeTab}
          data-capabilities-scroll-area="true"
          className="relative min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-8 [overflow-anchor:none] [scrollbar-gutter:stable]"
        >
          {activeTab === "scenarios" ? (
            <ScenariosPanel />
          ) : activeTab === "skills" ? (
            <SkillsPanel />
          ) : (
            <ConnectorsPanel />
          )}
        </div>
      }
    />
  );
}
