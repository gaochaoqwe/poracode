import { useRef, type KeyboardEvent } from "react";
import { Tooltip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import type { AgentStatus } from "@/shared/contracts";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";

/**
 * Draft-composer agent harness row: one logo pill per installed agent, sitting
 * directly above the input, modelled on the reference selector in
 * `docs/codeg-main`. The selected pill expands to spell its name out; the rest
 * stay icon-only and are named by their tooltip.
 *
 * `Tooltip.Trigger` is the pill itself rather than a wrapper around a `<button>`:
 * the tooltip wiring then lands on the one element that carries the radio
 * semantics, and the row has no extra box between `radiogroup` and `radio`.
 *
 * Deliberately simpler than the reference: no width measurement, overflow
 * popover or sliding indicator. `flex-wrap` absorbs more agents than fit, and
 * the selected pill's own chrome is the indicator.
 */
export function AgentHarnessPicker(props: {
  /** Installed, enabled agents, in provider display order. */
  agents: readonly AgentStatus[];
  selectedKind: string;
  onSelect: (kind: string) => void;
}) {
  const { t } = useLingui();
  const { agents, selectedKind, onSelect } = props;
  const railRef = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(
    0,
    agents.findIndex((agent) => agent.kind === selectedKind),
  );

  function selectAt(index: number) {
    const next = agents.at(index);
    if (!next) return;
    if (next.kind !== selectedKind) onSelect(next.kind);
    railRef.current?.querySelector<HTMLElement>(`[data-harness-kind="${next.kind}"]`)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        selectAt((selectedIndex + 1) % agents.length);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        selectAt((selectedIndex - 1 + agents.length) % agents.length);
        break;
      case "Home":
        event.preventDefault();
        selectAt(0);
        break;
      case "End":
        event.preventDefault();
        selectAt(agents.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectAt(selectedIndex);
        break;
      default:
    }
  }

  return (
    <div
      ref={railRef}
      role="radiogroup"
      aria-label={t`Agent`}
      className="inline-flex min-w-0 flex-wrap items-center gap-0.5 rounded-full border border-border/15 bg-surface-tertiary/40 p-0.5"
    >
      {agents.map((agent) => {
        const isSelected = agent.kind === selectedKind;
        return (
          <Tooltip key={agent.kind} delay={150} isDisabled={isSelected}>
            <Tooltip.Trigger
              role="radio"
              aria-checked={isSelected}
              aria-label={agent.label}
              tabIndex={isSelected ? 0 : -1}
              data-harness-kind={agent.kind}
              onClick={() => {
                if (!isSelected) onSelect(agent.kind);
              }}
              onKeyDown={handleKeyDown}
              className={`flex h-6 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-full text-[11px] font-semibold tracking-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus/50 ${
                isSelected
                  ? "bg-background px-2.5 text-foreground shadow-sm"
                  : "px-1.5 text-muted hover:text-foreground/80"
              }`}
            >
              <ProviderIcon
                kind={agent.kind}
                {...(agent.icon ? { icon: agent.icon } : {})}
                fallbackLabel={agent.label}
                tone={isSelected ? "active" : "inactive"}
                className="size-4 shrink-0"
              />
              <span
                className={`grid transition-[grid-template-columns] duration-200 ${
                  isSelected ? "grid-cols-[1fr]" : "grid-cols-[0fr]"
                }`}
              >
                <span className="min-w-0 overflow-hidden whitespace-nowrap">{agent.label}</span>
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content placement="top">{agent.label}</Tooltip.Content>
          </Tooltip>
        );
      })}
    </div>
  );
}
