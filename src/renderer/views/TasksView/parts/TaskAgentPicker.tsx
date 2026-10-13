import { Trans } from "@lingui/react/macro";
import type { AgentStatus, ThreadPresentationMode } from "@/shared/contracts";
import { capabilitiesForPresentation } from "@/shared/agentSelection";
import { resolveFastValue } from "@/renderer/components/thread/threadDraftViewHelpers";
import {
  buildModelPickerControls,
  buildProviderModelMenuProviders,
} from "@/renderer/components/thread/buildModelPickerControls";
import { ThreadComposer } from "@/renderer/components/thread/ThreadComposer";

// Task runs use the same one-shot GUI (structured) posture as scheduled jobs,
// so the picker mirrors the Chat presentation surface.
const PRESENTATION_MODE: ThreadPresentationMode = "gui";

export interface TaskAgentSelection {
  agentKind: string;
  model: string;
  effort: string;
  fast: boolean;
}

interface TaskAgentPickerProps {
  agents: AgentStatus[];
  value: TaskAgentSelection;
  onChange: (patch: Partial<TaskAgentSelection>) => void;
}

/**
 * The agent + model/effort/fast control shared by the task editor and the
 * per-project task defaults dialog. Emits a patch of the changed fields.
 */
export function TaskAgentPicker(props: TaskAgentPickerProps) {
  const selected = props.agents.find((agent) => agent.kind === props.value.agentKind);
  if (!selected) return null;
  const presented = {
    ...selected,
    capabilities: capabilitiesForPresentation(selected.capabilities, PRESENTATION_MODE),
  };
  const providers = buildProviderModelMenuProviders(props.agents, {
    presentationMode: PRESENTATION_MODE,
  });
  const controls = buildModelPickerControls({
    providers,
    selectedAgentKind: props.value.agentKind,
    model: props.value.model,
    ...(props.value.effort ? { effort: props.value.effort } : {}),
    fast: props.value.fast,
    capabilities: presented.capabilities,
    presentationMode: PRESENTATION_MODE,
    includeFastToggle: true,
    onProviderModelChange: (nextSelection) => {
      const nextAgent = props.agents.find(
        (candidate) => candidate.kind === nextSelection.agentKind,
      );
      if (!nextAgent) return;
      const nextPresented = {
        ...nextAgent,
        capabilities: capabilitiesForPresentation(nextAgent.capabilities, PRESENTATION_MODE),
      };
      const caps = nextPresented.capabilities;
      const model = nextSelection.model;
      const efforts = caps.modelEfforts[model] ?? caps.efforts ?? [];
      const keepEffort = efforts.includes(props.value.effort);
      const defaultEffort =
        caps.defaultEffort && efforts.includes(caps.defaultEffort)
          ? caps.defaultEffort
          : (efforts[0] ?? "");
      props.onChange({
        agentKind: nextSelection.agentKind,
        model,
        effort: keepEffort ? props.value.effort : defaultEffort,
        fast: resolveFastValue(nextPresented, model, props.value.fast),
      });
    },
    onConfigPatch: (patch) => {
      const next: Partial<TaskAgentSelection> = {};
      if (patch.effort !== undefined) next.effort = patch.effort;
      if (patch.fast !== undefined) next.fast = patch.fast;
      if (Object.keys(next).length > 0) props.onChange(next);
    },
  });

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">
        <Trans>Agent</Trans>
      </h3>
      {controls.length > 0 ? (
        <ThreadComposer
          compact
          toolbarOnly
          hideSubmitButton
          controls={controls}
          placeholder=""
          prompt=""
          submitDisabled
          submitLabel=""
          onPromptChange={() => undefined}
          onSubmit={() => undefined}
        />
      ) : null}
    </section>
  );
}
