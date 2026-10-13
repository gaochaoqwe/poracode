import type {
  AgentSlashCommand,
  AgentStatus,
  Project,
  ProjectLocation,
  PendingSteerState,
  ThreadFollowUpQueueState,
  ThreadConfig,
} from "@/shared/contracts";
import {
  changeThreadConfig,
  resolveThreadServerRequest,
} from "@/renderer/actions/threadRuntimeActions";
import { openFileInEditor } from "@/renderer/utils/gitHelpers";
import type { OpenRuntimeRequest } from "@/renderer/state/slices/runtimeEventSlice";
import { ThreadCommandPanel } from "./ThreadCommandPanel";
import { ThreadContextDock } from "./ThreadContextDock";
import { ThreadErrorDock } from "./ThreadErrorDock";
import { ThreadPendingSteerStrip } from "./ThreadPendingSteerStrip";
import { ThreadFollowUpQueue } from "./ThreadFollowUpQueue";
import { ThreadRuntimeRequestPanel } from "./ThreadRuntimeRequestPanel";
import { ThreadAuthRequiredDock } from "./ThreadAuthRequiredDock";
import { RequirementQualityDock } from "@/renderer/components/qualityReview/RequirementQualityDock";
import type { RequirementQualityDockState } from "@/renderer/components/qualityReview/requirementQualityDockState";
import type { ThreadContextUsageSummary } from "./threadContextUsage";
import type { ThreadErrorDockState } from "./threadErrorState";

type ThreadComposerDocksProps = {
  // Visibility flags — each gates one dock.
  showContextInComposer: boolean;
  showErrorInComposer: boolean;
  showQualityReviewInComposer: boolean;
  authRequired: boolean;
  showCommandPanel: boolean;
  // Dock-relevant data.
  threadId: string;
  projectLocation: ProjectLocation;
  threadConfig: ThreadConfig;
  worktreePath: string | undefined;
  branchName: string | undefined;
  agentStatus: AgentStatus | undefined;
  project: Project | undefined;
  contextSummary: ThreadContextUsageSummary;
  errorDockStates: ThreadErrorDockState[];
  qualityReviewDockState: RequirementQualityDockState | null;
  pendingSteer: PendingSteerState | undefined;
  followUpQueue?: ThreadFollowUpQueueState | null | undefined;
  activeRuntimeRequest: OpenRuntimeRequest | undefined;
  filteredCommands: AgentSlashCommand[];
  slashActiveIndex: number;
  commandListId: string;
  // Callbacks.
  onCloseContextDock: () => void;
  onDismissError: (sourceItemId: string) => void;
  onCancelPendingSteer: () => void;
  onRestoreComposerFocus?: (() => void) | undefined;
  onOpenProjectRelativePath?: ((path: string, lineNumber?: number) => void) | undefined;
  onSlashActiveIndexChange: (index: number) => void;
  onSelectCommand: (command: AgentSlashCommand) => void;
};

/**
 * Renders the conditional dock tree shown in the composer's `fixedContent`.
 * Pure presentational extraction from ThreadComposerSection — each dock is
 * gated by a visibility flag computed in the parent; this component does not
 * own any state.
 */
export function ThreadComposerDocks(props: ThreadComposerDocksProps) {
  const {
    showContextInComposer,
    showErrorInComposer,
    showQualityReviewInComposer,
    authRequired,
    showCommandPanel,
    threadId,
    threadConfig,
    worktreePath,
    branchName,
    agentStatus,
    project,
    contextSummary,
    errorDockStates,
    qualityReviewDockState,
    pendingSteer,
    followUpQueue,
    activeRuntimeRequest,
    filteredCommands,
    slashActiveIndex,
    commandListId,
    onCloseContextDock,
    onDismissError,
    onCancelPendingSteer,
    onOpenProjectRelativePath,
    onSlashActiveIndexChange,
    onSelectCommand,
  } = props;

  return (
    <>
      {showContextInComposer ? (
        <ThreadContextDock summary={contextSummary} onClose={onCloseContextDock} />
      ) : null}
      {showErrorInComposer
        ? errorDockStates.map((state) => (
            <ThreadErrorDock
              key={state.sourceItemId}
              state={state}
              onDismiss={() => onDismissError(state.sourceItemId)}
            />
          ))
        : null}
      {showQualityReviewInComposer && qualityReviewDockState ? (
        <RequirementQualityDock threadId={threadId} state={qualityReviewDockState} />
      ) : null}
      {authRequired && agentStatus ? (
        <ThreadAuthRequiredDock agentStatus={agentStatus} {...(project ? { project } : {})} />
      ) : null}
      {pendingSteer ? (
        <ThreadPendingSteerStrip pending={pendingSteer} onCancel={onCancelPendingSteer} />
      ) : null}
      <ThreadFollowUpQueue
        key={threadId}
        threadId={threadId}
        queue={followUpQueue ?? null}
        onRestoreFocus={props.onRestoreComposerFocus}
      />
      {activeRuntimeRequest ? (
        <ThreadRuntimeRequestPanel
          key={activeRuntimeRequest.requestId}
          threadId={threadId}
          agentLabel={agentStatus?.label}
          request={activeRuntimeRequest}
          onResolve={(input) => resolveThreadServerRequest(threadId, input)}
          onPlanApproved={(optionId) =>
            changeThreadConfig(threadId, {
              ...threadConfig,
              mode: "agent",
              ...(optionId === "default" || optionId === "auto"
                ? { approvalPolicy: optionId }
                : {}),
            })
          }
          onOpenPlanFile={
            project
              ? (path) => {
                  if (onOpenProjectRelativePath) {
                    onOpenProjectRelativePath(path);
                    return;
                  }
                  void openFileInEditor(project, worktreePath, branchName, path, {
                    markdownPreview: true,
                  });
                }
              : undefined
          }
        />
      ) : null}
      {showCommandPanel ? (
        <ThreadCommandPanel
          commands={filteredCommands}
          activeIndex={slashActiveIndex}
          listId={commandListId}
          onActiveIndexChange={onSlashActiveIndexChange}
          onSelect={onSelectCommand}
        />
      ) : null}
    </>
  );
}
