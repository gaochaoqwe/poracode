import {
  groupScenariosForDisplay,
  type ScenarioDisplayGroup,
  type ScenarioView,
} from "@/renderer/scenarios/catalog";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";

/** A display group plus its persisted collapse state, ready to render. */
export interface SidebarScenarioGroup extends ScenarioDisplayGroup {
  collapsed: boolean;
}

/**
 * Category filter and collapse state for the sidebar's scenario list. Mirrors
 * {@link useSidebarProjectFilter}: the persisted category filter is intersected
 * with the categories that currently exist, and a selection covering every
 * category — or an empty one — reads as "all" (null), so the filter can never
 * leave the list empty. Only groups with a label (the sub-group workstreams)
 * are filterable; a header-less "flat" run always shows.
 */
export function useSidebarScenarioGroups(scenarios: readonly ScenarioView[]) {
  const persistedFilter = useSidebarUiStore((state) => state.scenarioCategoryFilter);
  const setFilter = useSidebarUiStore((state) => state.setScenarioCategoryFilter);
  const collapsedCategories = useSidebarUiStore((state) => state.collapsedScenarioCategories);
  const toggleCollapsed = useSidebarUiStore((state) => state.toggleScenarioCategoryCollapsed);

  const groups = groupScenariosForDisplay(scenarios);
  const filterableGroups = groups.filter((group) => group.label !== null);
  const filterableKeys = filterableGroups.map((group) => group.key);

  const kept = persistedFilter?.filter((key) => filterableKeys.includes(key)) ?? [];
  const filterValue: ReadonlySet<string> | null =
    kept.length === 0 || kept.length >= filterableKeys.length ? null : new Set(kept);

  const visibleGroups: SidebarScenarioGroup[] = groups
    .filter((group) => group.label === null || filterValue === null || filterValue.has(group.key))
    .map((group) => ({ ...group, collapsed: collapsedCategories[group.key] ?? false }));

  return {
    /** Groups to render, in catalog order, each with its collapse state. */
    groups: visibleGroups,
    /** One category alone has nothing to filter against. */
    showFilter: filterableGroups.length > 1,
    /** Categories offered in the filter menu. */
    filterableGroups,
    /** Selected category keys pre-intersected with the current groups; null = all. */
    filterValue,
    onChange: setFilter,
    toggleCollapsed,
  };
}
