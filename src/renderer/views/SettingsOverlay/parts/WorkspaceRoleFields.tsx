import { useState } from "react";
import { Input } from "@heroui/react";
import { Plus, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common";

/**
 * Reusable editors for the digital-employee (岗位) fields shared by the
 * workspace employee editor: a tag input (Enter/comma to add, chip to remove)
 * and an add/remove responsibility row list. Both are controlled,
 * provider-agnostic string-list editors — they know nothing about providers.
 */

/** Commit the draft when Enter, comma, or blur fires; dedupe against chips. */
function commitChip(draft: string, chips: string[], onChange: (next: string[]) => void): string {
  const value = draft.trim().replace(/,$/u, "").trim();
  if (value && !chips.includes(value)) onChange([...chips, value]);
  return "";
}

/**
 * Tag-style input: existing values render as removable chips; typing and
 * pressing Enter (or comma) adds a new chip.
 */
export function TagInput(props: {
  chips: string[];
  onChange: (next: string[]) => void;
  ariaLabel: string;
  placeholder: string;
}) {
  const { t } = useLingui();
  const { chips, onChange } = props;
  const [draft, setDraft] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border px-2 py-1.5">
      {chips.map((chip) => (
        <span
          key={chip}
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground"
        >
          {chip}
          <button
            type="button"
            aria-label={t`Remove tag ${chip}`}
            onClick={() => onChange(chips.filter((entry) => entry !== chip))}
            className="text-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        aria-label={props.ariaLabel}
        placeholder={chips.length === 0 ? props.placeholder : ""}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            setDraft((current) => commitChip(current, chips, onChange));
          }
        }}
        onBlur={() => setDraft((current) => commitChip(current, chips, onChange))}
        className="min-w-16 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
      />
    </div>
  );
}

/**
 * Responsibility row list: one editable text input per duty with a remove
 * button, plus an "Add duty" button that appends an empty row.
 */
export function ResponsibilityList(props: {
  items: string[];
  onChange: (next: string[]) => void;
  ariaLabel: string;
  placeholder: string;
}) {
  const { t } = useLingui();
  const { items, onChange } = props;

  const updateAt = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };
  const removeAt = (index: number) => onChange(items.filter((_, itemIndex) => itemIndex !== index));

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={item}
            aria-label={`${props.ariaLabel} ${index + 1}`}
            placeholder={props.placeholder}
            onChange={(event) => updateAt(index, event.target.value)}
          />
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            aria-label={t`Remove duty`}
            onPress={() => removeAt(index)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onPress={() => onChange([...items, ""])}>
        <Plus className="size-4" />
        <Trans>Add duty</Trans>
      </Button>
    </div>
  );
}
