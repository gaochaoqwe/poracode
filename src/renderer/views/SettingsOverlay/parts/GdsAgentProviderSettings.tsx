import { useState } from "react";
import { Button, toast } from "@heroui/react";
import { HardDriveDownload, Save } from "lucide-react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Input, Select } from "@/renderer/components/common";
import { readBridge } from "@/renderer/bridge";
import { flushSharedSettings, useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { friendlyError } from "@/shared/messages";
import type { NativeAgentSettingsPanelProps } from "./agentRegistryNative";
import { useLocalizedOptions } from "./settingsOptions";

/**
 * Wire protocol spoken by the configured endpoint.
 *
 * Mirrors `GDS_AGENT_PROTOCOLS` in `src/supervisor/agents/gds-agent/env.ts`. The
 * renderer deliberately does not import supervisor modules (same convention as
 * `components/providers/opencode`), so keep the two id lists in sync — a
 * mismatch would silently leave the endpoint on the wrong protocol.
 */
const ANTHROPIC_MESSAGES_PROTOCOL = "anthropic-messages";
const OPENAI_CHAT_COMPLETIONS_PROTOCOL = "openai-chat-completions";

const protocolOptions = [
  { id: ANTHROPIC_MESSAGES_PROTOCOL, label: msg`Anthropic Messages` },
  { id: OPENAI_CHAT_COMPLETIONS_PROTOCOL, label: msg`OpenAI Chat Completions` },
] as const;

/**
 * gdsAgent (gdsAgent) provider settings panel.
 *
 * AgentEmployee models gdsAgent (via the offline `gdsAgent.exe` ACP harness) as
 * a single Anthropic-compatible endpoint, so this panel exposes the model, API
 * key, base URL, and — for endpoints that implement nothing but OpenAI's Chat
 * Completions API — the wire protocol. The values land in
 * `agentSettings.gds-agent.{model,apiKey,baseUrl,protocol}` and the supervisor
 * merges them into the ACP spawn env on the next launch as `ANTHROPIC_MODEL` /
 * `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`, plus
 * `GDS_AGENT_USE_OPENAI_CHAT_COMPLETIONS` when the OpenAI protocol is selected —
 * the exact vars the bundled cc-haha gdsAgent backend reads. Empty values are
 * persisted as empty strings (not stripped) so an "unset" write is explicit and
 * survives the round-trip; the supervisor's `resolveGdsAgentEnv` drops empty
 * strings and omits the env entry.
 *
 * When gdsAgent is not detected yet, this panel shows an offline-install
 * prompt so the user can pick a local `gdsAgent.exe` delivered alongside the
 * AgentEmployee installer — mirroring Cline's offline-install flow.
 */
export function GdsAgentProviderSettings(props: NativeAgentSettingsPanelProps) {
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
  // An absent or unrecognised stored value means the default protocol, so the
  // selector never renders blank for a settings file written before this field
  // existed.
  const [protocol, setProtocol] = useState<string>(
    storedString("protocol") === OPENAI_CHAT_COMPLETIONS_PROTOCOL
      ? OPENAI_CHAT_COMPLETIONS_PROTOCOL
      : ANTHROPIC_MESSAGES_PROTOCOL,
  );
  const [pending, setPending] = useState(false);
  const [installPending, setInstallPending] = useState(false);
  // After a successful offline install, keep the credentials form visible
  // even before agent-status refresh lands a new `installed` row.
  const [offlineInstallComplete, setOfflineInstallComplete] = useState(false);

  const protocolOpts = useLocalizedOptions(protocolOptions);

  const isInstalled = offlineInstallComplete || statuses.some((status) => status.installed);

  const storedProtocol = storedString("protocol") || ANTHROPIC_MESSAGES_PROTOCOL;
  const hasChanges =
    model !== (stored.model ?? "") ||
    apiKey !== (stored.apiKey ?? "") ||
    baseUrl !== (stored.baseUrl ?? "") ||
    protocol !== storedProtocol;

  const onOfflineInstall = async () => {
    setInstallPending(true);
    try {
      const picked = await readBridge().pickFiles({
        title: t`Select gdsAgent.exe`,
        filters: [{ name: "gdsAgent.exe", extensions: ["exe"] }],
      });
      const sourcePath = picked?.[0];
      if (!sourcePath) return;

      const result = await readBridge().installGdsAgentOffline({
        agentKind: "gds-agent",
        sourcePath,
      });
      if (!result.ok) {
        toast.danger(result.reason ?? t`Failed to install gdsAgent from the selected file.`);
        return;
      }
      setOfflineInstallComplete(true);
      toast.success(
        result.version
          ? t`gdsAgent ${result.version} installed.`
          : t`gdsAgent installed from the selected file.`,
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
      setAgentSetting(agentKind, "protocol", protocol);
      await flushSharedSettings();
      await readBridge().refreshAgentStatuses(wslDistros, { agentKinds: [agentKind] });
    } catch (error) {
      // Roll back to the last good values so a failed save doesn't leave the
      // UI out of sync with what the supervisor actually sees.
      setAgentSetting(agentKind, "model", previous.model ?? "");
      setAgentSetting(agentKind, "apiKey", previous.apiKey ?? "");
      setAgentSetting(agentKind, "baseUrl", previous.baseUrl ?? "");
      setAgentSetting(
        agentKind,
        "protocol",
        typeof previous.protocol === "string" ? previous.protocol : "",
      );
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
            <Trans>Install gdsAgent</Trans>
          </p>
          <p className="text-xs text-muted">
            <Trans>
              gdsAgent (gdsAgent) is delivered separately from AgentEmployee. Choose a local{" "}
              <code>gdsAgent.exe</code> to install it for this machine.
            </Trans>
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="h-8 min-h-8 gap-1 px-2.5 text-[11px]"
          aria-label={t`Install gdsAgent from local file`}
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
          <Trans>gdsAgent credentials</Trans>
        </p>
        <p className="text-xs text-muted">
          <Trans>
            Configure the model, API key, and base URL the gdsAgent endpoint uses. Leave a field
            empty to fall back to whatever login the agent holds on disk.
          </Trans>
        </p>
      </div>

      <div className="grid gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">
            <Trans>Endpoint protocol</Trans>
          </span>
          <Select
            id="gds-agent-settings-protocol"
            aria-label={t`gdsAgent endpoint protocol`}
            className="h-8 min-h-8"
            options={protocolOpts}
            value={protocol}
            isDisabled={pending}
            onChange={(value) => setProtocol(value)}
          />
          <span className="text-xs text-muted">
            <Trans>
              Prefer Anthropic Messages when the endpoint offers it — it keeps prompt caching and
              streaming tool output. Pick OpenAI Chat Completions only for an endpoint that
              implements nothing else; the bundled agent translates it in-process.
            </Trans>
          </span>
        </div>

        <label className="flex flex-col gap-1" htmlFor="gds-agent-settings-model">
          <span className="text-xs text-muted">
            <Trans>Model</Trans>
          </span>
          <Input
            id="gds-agent-settings-model"
            aria-label={t`gdsAgent model`}
            className="h-8 min-h-8"
            placeholder={t`e.g. gdsAgent-sonnet-4.5`}
            value={model}
            disabled={pending}
            onChange={(event) => setModel(event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1" htmlFor="gds-agent-settings-api-key">
          <span className="text-xs text-muted">
            <Trans>API key</Trans>
          </span>
          <Input
            id="gds-agent-settings-api-key"
            aria-label={t`gdsAgent API key`}
            className="h-8 min-h-8"
            placeholder={t`Paste your provider API key`}
            type="password"
            value={apiKey}
            disabled={pending}
            onChange={(event) => setApiKey(event.currentTarget.value)}
          />
        </label>

        <label className="flex flex-col gap-1" htmlFor="gds-agent-settings-base-url">
          <span className="text-xs text-muted">
            <Trans>Base URL</Trans>
          </span>
          <Input
            id="gds-agent-settings-base-url"
            aria-label={t`gdsAgent base URL`}
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
          aria-label={t`Save gdsAgent settings`}
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
