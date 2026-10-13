import type { Project } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { useWorkspaceThreadFilter } from "@/renderer/state/workspaceSelectors";

/**
 * Section list and project-filter state for the sidebar body. The sidebar
 * always renders one collapsible section per project (Home first when enabled),
 * and {@link SidebarProjectFilter} lets the user check/uncheck projects to hide
 * their sections. The persisted filter is intersected with the sections that
 * currently exist: ids naming a project that is gone or now hidden away are
 * dropped, and a selection covering every section — or an empty one — reads as
 * "all" (null), so the filter can never leave the list empty.
 */
export function useSidebarProjectFilter(input: {
  /** Active workspace's project ids (excludes Home), in store order. */
  projectIds: readonly string[];
  homeProject: Project | undefined;
  homeScopeEnabled: boolean;
}) {
  const { projectIds, homeProject, homeScopeEnabled } = input;
  const projects = useAppStore((state) => state.projects);
  const threads = useAppStore((state) => state.threads);
  const persistedFilter = useSidebarUiStore((state) => state.flatListProjectFilter);
  const onChange = useSidebarUiStore((state) => state.setFlatListProjectFilter);
  const isThreadInActiveWorkspace = useWorkspaceThreadFilter();

  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const home = homeScopeEnabled ? homeProject : undefined;
  const sections: Project[] = [
    ...(home ? [home] : []),
    ...projectIds.flatMap((id) => {
      const project = projectsById.get(id);
      return project ? [project] : [];
    }),
  ];
  const filterableProjectIds = new Set(sections.map((project) => project.id));

  // A selection covering every section (or none) behaves — and reads — the same
  // as no filter, matching the filter's own empty/complete collapse.
  const kept = persistedFilter?.filter((id) => filterableProjectIds.has(id)) ?? [];
  const activeProjectFilter: ReadonlySet<string> | null =
    kept.length === 0 || kept.length >= sections.length ? null : new Set(kept);
  const isVisible = (projectId: string) =>
    activeProjectFilter === null || activeProjectFilter.has(projectId);

  const visibleProjectIds = projectIds.filter((id) => projectsById.has(id) && isVisible(id));
  const isHomeVisible = home ? isVisible(home.id) : false;

  const threadCounts = new Map<string, number>();
  for (const thread of threads) {
    if (thread.archived) continue;
    if (!filterableProjectIds.has(thread.projectId)) continue;
    if (!isThreadInActiveWorkspace(thread)) continue;
    threadCounts.set(thread.projectId, (threadCounts.get(thread.projectId) ?? 0) + 1);
  }

  return {
    /** Menu rows in render order (Home first), including disabled projects. */
    projects: sections,
    filterableProjectIds,
    /** Selected ids pre-intersected with the current sections; null = all. */
    activeProjectFilter,
    visibleProjectIds,
    isHomeVisible,
    /** One project alone has nothing to filter against. */
    showFilterHead: sections.length > 1,
    threadCounts,
    onChange,
  };
}
