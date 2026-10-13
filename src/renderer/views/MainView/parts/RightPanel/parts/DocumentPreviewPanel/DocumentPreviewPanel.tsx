import { useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { resolveProjectLocation } from "@/shared/worktree";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { MarkdownPreview } from "@/renderer/views/FileEditorOverlay/parts/MarkdownPreview";

/** Coalesce the bursts of watcher events a single write produces. */
const REREAD_DEBOUNCE_MS = 400;

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; content: string }
  | { kind: "error" };

/** The file is not written yet — the common case before the agent runs. */
function isMissingError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return code === "ENOENT" || /ENOENT|no such file/iu.test(message);
}

/**
 * Live view of the document a scenario is generating. It tracks one project
 * relative `path` (the template's result file) and re-reads it whenever the
 * supervisor reports the project tree changed — the watcher event carries no
 * file name, so every change re-reads the tracked path. Before the agent writes
 * the file it shows a waiting state.
 */
export function DocumentPreviewPanel(props: { projectId: string; worktreePath?: string; path: string }) {
  const projectLocation = useAppStore(
    (state) => state.projects.find((project) => project.id === props.projectId)?.location,
  );
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const timerRef = useRef<number | undefined>(undefined);
  const { projectId, worktreePath, path } = props;

  useEffect(() => {
    if (!projectLocation) return;
    const location = resolveProjectLocation(projectLocation, worktreePath);
    let cancelled = false;

    async function load() {
      try {
        const result = await readBridge().readProjectFile({ projectLocation: location, path });
        if (cancelled) return;
        if (result.status === "ready" && typeof result.content === "string") {
          setState({ kind: "ready", content: result.content });
        } else {
          setState({ kind: "error" });
        }
      } catch (error) {
        if (!cancelled) setState({ kind: isMissingError(error) ? "missing" : "error" });
      }
    }

    void load();
    const unsubscribe = readBridge().onSupervisorEvent((event) => {
      if (event.type !== "project-tree-changed" || event.projectId !== projectId) return;
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void load(), REREAD_DEBOUNCE_MS);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, [projectLocation, projectId, worktreePath, path]);

  if (!projectLocation) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted">
        <Trans>Couldn't read the document.</Trans>
      </div>
    );
  }

  if (state.kind === "ready") {
    return <MarkdownPreview content={state.content} compact />;
  }

  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted">
      {state.kind === "loading" ? (
        <Trans>Loading the document…</Trans>
      ) : state.kind === "missing" ? (
        <span>
          <Trans>Waiting for the agent to write the document…</Trans>
          <span className="mt-1 block font-mono text-[11px] text-muted/80">{props.path}</span>
        </span>
      ) : (
        <Trans>Couldn't read the document.</Trans>
      )}
    </div>
  );
}
