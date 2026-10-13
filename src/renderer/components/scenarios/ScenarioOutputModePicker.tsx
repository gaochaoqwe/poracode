import { Fragment } from "react";
import { ToggleButton, ToggleButtonGroup, Tooltip } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ScenarioOutputMode } from "@/renderer/scenarios/catalog";

interface ScenarioOutputModePickerProps {
  modes: readonly ScenarioOutputMode[];
  /** Active mode id; falls back to the first mode when unset or unknown. */
  selectedMode?: string | undefined;
  onSelectMode: (modeId: string) => void;
}

/**
 * Card for a scenario's output modes (e.g. "based on reference code" vs "from
 * scratch"), laid out as the next cell after the scenario's input cards. Each
 * mode's guidance shows as a tooltip on hover, so the card stays compact.
 * Rendered by {@link ScenarioInputsPanel} only for scenarios that declare
 * `outputModes`.
 */
export function ScenarioOutputModePicker(props: ScenarioOutputModePickerProps) {
  const { i18n, t } = useLingui();
  const { modes, selectedMode, onSelectMode } = props;
  const active = modes.find((mode) => mode.id === selectedMode) ?? modes[0];
  if (!active) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[color:var(--border)] p-3">
      <span className="text-sm font-medium text-foreground">
        <Trans>审查模式</Trans>
      </span>
      <ToggleButtonGroup
        aria-label={t`审查模式`}
        size="sm"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[active.id]}
        onSelectionChange={(keys) => {
          const next = [...keys][0];
          if (typeof next === "string") onSelectMode(next);
        }}
      >
        {modes.map((mode, index) => {
          const button = (
            <ToggleButton id={mode.id}>
              {index > 0 ? <ToggleButtonGroup.Separator /> : null}
              {i18n._(mode.label)}
            </ToggleButton>
          );
          return mode.hint ? (
            <Tooltip key={mode.id} delay={300}>
              {button}
              <Tooltip.Content placement="top">{i18n._(mode.hint)}</Tooltip.Content>
            </Tooltip>
          ) : (
            <Fragment key={mode.id}>{button}</Fragment>
          );
        })}
      </ToggleButtonGroup>
      {active.agentInstruction ? (
        <div className="rounded-lg bg-[color:var(--surface-secondary)] px-3 py-2 text-xs leading-relaxed text-muted">
          {i18n._(active.agentInstruction)}
        </div>
      ) : null}
    </div>
  );
}
