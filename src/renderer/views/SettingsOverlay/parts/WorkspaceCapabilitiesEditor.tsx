import { useLingui } from "@lingui/react/macro";
import { ORG_CAPABILITIES } from "@/shared/orgCapabilities";
import { TagInput } from "./WorkspaceRoleFields";

const ORG_CAPABILITY_ID_SET = new Set(ORG_CAPABILITIES.map((entry) => entry.id));

/**
 * Role (岗位) capability editor: a checkbox list over the system capability
 * registry (`ORG_CAPABILITIES`) plus a tag input for custom ids the registry
 * does not know yet. Implemented capabilities show a solid dot; catalogued but
 * not-yet-implemented ones show a hollow dot — purely visual, both are
 * selectable. Registry-unknown ids land in the tag input as unknown/unavailable
 * chips. Pure data binding: capability ids are never provider names.
 */
export function WorkspaceCapabilitiesEditor(props: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useLingui();
  const { selected, onChange } = props;
  const selectedSet = new Set(selected);

  const toggle = (id: string) => {
    onChange(selectedSet.has(id) ? selected.filter((entry) => entry !== id) : [...selected, id]);
  };

  return (
    <div className="space-y-2">
      <div className="flex max-h-48 flex-col overflow-y-auto rounded-lg border border-border py-1">
        {ORG_CAPABILITIES.map((entry) => {
          const isOn = selectedSet.has(entry.id);
          return (
            <button
              key={entry.id}
              type="button"
              role="checkbox"
              aria-checked={isOn}
              title={entry.description ?? entry.label}
              onClick={() => toggle(entry.id)}
              className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-secondary"
            >
              <span
                aria-hidden
                className={
                  entry.implemented
                    ? "size-1.5 shrink-0 rounded-full bg-emerald-500"
                    : "size-1.5 shrink-0 rounded-full border border-muted"
                }
              />
              <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
            </button>
          );
        })}
      </div>
      <TagInput
        chips={selected.filter((id) => !ORG_CAPABILITY_ID_SET.has(id))}
        onChange={(customIds) => {
          const known = selected.filter((id) => ORG_CAPABILITY_ID_SET.has(id));
          onChange([...known, ...customIds]);
        }}
        ariaLabel={t`Custom capability id`}
        placeholder={t`Type a custom capability id and press Enter`}
      />
    </div>
  );
}
