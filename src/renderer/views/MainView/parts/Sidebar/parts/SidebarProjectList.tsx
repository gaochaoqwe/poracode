import type { Project } from "@/shared/contracts";
import { sidebarBodyScrollClass } from "@/renderer/components/layout/sidebarChrome";
import { useScrollFade } from "@/renderer/hooks/useScrollFade";
import { SidebarHomeSection } from "./SidebarHomeSection";
import { SidebarProjectFilter } from "./SidebarProjectFilter";
import { SidebarProjectSection } from "./SidebarProjectSection";
import { useSidebarProjectFilter } from "./useSidebarProjectFilter";
import type { ThreadSortMode } from "./sortMode";

/**
 * The sidebar's single thread-list layout: one collapsible section per project
 * (Home first), with the project filter pinned above the scroll area so
 * checking/unchecking a project shows or hides its section.
 */
export function SidebarProjectList(props: {
  sortMode: ThreadSortMode;
  projectIds: readonly string[];
  homeProject: Project | undefined;
  homeScopeEnabled: boolean;
}) {
  const { sortMode, projectIds, homeProject, homeScopeEnabled } = props;
  const filter = useSidebarProjectFilter({ projectIds, homeProject, homeScopeEnabled });
  const { setScrollContainer, scrollFadeStyle } = useScrollFade<HTMLDivElement>({
    maxFadePx: 10,
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {filter.showFilterHead ? (
        // Pinned above the scroll body, mirroring the old flat list's head.
        <div className="flex shrink-0 items-center gap-1 pb-0.5">
          <div className="min-w-0 flex-1">
            <SidebarProjectFilter
              projects={filter.projects}
              filterableProjectIds={filter.filterableProjectIds}
              threadCounts={filter.threadCounts}
              value={filter.activeProjectFilter}
              onChange={filter.onChange}
            />
          </div>
        </div>
      ) : null}
      <div ref={setScrollContainer} className={sidebarBodyScrollClass()} style={scrollFadeStyle}>
        <div className="space-y-4">
          {filter.isHomeVisible && homeProject ? (
            <SidebarHomeSection homeProject={homeProject} sortMode={sortMode} />
          ) : null}
          {filter.visibleProjectIds.map((projectId) => (
            <SidebarProjectSection
              key={projectId}
              projectId={projectId}
              // Unfiltered store order — dnd resolves a drop back to the full
              // project list, so hidden sections must not shift the indices.
              projectIndex={projectIds.indexOf(projectId)}
              sortMode={sortMode}
              reorderDisabled={filter.activeProjectFilter !== null}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
