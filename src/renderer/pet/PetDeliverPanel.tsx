import { useMemo, useState, type FormEvent } from "react";
import { Button, Input, Label, TextArea, TextField } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { UserRound } from "lucide-react";
import { Select } from "@/renderer/components/common";
import { readBridge } from "@/renderer/bridge";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { employeeBinding, partitionEmployees } from "@/renderer/views/TasksView/employeeBinding";
import {
  buildDeliveryPrompt,
  createPetTask,
  derivePetTaskTitle,
  newPetTaskForm,
  petTaskFormIsValid,
  selectChiefStewardWorkspaceId,
  sendChiefStewardMessage,
  type TaskDeliverySource,
} from "./petConversation";

const DELIVERY_SOURCES: readonly TaskDeliverySource[] = ["oa", "mxt", "boss", "other"];

function sourceLabel(source: TaskDeliverySource): string {
  switch (source) {
    case "oa":
      return "OA";
    case "mxt":
      return "mxt";
    case "boss":
      return "Boss";
    default:
      return "Other";
  }
}

/**
 * The "deliver task" surface: paste a task (copied from OA / mxt / dictated / …),
 * tag its source, then drop a real card on the board *and* hand the paste to the
 * chief steward. The card is what the board and scheduler see; the message is
 * what the steward reacts to, so the paste stays a single action for the user.
 *
 * The employee owns the provider + model binding, so this asks for an assignee
 * instead of an agent — same rule as the full task editor.
 */
export function PetDeliverPanel() {
  const { t } = useLingui();
  const workspaceId = useSharedSettings(selectChiefStewardWorkspaceId);
  const workspaces = useSharedSettings((state) => state.workspaces);
  const [source, setSource] = useState<TaskDeliverySource>("other");
  const [content, setContent] = useState("");
  const [form, setForm] = useState(newPetTaskForm);
  const [sending, setSending] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { runnable, blocked } = useMemo(() => partitionEmployees(workspaces), [workspaces]);
  const bindings = useMemo(() => {
    const map = new Map<string, NonNullable<ReturnType<typeof employeeBinding>>>();
    for (const employee of runnable) {
      const binding = employeeBinding(employee);
      if (binding) map.set(employee.id, binding);
    }
    return map;
  }, [runnable]);

  // Fall back to the first runnable employee so paste-then-send never stalls on a
  // picker the user did not know they had to touch.
  const employeeId = form.employeeId || runnable[0]?.id || "";
  // The pasted work *is* the prompt; `content` is the single source for it so the
  // textarea and the created task can never drift apart.
  const effectiveForm = { ...form, employeeId, prompt: content };
  const canCreate = petTaskFormIsValid(effectiveForm, bindings);

  const employeeOptions = [
    ...runnable.map((employee) => {
      const binding = bindings.get(employee.id);
      return {
        id: employee.id,
        label: employee.name,
        icon: <UserRound className="size-4 shrink-0 text-muted" />,
        ...(binding ? { detail: `${binding.agentKind} · ${binding.model}` } : {}),
      };
    }),
    // Listed but disabled: a hidden employee looks like a missing one.
    ...blocked.map((employee) => ({
      id: employee.id,
      label: employee.name,
      icon: <UserRound className="size-4 shrink-0 text-muted/50" />,
      detail: t`No agent configured`,
      isDisabled: true,
    })),
  ];

  if (!workspaceId) {
    return (
      <section className="pet-panel pet-panel-setup">
        <p className="pet-setup-hint">
          <Trans>Choose a chief steward role in settings to deliver tasks here.</Trans>
        </p>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => void readBridge().petNavigateMain({ target: "home" })}
        >
          <Trans>Open main window</Trans>
        </Button>
      </section>
    );
  }

  const onContentChange = (next: string) => {
    setContent(next);
    // Only auto-fill an empty title, so a deliberate title is never overwritten.
    if (!form.title.trim()) {
      const derived = derivePetTaskTitle(next);
      if (derived) setForm((current) => ({ ...current, title: derived }));
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate || sending) return;
    setSending(true);
    setDelivered(false);
    setError(null);
    try {
      // The board card is the primary outcome; a steward message that fails
      // afterwards must not roll the card back.
      await createPetTask(effectiveForm, bindings);
      try {
        await sendChiefStewardMessage(buildDeliveryPrompt(source, content));
      } catch {
        // The card is already on the board; the steward just misses the ping.
      }
      setContent("");
      setForm(newPetTaskForm(employeeId));
      setDelivered(true);
    } catch {
      // Leave the pasted content so the user can retry without re-pasting.
      setError(t`Could not create the task. Try again.`);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="pet-panel pet-panel-deliver">
      <div className="pet-source-row" role="group" aria-label={t`Task source`}>
        {DELIVERY_SOURCES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`pet-source-option${candidate === source ? " pet-source-option-active" : ""}`}
            aria-pressed={candidate === source}
            onClick={() => setSource(candidate)}
          >
            {sourceLabel(candidate)}
          </button>
        ))}
      </div>
      <form className="pet-deliver-form" onSubmit={(event) => void onSubmit(event)}>
        <Select
          aria-label={t`Assignee`}
          options={employeeOptions}
          value={employeeId}
          placeholder={t`Pick an employee`}
          onChange={(nextEmployeeId) =>
            setForm((current) => ({ ...current, employeeId: nextEmployeeId }))
          }
        />
        <TextField
          value={form.title}
          onChange={(title) => setForm((current) => ({ ...current, title }))}
        >
          <Label>
            <Trans>Task title</Trans>
          </Label>
          <Input placeholder={t`e.g. Reply to the OA request`} maxLength={120} />
        </TextField>
        <TextField
          value={form.category}
          onChange={(category) => setForm((current) => ({ ...current, category }))}
        >
          <Label>
            <Trans>Category</Trans>
          </Label>
          <Input aria-label={t`Category`} placeholder={t`e.g. Billing`} maxLength={40} />
        </TextField>
        <TextField value={content} onChange={onContentChange} aria-label={t`Task content`}>
          <TextArea rows={5} placeholder={t`Paste the task content…`} />
        </TextField>
        <Button type="submit" size="sm" variant="primary" isDisabled={!canCreate || sending}>
          <Trans>Create task</Trans>
        </Button>
      </form>
      {error ? (
        <p className="pet-error" role="alert">
          {error}
        </p>
      ) : null}
      {delivered ? (
        <p className="pet-delivered" role="status">
          <Trans>Created on the task board</Trans>
        </p>
      ) : null}
    </section>
  );
}
