import { useState } from "react";
import { Button, toast } from "@heroui/react";
import { HardDriveDownload, Save } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Input } from "@/renderer/components/common";
import { readBridge } from "@/renderer/bridge";
import { flushSharedSettings, useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { friendlyError } from "@/shared/messages";
import type { NativeAgentSettingsPanelProps } from "./agentRegistryNative";

/**
 * Cline provider settings panel.
 *
 * AgentEmployee models Cline as a single OpenAI-compatible endpoint, so this panel
 * never asks for a provider id — the supervisor pins Cline's
 * `openai-compatible` provider ("OpenAI Compatible") on every spawn. A
 * free-text provider id was an easy way to break Cline: an invalid value like
 * a capitalized brand name would be rejected by the CLI.
 *
 * The form exposes the model, API key, and base URL. The values land in
 * `agentSettings.cline.{model,apiKey,baseUrl}` and the supervisor merges them
 * into the ACP spawn env on the next launch.
 *
 * Cline has no dedicated `CLINE_BASE_URL` env var; its OpenAI-compatible
 * provider reads `OPENAI_BASE_URL` for the upstream URL. We forward the form's
 * `baseUrl` value into that env so enterprise users can point Cline at an
 * internal LLM gateway without touching `cline auth` or any on-disk config.
 * Empty values are intentionally persisted as empty strings (not stripped) so
 * an "unset" write is explicit and survives the round-trip — the supervisor's
 * `resolveClineEnv` treats empty strings as "no value" and skips the env
 * entry.
 *
 * When Cline is not detected yet, this panel shows an offline-install
 * prompt so the user can pick a local `cline.exe` delivered alongside the
 * AgentEmployee installer (Cline is no longer bundled as extraResources).
 */
export function ClineProviderSettings(props: NativeAgentSettingsPanelProps) {
  const { t } = useLingui();
  const { agentKind, wslDistros, statuses } = props;
  const stored = useSharedSettings((state) => state.agentSettings[agentKind]) ?? {};
  const setAgentSetting = useSharedSettings((state) => state.setAgentSetting);

  // `agentSettings[agentKind]` is `Record<string, boolean | string>` so every
  // saved value is `string | boolean | undefined`. Narrow to string before
  // handing the field to HeroUI's Input — its `value` prop rejects booleans.
  const storedString = (key: string): string => {
    const raw = (stored as Record<string, unknown>)[key];
    return typeof raw === "string" ? raw : "";
  };
  const [model, setModel] = useState(storedString("model"));
  const [apiKey, setApiKey] = useState(storedString("apiKey"));
  const [baseUrl, setBaseUrl] = useState(storedString("baseUrl"));
  const [pending, setPending] = useState(false);
  const [installPending, setInstallPending] = useState(false);
  // After a successful offline install, keep the credentials form visible
  // even before agent-status refresh lands a new `installed` row.
  const [offlineInstallComplete, setOfflineInstallComplete] = useState(false);

  const isInstalled = offlineInstallComplete || statuses.some((status) => status.installed);

  const hasChanges =
    model !== (stored.model ?? "") ||
    apiKey !== (stored.apiKey ?? "") ||
    baseUrl !== (stored.baseUrl ?? "");

  const onOfflineInstall = async () => {
    setInstallPending(true);
    try {
      const picked = await readBridge().pickFiles({
        title: t`Select cline.exe`,
        filters: [{ name: "cline.exe", extensions: ["exe"] }],
      });
      const sourcePath = picked?.[0];
      if (!sourcePath) return;

      const result = await readBridge().installClineOffline({
        agentKind: "cline",
        sourcePath,
      });
      if (!result.ok) {
        toast.danger(result.reason ?? t`Failed to install Cline from the selected file.`);
        return;
      }
      setOfflineInstallComplete(true);
      toast.success(
        result.version
          ? t`Cline ${result.version} installed.`
          : t`Cline installed from the selected file.`,
      );
      await readBridge().refreshAgentStatuses(wslDistros, { agentKinds: [agentKind] });
    } catch (error) {
      toast.danger(friendlyError(error));
    } finally {
      setInstallPending(false);
    }
  };

  const onSave = async () => {
    setPending(true);
    const previous = { ...stored };
    try {
      setAgentSetting(agentKind, "model", model);
      setAgentSetting(agentKind, "apiKey", apiKey);
      setAgentSetting(agentKind, "baseUrl", baseUrl);
      await flushSharedSettings();
      await readBridge().refreshAgentStatuses(wslDistros, { agentKinds: [agentKind] });
    } catch (error) {
      // Roll back to the last good values so a failed save doesn't leave the
      // UI out of sync with what the supervisor actually sees.
      setAgentSetting(agentKind, "model", previous.model ?? "");
      setAgentSetting(agentKind, "apiKey", previous.apiKey ?? "");
      setAgentSetting(agentKind, "baseUrl", previous.baseUrl ?? "");
      toast.danger(friendlyError(error));
    } finally {
      setPending(false);
    }
  };

  if (!isInstalled) {
    return (
      <div className="border-t border-border/10 pt-3">
        <div className="mb-3">
          <p className="text-sm font-medium text-foreground">
            <Trans>Install Cline</Trans>
          </p>
          <p className="text-xs text-muted">
            <Trans>
              Cline is delivered separately from AgentEmployee. Choose a local <code>cline.exe</code> to
              install it for this machine, or use the install command above if you have network
              access.
            </Trans>
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="h-8 min-h-8 gap-1 px-2.5 text-[11px]"
          aria-label={t`Install Cline from local file`}
          isDisabled={installPending}
          isPending={installPending}
          onPress={() => void onOfflineInstall()}
        >
          <HardDriveDownload className="size-3" />
          <Trans>Offline install…</Trans>
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t border-border/10 pt-3">
      <div className="mb-3">
        <p className="text-sm font-medium text-foreground">
          <Trans>Cline credentials</Trans>
        </p>
        <p className="text-xs text-muted">
          <Trans>
            Configure the model, API key, and base URL of the OpenAI-compatible endpoint Cline
            uses. Leave a field empty to fall back to whatever Cline wrote to disk via{" "}
            <code>cline auth</code>.
          </Trans>
        </p>
      </div>

      <div className="grid gap-3">
        <label className="flex flex-col gap-1" htmlFor="cline-settings-model">
          <span className="text-xs text-muted">
            <Trans>Model</Trans>
          </span>
          <Input
            id="cline-settings-model"
            aria-label={t`Cline model`}
            className="h-8 min-h-8"
            placeholder={t`e.g. gdsAgent-sonnet-4.5`}
            value={model}
            disabled={pending}
            onChange={(event) => setModel(event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1" htmlFor="cline-settings-api-key">
          <span className="text-xs text-muted">
            <Trans>API key</Trans>
          </span>
          <Input
            id="cline-settings-api-key"
            aria-label={t`Cline API key`}
            className="h-8 min-h-8"
            placeholder={t`Paste your provider API key`}
            type="password"
            value={apiKey}
            disabled={pending}
            onChange={(event) => setApiKey(event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1" htmlFor="cline-settings-base-url">
          <span className="text-xs text-muted">
            <Trans>Base URL</Trans>
          </span>
          <Input
            id="cline-settings-base-url"
            aria-label={t`Cline base URL`}
            className="h-8 min-h-8"
            placeholder={t`e.g. https://your-internal-gateway/v1`}
            value={baseUrl}
            disabled={pending}
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
          />
        </label>
      </div>

      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          variant="tertiary"
          className="h-8 min-h-8 gap-1 px-2.5 text-[11px]"
          aria-label={t`Save Cline settings`}
          isDisabled={pending || !hasChanges}
          isPending={pending}
          onPress={() => void onSave()}
        >
          <Save className="size-3" />
          <Trans>Save</Trans>
        </Button>
      </div>
    </div>
  );
}
