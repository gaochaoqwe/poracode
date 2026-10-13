import { useState, type FormEvent } from "react";
import { Button, TextArea, TextField } from "@heroui/react";
import { Send } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  buildPetTranscript,
  selectChiefStewardWorkspaceId,
  sendChiefStewardMessage,
} from "./petConversation";

/**
 * The chief-steward chat. It finds the live role thread in the app store, streams
 * its visible rows, and sends through the supervisor thread mechanism. When the
 * role is not configured yet it shows a setup hint instead of a dead box.
 */
export function PetConversationPanel() {
  const { t } = useLingui();
  const workspaceId = useSharedSettings(selectChiefStewardWorkspaceId);
  const threadId = useAppStore(
    (state) =>
      state.threads.find((thread) => !thread.archived && thread.workspaceId === workspaceId)?.id,
  );
  const threadStatus = useAppStore(
    (state) => state.threads.find((thread) => thread.id === threadId)?.status,
  );
  // Narrow subscriptions: only this thread's item record / id list triggers a rerender.
  const itemIds = useAppStore((state) =>
    threadId ? state.runtimeItemIdsByThread[threadId] : undefined,
  );
  const items = useAppStore((state) =>
    threadId ? state.runtimeItemsByIdByThread[threadId] : undefined,
  );

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  if (!workspaceId) {
    return (
      <section className="pet-panel pet-panel-setup">
        <p className="pet-setup-hint">
          <Trans>Choose a chief steward role in settings to start chatting here.</Trans>
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

  const entries = buildPetTranscript(itemIds, items);
  const busy = sending || threadStatus === "working" || threadStatus === "launching";

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await sendChiefStewardMessage(trimmed);
      setDraft("");
    } catch {
      // A failed send leaves the draft so the user can retry; the toast layer is
      // not critical on the tiny pet surface.
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="pet-panel pet-panel-chat">
      <div className="pet-transcript" role="log" aria-live="polite">
        {entries.length === 0 ? (
          <p className="pet-empty">
            <Trans>Say hello to the chief steward.</Trans>
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`pet-message pet-message-${entry.role}`}>
              {entry.text}
            </div>
          ))
        )}
        {threadStatus === "working" ? (
          <div className="pet-message pet-message-assistant pet-streaming">
            <Trans>…</Trans>
          </div>
        ) : null}
      </div>
      <form className="pet-composer" onSubmit={(event) => void onSubmit(event)}>
        <TextField
          className="pet-composer-input"
          value={draft}
          onChange={setDraft}
          aria-label={t`Message the chief steward`}
        >
          <TextArea rows={1} placeholder={t`Message…`} />
        </TextField>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          isIconOnly
          isDisabled={!draft.trim() || busy}
          aria-label={t`Send`}
          className="pet-composer-send"
        >
          <Send className="size-4" />
        </Button>
      </form>
    </section>
  );
}
