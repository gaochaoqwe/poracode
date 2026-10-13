import type { IpcProcedureName } from "@/shared/ipc";
import { REMOTE_IPC_ADAPTER_SPECS } from "@/shared/remote";
import {
  REMOTE_NOOP_PROCEDURES,
  REMOTE_PROCEDURE_SPECS,
  type RemoteNoopProcedureName,
  type RemoteProcedureName,
  type RemoteProcedureOwner,
} from "@/shared/remote/procedures";

export type RemoteRouteHandler =
  | "passthrough"
  | "noop"
  | "adapter"
  | "thread-clipboard-image"
  | "thread-handoff-context"
  | "shell-start"
  | "shell-close";

export interface RemoteProcedureRouteSpec {
  readonly owner: RemoteProcedureOwner;
  readonly handler: RemoteRouteHandler;
}

const passthroughRoutes = Object.fromEntries(
  Object.entries(REMOTE_PROCEDURE_SPECS).map(([procedure, spec]) => [
    procedure,
    { owner: spec.owner, handler: "passthrough" },
  ]),
) as Record<RemoteProcedureName, RemoteProcedureRouteSpec>;

const noopRoutes = Object.fromEntries(
  Object.entries(REMOTE_NOOP_PROCEDURES).map(([procedure, owner]) => [
    procedure,
    { owner, handler: "noop" },
  ]),
) as Record<RemoteNoopProcedureName, RemoteProcedureRouteSpec>;

const adapterRoutes = Object.fromEntries(
  Object.entries(REMOTE_IPC_ADAPTER_SPECS).map(([procedure, owner]) => [
    procedure,
    { owner, handler: "adapter" },
  ]),
) as Record<keyof typeof REMOTE_IPC_ADAPTER_SPECS, RemoteProcedureRouteSpec>;

/** Single policy table for choosing the host and transport for project-aware IPC. */
export const REMOTE_PROCEDURE_ROUTES = {
  ...passthroughRoutes,
  ...noopRoutes,
  ...adapterRoutes,
  saveClipboardImage: { owner: "thread", handler: "thread-clipboard-image" },
  saveHandoffContext: { owner: "thread", handler: "thread-handoff-context" },
  startShell: { owner: "projectLocation", handler: "shell-start" },
  closeThread: { owner: "terminal", handler: "shell-close" },
} as const satisfies Partial<Record<IpcProcedureName, RemoteProcedureRouteSpec>>;

/** Project-aware procedures intentionally dispatched or disabled outside the bridge router. */
export const NON_ROUTER_PROJECT_PROCEDURES = {
  startThread: "explicit-remote-thread-launch",
  cloneRepo: "remote-projects-use-project-command",
  relocateProject: "explicit-remote-project-command",
  extractContext: "remote-control-hidden",
  cancelExtractContext: "remote-control-hidden",
  // Voice signaling and media ownership are limited to the local desktop.
  connectThreadVoice: "remote-control-hidden",
  disconnectThreadVoice: "remote-control-hidden",
  createExperimentWorktrees: "remote-control-hidden",
  removeExperimentWorktrees: "remote-control-hidden",
  captureExperimentSnapshot: "remote-control-hidden",
  judgeExperimentSnapshot: "remote-control-hidden",
  getExperimentCandidateStats: "remote-control-hidden",
  cancelJudgeExperiment: "remote-control-hidden",
  lspStart: "remote-control-disabled",
  lspStop: "remote-control-disabled",
  lspSendMessage: "remote-control-disabled",
  // The task board is device-local: it owns worktrees and a scheduler on this
  // machine, so it is never mirrored to a remote/mobile client.
  getTasks: "device-owned-control",
  getTaskRuns: "device-owned-control",
  // Team orchestration runs in the local supervisor's queue and spawns member
  // threads with project-scoped payloads, so it stays device-local.
  dispatchTeamTask: "device-owned-control",
  // Document templates/filling carry project-scoped payloads but operate on
  // this machine's template store; they are never mirrored remotely.
  fillDocumentTemplate: "device-owned-control",
  resolveDocumentTemplate: "device-owned-control",
  // Code-review overlay state is device-local UI state keyed by project.
  reviewClearIssueStates: "remote-control-hidden",
  reviewClearProject: "remote-control-hidden",
  reviewEnsureMcp: "remote-control-hidden",
  reviewGetIssueStates: "remote-control-hidden",
  reviewGetProjectData: "remote-control-hidden",
  reviewSetIssueState: "remote-control-hidden",
  reviewCreateTask: "remote-control-hidden",
  // Static-analysis data is device-local UI state keyed by project.
  staticAnalysisCreateTask: "remote-control-hidden",
  staticAnalysisGetProjectData: "remote-control-hidden",
  staticAnalysisGetRules: "remote-control-hidden",
  staticAnalysisGetDefaultRules: "remote-control-hidden",
  staticAnalysisSetDefaultRules: "remote-control-hidden",
  staticAnalysisSetProblemStatus: "remote-control-hidden",
  staticAnalysisClearProject: "remote-control-hidden",
  createTask: "remote-projects-excluded",
  updateTask: "remote-projects-excluded",
  deleteTask: "remote-projects-excluded",
  startTask: "remote-projects-excluded",
  stopTask: "remote-projects-excluded",
  setTaskStatus: "remote-projects-excluded",
  reorderTasks: "remote-projects-excluded",
  getTaskDrafts: "device-owned-control",
  createTaskDraft: "remote-projects-excluded",
  updateTaskDraft: "remote-projects-excluded",
  deleteTaskDraft: "remote-projects-excluded",
  reorderTaskDrafts: "remote-projects-excluded",
  dbUpsertProject: "remote-mirrors-not-persisted",
  dbDeleteProject: "remote-mirrors-not-persisted",
  dbUpsertThread: "remote-mirrors-not-persisted",
  dbDeleteThread: "remote-mirrors-not-persisted",
  dbSyncAll: "remote-mirrors-not-persisted",
  dbGetThreadRuntimeItems: "remote-runtime-mirror-local",
  dbGetLatestThreadGoalItem: "remote-runtime-snapshot-provided",
  dbReplaceThreadRuntimeItems: "remote-runtime-mirror-local",
  dbGetThreadCompletedTurns: "remote-runtime-mirror-local",
  dbReplaceThreadCompletedTurns: "remote-runtime-mirror-local",
  dbReplaceThreadRuntimeSnapshot: "remote-runtime-mirror-local",
  dbGetThreadContextUsage: "remote-runtime-mirror-local",
  readTerminalScrollback: "remote-thread-snapshot-provided",
  readTerminalSize: "remote-server-internal",
  readThreadBackgroundTasks: "remote-thread-snapshot-provided",
  dbPersistExperimentState: "remote-experiments-excluded",
  browserStartPicker: "device-owned-browser-control",
  showNotification: "device-owned-notification",
  detectProjectIcon: "remote-mirrors-skip-file-icons",
  listProjectIconFiles: "remote-mirrors-skip-file-icons",
  // Plugin packages are read from the host filesystem the supervisor runs on.
  // A remote project's own `.agentemployee/plugins` therefore stays with its server;
  // the local scan just falls back to the app-global roots.
  listPlugins: "remote-projects-scan-locally",
  refreshPlugins: "remote-projects-scan-locally",
  // The knowledge base is host-local app data (never inside the project), so a
  // remote/mobile client has no filesystem to browse and no store to reach.
  knowledgeListBases: "device-owned-app-data",
  knowledgeCreateBase: "device-owned-app-data",
  knowledgeRenameBase: "device-owned-app-data",
  knowledgeDeleteBase: "device-owned-app-data",
  knowledgeRootLocation: "device-owned-app-data",
  knowledgeListTree: "device-owned-app-data",
  knowledgeReadFile: "device-owned-app-data",
  knowledgeWriteFile: "device-owned-app-data",
  knowledgeImportSources: "device-owned-app-data",
  knowledgeDeleteEntry: "device-owned-app-data",
} as const satisfies Partial<Record<IpcProcedureName, string>>;

export type RemoteRoutableProcedureName = keyof typeof REMOTE_PROCEDURE_ROUTES;

export function isRemoteRoutableProcedure(
  procedure: string,
): procedure is RemoteRoutableProcedureName {
  return Object.hasOwn(REMOTE_PROCEDURE_ROUTES, procedure);
}
