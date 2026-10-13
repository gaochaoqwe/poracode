import { useState } from "react";
import { Button, Input, Label, Modal, TextArea, TextField } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { UserRound } from "lucide-react";
import type { TaskDraft, Workspace } from "@/shared/contracts";
import { Select } from "@/renderer/components/common";

/** The draft editor's target: a fresh draft, a row being edited, or closed. */
export type DraftEditorTarget = { kind: "new" } | { kind: "edit"; draft: TaskDraft } | null;

/** Links the category input to its suggestion list (a native `<datalist>`). */
const CATEGORY_SUGGESTIONS_ID = "task-draft-category-suggestions";

export interface DraftEditorSubmit {
  title: string;
  note: string;
  category: string;
  employeeId: string;
}

interface DraftEditorDialogProps {
  mode: DraftEditorTarget;
  busy: boolean;
  /** Distinct categories already in use, offered as free-text suggestions. */
  knownCategories: string[];
  /** Employees an idea can be parked for; empty means the picker hides. */
  employees: Workspace[];
  onClose: () => void;
  onSubmit: (input: DraftEditorSubmit) => void;
}

/**
 * Title + note only — a draft is an idea, so it deliberately asks for nothing
 * the task editor would (agent, model, prompt). The employee is optional here:
 * parking an idea for a role up front carries over when it becomes a task, but
 * an idea may also have no owner yet.
 */
export function DraftEditorDialog(props: DraftEditorDialogProps) {
  return (
    <Modal.Backdrop
      isOpen={props.mode !== null}
      onOpenChange={(open) => !open && !props.busy && props.onClose()}
    >
      <Modal.Container size="md">
        <Modal.Dialog className="sm:max-w-[520px]">
          {/* Keyed by target so switching drafts remounts the form and re-seeds
              its fields, instead of an effect racing the user's typing. */}
          {props.mode ? (
            <DraftForm
              key={props.mode.kind === "edit" ? props.mode.draft.id : "new"}
              mode={props.mode}
              busy={props.busy}
              knownCategories={props.knownCategories}
              employees={props.employees}
              onClose={props.onClose}
              onSubmit={props.onSubmit}
            />
          ) : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function DraftForm(props: {
  mode: NonNullable<DraftEditorTarget>;
  busy: boolean;
  knownCategories: string[];
  employees: Workspace[];
  onClose: () => void;
  onSubmit: (input: DraftEditorSubmit) => void;
}) {
  const { t } = useLingui();
  const editing = props.mode.kind === "edit" ? props.mode.draft : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [employeeId, setEmployeeId] = useState(editing?.employeeId ?? "");

  return (
    <>
      <Modal.CloseTrigger isDisabled={props.busy} />
      <Modal.Header>
        <Modal.Heading>{editing ? t`Edit draft` : t`New draft`}</Modal.Heading>
      </Modal.Header>
      <Modal.Body className="gap-6">
        <TextField value={title} onChange={setTitle}>
          <Label>
            <Trans>Title</Trans>
          </Label>
          <Input placeholder={t`A rough idea`} />
        </TextField>
        {props.employees.length > 0 ? (
          <TextField
            value={employeeId}
            onChange={setEmployeeId}
            className="flex items-center justify-between gap-4"
          >
            <Label>
              <Trans>Assignee</Trans>
            </Label>
            <Select
              aria-label={t`Assignee`}
              className="w-[240px] shrink-0"
              options={[
                { id: "", label: t`Unassigned` },
                ...props.employees.map((employee) => ({
                  id: employee.id,
                  label: employee.name,
                  icon: <UserRound className="size-4 shrink-0 text-muted" />,
                })),
              ]}
              value={employeeId}
              placeholder={t`Unassigned`}
              onChange={setEmployeeId}
            />
          </TextField>
        ) : null}
        <TextField value={category} onChange={setCategory}>
          <Label>
            <Trans>Category</Trans>
          </Label>
          <Input
            aria-label={t`Category`}
            placeholder={t`e.g. Billing`}
            list={CATEGORY_SUGGESTIONS_ID}
            maxLength={40}
          />
          <datalist id={CATEGORY_SUGGESTIONS_ID}>
            {props.knownCategories.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </datalist>
        </TextField>
        <TextField value={note} onChange={setNote}>
          <Label>
            <Trans>Note</Trans>
          </Label>
          <TextArea rows={4} placeholder={t`Any details worth keeping`} />
        </TextField>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" isDisabled={props.busy} onPress={props.onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="tertiary"
          className="text-foreground"
          isPending={props.busy}
          isDisabled={title.trim().length === 0}
          onPress={() =>
            props.onSubmit({ title: title.trim(), note: note.trim(), category, employeeId })
          }
        >
          {editing ? <Trans>Save changes</Trans> : <Trans>Create draft</Trans>}
        </Button>
      </Modal.Footer>
    </>
  );
}
