import { Button, Surface } from "@heroui/react";
import { FolderOpen, Paperclip, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectLocation } from "@/shared/contracts";
import type { Attachment } from "@/renderer/components/composer/useAttachments";
import type { ScenarioView } from "@/renderer/scenarios/catalog";
import type { ScenarioCodeSelection } from "@/renderer/state/scenarioInputsStore";
import { CodeExcludePicker } from "./CodeExcludePicker";
import { ScenarioOutputModePicker } from "./ScenarioOutputModePicker";

interface ScenarioInputsPanelProps {
  scenario: ScenarioView;
  /** All draft attachments; those tagged with an input id show in that input's box. */
  attachments: readonly Attachment[];
  codeSelections: Readonly<Record<string, ScenarioCodeSelection | undefined>> | undefined;
  projectLocation: ProjectLocation;
  /** Absolute project root, for resolving `code` input subdirectories. */
  projectRoot: string;
  /** Required inputs still unsatisfied (drives the warning styling). */
  missingInputIds: ReadonlySet<string>;
  /** Active output-mode id; only read when the scenario declares `outputModes`. */
  outputMode?: string | undefined;
  onAttachFiles: (inputId: string) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onPickCodeDir: (inputId: string) => void;
  onToggleExcludedDir: (inputId: string, name: string) => void;
  onSelectOutputMode?: ((modeId: string) => void) | undefined;
}

/**
 * The scenario draft's input checklist: one box per input. File inputs take
 * attachments; `code` inputs take a directory inside the project plus a pick of
 * its third-party/library subdirectories to exclude. Required inputs that are
 * still empty are flagged and gate the send button.
 */
export function ScenarioInputsPanel(props: ScenarioInputsPanelProps) {
  const { i18n, t } = useLingui();
  const inputs = props.scenario.requiredInputs ?? [];
  // Keep the panel even when a scenario declares no required inputs but does
  // declare output modes (e.g. code-review's 函数/链路/功能 selector) — the
  // mode picker must still show so the user can pick which skill the agent uses.
  const hasOutputModes =
    (props.scenario.outputModes?.length ?? 0) > 0 && Boolean(props.onSelectOutputMode);
  if (inputs.length === 0 && !hasOutputModes) return null;

  return (
    <Surface variant="secondary" className="mb-2 rounded-xl">
      {props.scenario.inputsNote ? (
        <p className="px-3 pt-3 text-xs leading-relaxed text-muted">
          {i18n._(props.scenario.inputsNote)}
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-2.5 px-3 pb-3 pt-2">
        {inputs.map((input) => {
          const missing = props.missingInputIds.has(input.id);
          const files = props.attachments.filter((a) => a.inputId === input.id);
          const code = props.codeSelections?.[input.id];
          return (
            <div
              key={input.id}
              className={`flex min-w-0 flex-col gap-2 rounded-lg border p-3 ${
                missing ? "border-warning/50" : "border-[color:var(--border)]"
              }`}
            >
              <div className="flex items-start gap-1.5">
                <span className="text-sm font-medium text-foreground">{i18n._(input.label)}</span>
                <span className={`text-xs ${input.required ? "text-warning" : "text-muted"}`}>
                  {input.required ? <Trans>Required</Trans> : <Trans>Optional</Trans>}
                </span>
              </div>
              {input.hint ? <span className="text-xs text-muted">{i18n._(input.hint)}</span> : null}

              {input.kind === "code" ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="shrink-0"
                      onPress={() => props.onPickCodeDir(input.id)}
                    >
                      <FolderOpen aria-hidden className="size-4" />
                      {t`Choose a project folder`}
                    </Button>
                    <span className="min-w-0 truncate text-xs text-muted" title={code?.dir}>
                      {code?.dir ?? <Trans>No folder selected</Trans>}
                    </span>
                  </div>
                  {code?.dir ? (
                    <CodeExcludePicker
                      projectLocation={props.projectLocation}
                      projectRoot={props.projectRoot}
                      dir={code.dir}
                      selected={code.excludedDirs ?? []}
                      onToggle={(name) => props.onToggleExcludedDir(input.id, name)}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="self-start"
                    onPress={() => props.onAttachFiles(input.id)}
                  >
                    <Paperclip aria-hidden className="size-4" />
                    {t`Add files`}
                  </Button>
                  {files.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {files.map((file) => (
                        <li key={file.id} className="flex items-center gap-1.5 text-xs text-muted">
                          <span className="min-w-0 truncate" title={file.name}>
                            {file.name}
                          </span>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            aria-label={t`Remove`}
                            onPress={() => props.onRemoveAttachment(file.id)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
        {props.scenario.outputModes?.length && props.onSelectOutputMode ? (
          <ScenarioOutputModePicker
            modes={props.scenario.outputModes}
            selectedMode={props.outputMode}
            onSelectMode={props.onSelectOutputMode}
          />
        ) : null}
      </div>
    </Surface>
  );
}
