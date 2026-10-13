import type { Project } from "@/shared/contracts";
import { SidebarProjectThreadList } from "./SidebarProjectThreadList";
import type { ThreadSortMode } from "./sortMode";

/**
 * The synthetic Home project's section. It renders no collapsible header — Home
 * threads sit flush at the top of the sidebar body — and its former terminal
 * button now lives in the top header cluster (`SidebarHeaderControls`).
 */
export function SidebarHomeSection(props: { homeProject: Project; sortMode: ThreadSortMode }) {
  const { homeProject, sortMode } = props;
  return (
    <section className="space-y-0.5">
      <SidebarProjectThreadList project={homeProject} sortMode={sortMode} />
    </section>
  );
}
