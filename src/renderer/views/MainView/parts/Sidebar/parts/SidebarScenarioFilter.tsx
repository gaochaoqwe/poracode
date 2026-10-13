import { useState } from "react";
import type { Selection } from "@heroui/react";
import { Dropdown, Label, Separator } from "@heroui/react";
import { Check, ChevronsUpDown, ListFilter } from "lucide-react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ScenarioDisplayGroup } from "@/renderer/scenarios/catalog";
import {
  ResponsiveMenuSurface,
  useResponsiveMenu,
} from "@/renderer/components/common/ResponsiveMenuSurface";
import { sidebarRowClass } from "@/renderer/components/common/SidebarButton";

/**
 * Menu id of the "All scenarios" reset row. Real category keys are sub-group
 * names and can't collide with this sentinel.
 */
const ALL_SCENARIOS_KEY = "__all_scenarios__";

/**
 * Category filter for the sidebar's scenario list: a multi-select of which
 * scenario categories (the requirements/design/change workstreams) to show,
 * defaulting to all of them. Mirrors {@link SidebarProjectFilter} — selecting
 * every category, or deselecting the last one, collapses back to "All
 * scenarios" (null), since a filter matching everything or nothing is
 * meaningless.
 *
 * The trigger is a sidebar row labelled with the current selection; the menu is
 * a desktop dropdown and a bottom sheet in the mobile PWA. Unlike the project
 * filter there is no stacked context menu, so no non-modal dismissal handling
 * is needed.
 */
export function SidebarScenarioFilter(props: {
  /** Labeled categories offered in the menu, in catalog order. */
  groups: readonly ScenarioDisplayGroup[];
  /** Selected category keys, pre-intersected by the caller; null = all. */
  value: ReadonlySet<string> | null;
  onChange: (next: string[] | null) => void;
}) {
  const { t, i18n } = useLingui();
  const { mobile } = useResponsiveMenu();
  const [isOpen, setIsOpen] = useState(false);

  const groupKeys = props.groups.map((group) => group.key);
  const isAll = props.value === null;
  // In the all state every category reads as selected — unchecking one then
  // filters it out, matching checkbox expectations.
  const selectedKeys: ReadonlySet<string> = props.value ?? new Set(groupKeys);
  const soleGroup =
    !isAll && selectedKeys.size === 1
      ? props.groups.find((group) => selectedKeys.has(group.key))
      : undefined;
  const labelFor = (group: ScenarioDisplayGroup) => (group.label ? i18n._(group.label) : group.key);

  const selectAll = () => props.onChange(null);

  const toggleGroup = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Empty and complete selections are both just "all".
    props.onChange(next.size === 0 || next.size >= groupKeys.length ? null : [...next]);
  };

  const triggerContent = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <ListFilter className="size-3.5 text-muted" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-left">
          {isAll ? (
            <Trans>All scenarios</Trans>
          ) : soleGroup ? (
            labelFor(soleGroup)
          ) : (
            <Plural value={selectedKeys.size} one="# category" other="# categories" />
          )}
        </span>
      </div>
      <span className="flex shrink-0 items-center">
        <ChevronsUpDown className="size-3.5 text-muted" />
      </span>
    </>
  );

  if (mobile) {
    return (
      <ResponsiveMenuSurface
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        label={t`Filter by scenario category`}
        trigger={
          <button
            type="button"
            aria-label={t`Filter by scenario category`}
            aria-expanded={isOpen}
            className={sidebarRowClass({ size: "xs" })}
            onClick={() => setIsOpen(true)}
          >
            {triggerContent}
          </button>
        }
      >
        <div className="m-sheet-list">
          <button
            type="button"
            className="m-sheet-action"
            aria-pressed={isAll || undefined}
            onClick={selectAll}
          >
            <span className="flex-1 truncate">
              <Trans>All scenarios</Trans>
            </span>
            {isAll ? <Check className="size-4 shrink-0 text-accent" /> : null}
          </button>
          {props.groups.map((group) => {
            const selected = selectedKeys.has(group.key);
            return (
              <button
                key={group.key}
                type="button"
                className="m-sheet-action"
                aria-pressed={selected || undefined}
                onClick={() => toggleGroup(group.key)}
              >
                <span className="min-w-0 flex-1 truncate">{labelFor(group)}</span>
                {selected ? <Check className="size-4 shrink-0 text-accent" /> : null}
              </button>
            );
          })}
        </div>
      </ResponsiveMenuSurface>
    );
  }

  // Controlled multi-selection menu: a press flips one key, so diff the new
  // selection against the rendered one to find it, then route through the same
  // toggle/reset logic as the sheet. Selection changes never close the menu.
  const menuSelectedKeys = new Set<string>([
    ...(isAll ? [ALL_SCENARIOS_KEY] : []),
    ...selectedKeys,
  ]);
  const handleSelectionChange = (keys: Selection) => {
    if (keys === "all") {
      selectAll();
      return;
    }
    const next = new Set([...keys].map(String));
    let pressed: string | undefined;
    for (const key of next) {
      if (!menuSelectedKeys.has(key)) {
        pressed = key;
        break;
      }
    }
    if (pressed === undefined) {
      for (const key of menuSelectedKeys) {
        if (!next.has(key)) {
          pressed = key;
          break;
        }
      }
    }
    if (pressed === undefined) return;
    if (pressed === ALL_SCENARIOS_KEY) {
      selectAll();
      return;
    }
    toggleGroup(pressed);
  };

  return (
    <Dropdown isOpen={isOpen} onOpenChange={setIsOpen}>
      <Dropdown.Trigger
        aria-label={t`Filter by scenario category`}
        className={`${sidebarRowClass({ size: "xs" })} h-8`}
      >
        {triggerContent}
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu
          aria-label={t`Scenarios`}
          className="agentemployee-menu min-w-48"
          selectionMode="multiple"
          selectedKeys={menuSelectedKeys}
          onSelectionChange={handleSelectionChange}
        >
          <Dropdown.Item
            key={ALL_SCENARIOS_KEY}
            id={ALL_SCENARIOS_KEY}
            textValue={t`All scenarios`}
          >
            <Label className="flex-1 truncate">
              <Trans>All scenarios</Trans>
            </Label>
            <Dropdown.ItemIndicator />
          </Dropdown.Item>
          <Separator />
          {props.groups.map((group) => (
            <Dropdown.Item key={group.key} id={group.key} textValue={labelFor(group)}>
              <Label className="min-w-0 truncate">{labelFor(group)}</Label>
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
