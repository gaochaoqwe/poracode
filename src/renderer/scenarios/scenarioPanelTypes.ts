import type { ComponentType } from "react";
import type { MessageDescriptor } from "@lingui/core";
import type { LucideIcon } from "lucide-react";
import type { ProjectLocation } from "@/shared/contracts";

/** Props every scenario panel component receives from the right-panel host. */
export interface ScenarioPanelProps {
  projectId: string;
  projectLocation?: ProjectLocation;
}

/**
 * A panel a feature/scenario declares for the right panel. Shared panel hosts
 * (UnifiedRightPanel, ProjectAuxiliaryPanel) never import these directly — they
 * resolve the available one through `scenarioPanelRegistry`, so no concrete
 * scenario name appears in shared code.
 */
export interface ScenarioPanelDefinition {
  id: string;
  label: MessageDescriptor;
  icon: LucideIcon;
  Component: ComponentType<ScenarioPanelProps>;
}

/** A resolved definition bound to the project the host should render it for. */
export interface RegisteredScenarioPanel {
  id: string;
  label: string;
  icon: LucideIcon;
  Component: ComponentType<ScenarioPanelProps>;
  projectId: string;
  projectLocation?: ProjectLocation;
}
