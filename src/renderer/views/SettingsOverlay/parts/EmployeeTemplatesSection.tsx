import { useState } from "react";
import { Button, Surface, toast, Tooltip } from "@heroui/react";
import { Download, Import, Rocket } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  EMPLOYEE_TEMPLATES,
  applyEmployeeTemplate,
  buildTemplateFromWorkspace,
  parseTemplate,
  serializeTemplate,
} from "@/renderer/state/employeeTemplates";
import { ConfirmDialog } from "@/renderer/components/common/ConfirmDialog";
import { Select } from "@/renderer/components/common";

/**
 * Adopt a built-in digital-employee (岗位) role template, or import/export role
 * templates as JSON. "一键上岗" creates a new workspace and fills its employee
 * profile from the template, so a role is brought online with its persona,
 * capabilities and default binding in one step.
 */
export function EmployeeTemplatesSection() {
  const { t } = useLingui();
  const workspaces = useSharedSettings((state) => state.workspaces);
  const [importing, setImporting] = useState(false);
  const [exportSource, setExportSource] = useState<string>(workspaces[0]?.id ?? "");

  function adopt(_templateName: string, _template: (typeof EMPLOYEE_TEMPLATES)[number]) {
    const workspace = applyEmployeeTemplate(_templateName, _template);
    if (workspace) {
      toast.success(i18n._(msg`Role created.`));
    }
  }

  function exportCurrent() {
    const source = workspaces.find((w) => w.id === exportSource);
    if (!source) return;
    void navigator.clipboard.writeText(serializeTemplate(buildTemplateFromWorkspace(source)));
    toast.success(i18n._(msg`Role template copied to the clipboard.`));
  }

  function commitImport(json: string) {
    const template = parseTemplate(json);
    if (!template) {
      toast.danger(i18n._(msg`Not a valid role template.`));
      return;
    }
    applyEmployeeTemplate(template.name, template);
    toast.success(i18n._(msg`Role imported.`));
  }

  return (
    <>
      <h2 className="mb-2 mt-6 text-sm font-semibold text-foreground">
        <Trans>Role templates</Trans>
      </h2>
      <p className="mb-3 text-xs text-muted">
        <Trans>
          Adopt a ready-made role (岗位), or import/export your own as JSON. Each template brings a
          persona, capabilities and a default provider binding.
        </Trans>
      </p>

      <Surface variant="secondary" className="divide-y divide-[var(--hairline)] rounded-xl">
        {EMPLOYEE_TEMPLATES.map((template) => (
          <div key={template.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-sm font-medium text-foreground">{template.name}</p>
              {template.description ? (
                <p className="truncate text-xs text-muted">{template.description}</p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => adopt(template.name, template)}
            >
              <Rocket className="size-4" />
              <Trans>Adopt</Trans>
            </Button>
          </div>
        ))}
      </Surface>

      <div className="mt-3 flex items-center gap-2">
        <Select
          aria-label={t`Export a role`}
          className="w-[220px]"
          options={workspaces.map((workspace) => ({ id: workspace.id, label: workspace.name }))}
          value={exportSource}
          onChange={setExportSource}
        />
        <Tooltip delay={150}>
          <Tooltip.Trigger>
            <Button size="sm" variant="secondary" isDisabled={!exportSource} onPress={exportCurrent}>
              <Download className="size-4" />
              <Trans>Export</Trans>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>
            <Trans>Copy this role's profile as a template</Trans>
          </Tooltip.Content>
        </Tooltip>
        <Tooltip delay={150}>
          <Tooltip.Trigger>
            <Button size="sm" variant="secondary" onPress={() => setImporting(true)}>
              <Import className="size-4" />
              <Trans>Import</Trans>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>
            <Trans>Paste a role template JSON</Trans>
          </Tooltip.Content>
        </Tooltip>
      </div>

      <ImportTemplateDialog
        isOpen={importing}
        onConfirm={(json) => commitImport(json)}
        onClose={() => setImporting(false)}
      />
    </>
  );
}

function ImportTemplateDialog(props: {
  isOpen: boolean;
  onConfirm: (json: string) => void;
  onClose: () => void;
}) {
  const [json, setJson] = useState("");
  return (
    <ConfirmDialog
      isOpen={props.isOpen}
      title={i18n._(msg`Import role template`)}
      body={
        <textarea
          value={json}
          onChange={(event) => setJson(event.target.value)}
          rows={8}
          className="w-full rounded-lg border border-[var(--hairline)] bg-transparent p-2 font-mono text-xs text-foreground outline-none"
          placeholder={i18n._(msg`Paste role template JSON here…`)}
        />
      }
      confirmLabel={i18n._(msg`Import`)}
      onConfirm={() => {
        props.onConfirm(json);
        setJson("");
        props.onClose();
      }}
      onClose={() => {
        setJson("");
        props.onClose();
      }}
    />
  );
}
