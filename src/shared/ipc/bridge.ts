import type { AgentEmployeeChannel } from "../channel";
import type { RemoteThreadCommand } from "../contracts";
import type { RemoteAccessPairingInfo } from "../remote";
import type { SharedSettings } from "../settings";
import type { GitStatePatch } from "../gitState";
import { createChannel } from "./core";
import {
  ipcProcedureMap,
  type IpcProcedureName,
  type IpcProcedurePayload,
  type IpcProcedureResult,
  type MainLocalProcedureName,
  type SupervisorProcedureName,
} from "./procedureMap";
import type {
  BrowserEvent,
  EmployeeQueueSnapshotEvent,
  FlowDriverSnapshotEvent,
  PrWatchMergedEvent,
  PrWatchStatusEvent,
  ProjectStateChangedEvent,
  SupervisorEvent,
  TaskInboxItemEvent,
  ThreadOpenRequestedEvent,
  UpdateStatus,
} from "./events";
import type { QuickComposerSubmission } from "./schemas";
import type { PetNavigateMainPayload, PetBallMenuAction } from "./procedures/pet";

export const AGENTEMPLOYEE_WINDOW_KINDS = [
  "main",
  "browserExtract",
  "quickComposer",
  "pet",
] as const;
export type AgentEmployeeWindowKind = (typeof AGENTEMPLOYEE_WINDOW_KINDS)[number];

type ProcedureArgs<Name extends IpcProcedureName> =
  (typeof ipcProcedureMap)[Name]["__types"]["args"];

export type AgentEmployeeInvokeBridge = {
  [Name in IpcProcedureName]: (...args: ProcedureArgs<Name>) => Promise<IpcProcedureResult<Name>>;
};

export type AgentEmployeeBridge = AgentEmployeeInvokeBridge & {
  platform: NodeJS.Platform;
  appVersion: string;
  arch: string;
  chromeVersion: string;
  isDev: boolean;
  windowKind: AgentEmployeeWindowKind;
  channel: AgentEmployeeChannel;
  /**
   * Host user home directory (`os.homedir()`). Used to resolve Grok session
   * media paths (`~/.grok/sessions/…`) for chat markdown images. Optional so
   * remote/mobile bridge shims can omit it.
   */
  homeDir?: string;
  electronVersion: string;
  nodeVersion: string;
  posthogEnableDev: boolean;
  posthogEnabled: boolean;
  posthogHost: string;
  posthogKey: string;
  sentryEnabled: boolean;
  getDroppedFilePaths(files: File[]): string[];
  onSupervisorEvent(listener: (event: SupervisorEvent) => void): () => void;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  onBrowserEvent(listener: (event: BrowserEvent) => void): () => void;
  /** Thread-metadata mutations issued by paired remote clients (mobile PWA). */
  onRemoteThreadCommand(listener: (command: RemoteThreadCommand) => void): () => void;
  /** Active remote-access code or paired-device state changed in main. */
  onRemoteAccessPairingChanged(listener: (info: RemoteAccessPairingInfo) => void): () => void;
  /** Shared settings rewritten outside this renderer (e.g. by a remote client). */
  onSharedSettingsChanged(listener: (settings: SharedSettings) => void): () => void;
  onProjectStateChanged(listener: (event: ProjectStateChangedEvent) => void): () => void;
  onGitStateChanged(listener: (patch: GitStatePatch) => void): () => void;
  onPrWatchMerged(listener: (event: PrWatchMergedEvent) => void): () => void;
  /** Live PR state observed by the PR-watch loop, so watched PRs stay fresh. */
  onPrWatchStatus(listener: (event: PrWatchStatusEvent) => void): () => void;
  onThreadOpenRequested(listener: (event: ThreadOpenRequestedEvent) => void): () => void;
  /** Pet window asked main to reveal itself and navigate to a surface. */
  onPetNavigateMainRequested(listener: (event: PetNavigateMainPayload) => void): () => void;
  /** The native ball context menu chose an action in main. */
  onPetBallMenuAction(listener: (event: PetBallMenuAction) => void): () => void;
  /** A file arrived in the user's task-inbox directory; broadcast to all windows. */
  onTaskInboxItem(listener: (event: TaskInboxItemEvent) => void): () => void;
  /** Latest supervisor employee queue snapshot; broadcast to all windows. */
  onEmployeeQueueSnapshot(listener: (event: EmployeeQueueSnapshotEvent) => void): () => void;
  /** Latest supervisor file-system driver snapshot; broadcast to all windows. */
  onFlowDriverSnapshot(listener: (event: FlowDriverSnapshotEvent) => void): () => void;
  submitQuickComposer(submission: QuickComposerSubmission): Promise<void>;
  dismissQuickComposer(): Promise<void>;
  pickQuickComposerFiles(): Promise<string[] | null>;
  notifyQuickComposerMainReady(): Promise<void>;
  reloadRenderer(): Promise<void>;
  onQuickComposerSubmit(listener: (submission: QuickComposerSubmission) => void): () => void;
  onQuickComposerDismissRequested(listener: () => void): () => void;
};

export function createInvokeBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): AgentEmployeeInvokeBridge {
  return createProcedureBridge((name, args) => {
    const procedure = ipcProcedureMap[name];
    return invoke(procedure.channel, ...args);
  });
}

/** Builds every typed procedure method while preserving its canonical name. */
export function createProcedureBridge(
  invoke: (name: IpcProcedureName, args: unknown[]) => Promise<unknown>,
): AgentEmployeeInvokeBridge {
  const bridge = {} as AgentEmployeeInvokeBridge;
  const names = Object.keys(ipcProcedureMap) as IpcProcedureName[];
  for (const name of names) {
    (bridge as Record<IpcProcedureName, unknown>)[name] = (...args: unknown[]) =>
      invoke(name, args);
  }
  return bridge;
}

export function parseIpcProcedureArgs<Name extends IpcProcedureName>(
  name: Name,
  args: unknown[],
): IpcProcedurePayload<Name> {
  const procedure = ipcProcedureMap[name];
  return (procedure.parseArgs as (...args: unknown[]) => IpcProcedurePayload<Name>)(...args);
}

export type MainLocalIpcHandlerMap = {
  [Name in MainLocalProcedureName]: (
    payload: IpcProcedurePayload<Name>,
  ) => Promise<IpcProcedureResult<Name>> | IpcProcedureResult<Name>;
};

export type SupervisorIpcHandlerMap = {
  [Name in SupervisorProcedureName]: (
    payload: IpcProcedurePayload<Name>,
  ) => Promise<IpcProcedureResult<Name>> | IpcProcedureResult<Name>;
};

export function defineMainLocalIpcHandlers<THandlers extends MainLocalIpcHandlerMap>(
  handlers: THandlers,
): THandlers {
  return handlers;
}

export function defineSupervisorIpcHandlers<THandlers extends SupervisorIpcHandlerMap>(
  handlers: THandlers,
): THandlers {
  return handlers;
}

export const IPC_EVENT_CHANNELS = {
  supervisorEvent: createChannel("supervisorEvent"),
  updateStatus: createChannel("updateStatus"),
  browserEvent: createChannel("browserEvent"),
  remoteThreadCommand: createChannel("remoteThreadCommand"),
  remoteAccessPairingChanged: createChannel("remoteAccessPairingChanged"),
  sharedSettingsChanged: createChannel("sharedSettingsChanged"),
  projectStateChanged: createChannel("projectStateChanged"),
  gitStateChanged: createChannel("gitStateChanged"),
  prWatchMerged: createChannel("prWatchMerged"),
  prWatchStatus: createChannel("prWatchStatus"),
  threadOpenRequested: createChannel("threadOpenRequested"),
  petNavigateMainRequested: createChannel("petNavigateMainRequested"),
  petBallMenuAction: createChannel("petBallMenuAction"),
  taskInboxItem: createChannel("taskInboxItem"),
  employeeQueueSnapshot: createChannel("employeeQueueSnapshot"),
  flowDriverSnapshot: createChannel("flowDriverSnapshot"),
  quickComposerSubmit: createChannel("quickComposerSubmit"),
  quickComposerDismissRequested: createChannel("quickComposerDismissRequested"),
} as const;

export const IPC_WINDOW_CHANNELS = {
  quickComposerSubmit: createChannel("quickComposerWindowSubmit"),
  quickComposerDismiss: createChannel("quickComposerWindowDismiss"),
  quickComposerPickFiles: createChannel("quickComposerWindowPickFiles"),
  quickComposerMainReady: createChannel("quickComposerMainReady"),
  rendererReload: createChannel("rendererReload"),
} as const;
