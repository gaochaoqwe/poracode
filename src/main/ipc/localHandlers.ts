import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  app,
  clipboard,
  ClipboardItem,
  dialog,
  Menu,
  nativeImage,
  shell,
  type BrowserWindow,
} from "electron";
import type { BrowserPanelManager } from "../browser";
import { openMicrophoneSettings } from "../browser/permissions";
import {
  dbAppendUsageEvents,
  dbDeleteProject,
  dbDeleteThread,
  dbGetProjectNotes,
  dbGetProjects,
  dbGetState,
  dbGetThreadCompletedTurns,
  dbGetThreadContextUsage,
  dbGetThreadRuntimeItems,
  dbGetThreadRuntimeItemsPage,
  dbGetLatestThreadGoalItem,
  dbTruncateThreadRuntimeAfter,
  dbGetThreads,
  dbPersistExperimentState,
  dbListTaskRuns,
  dbReplaceThreadCompletedTurns,
  dbReplaceThreadRuntimeSnapshot,
  dbReplaceThreadRuntimeItems,
  dbSetProjectNotes,
  dbSetState,
  dbSyncAll,
  dbUpsertProject,
  dbUpsertThread,
} from "../db";
import { dbInsertTeamRun, dbUpdateTeamRunStatus } from "../db/teamStore";
import {
  deleteThreadAttachments,
  deleteThreadAttachmentsAsync,
  readLocalImageFile,
  resolveProjectFsPath,
  saveClipboardImageFile,
  saveHandoffContextFile,
  writeImageFile,
} from "../attachments/localFiles";
import { createProjectDirectory } from "../projectDirectory";
import { detectProjectIconFile, listProjectIconFiles } from "../projectIconDetect";
import { diffSyncedThreads, syncedProjectsChanged } from "./threadSyncBroadcast";
import { showOsNotification } from "../osNotifications";
import { showAndFocusWindow } from "../window/showAndFocusWindow";
import {
  movePetBallBy,
  rememberPetBallPosition,
  setPetWindowCollapsed,
} from "../window/createPetWindow";
import {
  getProfileCoreStats,
  getProfileDevicesResponse,
  getProfileIdentityResponse,
  getProfileTokenStats,
  setProfileIdentityResponse,
} from "../profile";
import {
  applyAgentSecretSetting,
  applyCreateProfile,
  applyProfileEnvironment,
  mergeManagedSharedSettings,
  readSharedSettingsFile,
  writeSharedSettingsFile,
} from "../sharedSettingsFile";
import {
  remoteProjectSchema,
  type RemoteAccessPairingInfo,
  type RemoteGitSummaries,
} from "@/shared/remote";
import { readKeybindingsFile, writeKeybindingsFile } from "../keybindingsFile";
import type { KeybindingsFile } from "@/shared/keybindings";
import type { RemoteAccessServer } from "../remote";
import { getRemoteAccessPairingInfo } from "../remote/pairingInfo";
import type { AutoUpdaterController } from "../updates/autoUpdater";
import {
  defineMainLocalIpcHandlers,
  IPC_EVENT_CHANNELS,
  type MainLocalIpcHandlerMap,
  type RemoteAccessTailscaleStatus,
  type StartTailscaleResult,
  type WindowChromePayload,
  type WindowChromeResult,
} from "@/shared/ipc";
import { supportsNativeWindowMaterial, syncNativeThemeForMaterial } from "../window/windowMaterial";
import type { SharedSettings } from "@/shared/settings";
import {
  removeCrossagentRoutingOverride,
  removeCrossagentSelectionUsageEntry,
  retagCrossagentSelectionUsageEntry,
} from "@/shared/crossagentRanking";
import { headersToRecord, readBoundedResponseBody } from "@/shared/http";
import type { AgentEmployeePaths } from "@/shared/agentemployeePaths";
import { SUPPORTED_UPLOAD_EXTENSIONS } from "@/shared/promptContent";
import { UsageLoginManager } from "../usageLogin/UsageLoginManager";
import type { SshConnectionManager } from "../ssh/SshConnectionManager";
import type { TasksService } from "../tasks";
import type { TaskDraftsService } from "../drafts";
import type { PrWatchService } from "../prWatch";
import { homeScopeLocation } from "../tasks";
import { resolveAgentEmployeeChannel } from "@/shared/channel";
import {
  requestLegacyDataMigration,
  resolveLegacyElectronUserDataDir,
} from "../legacyDataMigration";
import { installClineFromOfflinePackage } from "@/supervisor/agents/cline/install";
import { installGdsAgentFromOfflinePackage } from "@/supervisor/agents/gds-agent/install";
import { createKnowledgeIpcHandlers } from "../knowledge/knowledgeIpcHandlers";
import {
  reviewClearIssueStates,
  reviewClearProject,
  reviewGetIssueStates,
  reviewSetIssueState,
  ensureCodeReviewMcp,
} from "../codeReview/reviewStateDb";
import {
  clearProjectReviewRows,
  createReviewTask,
  ingestProjectReviews,
} from "../codeReview/reviewIngest";
import {
  clearProjectStaticAnalysis,
  createStaticAnalysisTask,
  getStaticAnalysisDefaultRules,
  getStaticAnalysisRules,
  ingestStaticAnalysis,
  setStaticAnalysisDefaultRules,
  setStaticAnalysisProblemStatus,
} from "../staticAnalysis/staticAnalysisIngest";

interface CreateLocalIpcHandlersOptions {
  getMainWindow(): BrowserWindow | null;
  /** The resident chief-steward pet window; absent in non-app test harnesses. */
  getPetWindow?(): BrowserWindow | null;
  getBrowserPanelManager(): BrowserPanelManager | null;
  getRemoteAccessServer(): RemoteAccessServer | null;
  setRemoteAccessEnabled(enabled: boolean): Promise<RemoteAccessPairingInfo>;
  getRemoteAccessTailscaleStatus(): Promise<RemoteAccessTailscaleStatus>;
  setRemoteAccessTailscaleHttps(enabled: boolean): Promise<RemoteAccessPairingInfo>;
  startTailscale(): Promise<StartTailscaleResult>;
  setRemoteAccessAdvertisedUrl(url: string): Promise<RemoteAccessPairingInfo>;
  sshConnectionManager: SshConnectionManager;
  requireAgentEmployeePaths(): AgentEmployeePaths;
  legacyElectronUserDataDir?: string;
  legacyBaseDir?: string;
  updatePowerSaveBlocker(): void;
  autoUpdater: AutoUpdaterController;
  /** Called with the settings just written, so consumers don't re-read the file. */
  onSharedSettingsChanged?(settings: SharedSettings): void;
  onKeybindingsChanged?(file: KeybindingsFile): void;
  setGlobalShortcutsSuspended?(suspended: boolean): void;
  /** Per-thread git/PR summaries mirrored from the renderer for remote clients. */
  onRemoteGitSummaries?(summaries: RemoteGitSummaries): void;
  extractBrowserToWindow(): void;
  injectBrowserToMain(): void;
  /** Relaunch the app (exposed via the relaunchApp IPC). */
  requestRelaunch(): void;
  tasksService: TasksService;
  taskDraftsService: TaskDraftsService;
  prWatchService: PrWatchService;
}

function requireBrowserPanel(getter: () => BrowserPanelManager | null): BrowserPanelManager {
  const mgr = getter();
  if (!mgr) {
    throw new Error("Browser panel manager is not initialized.");
  }
  return mgr;
}

let usageLoginManager: UsageLoginManager | null = null;
function getUsageLoginManager(
  requirePaths: () => AgentEmployeePaths,
  getBrowserPanel: () => BrowserPanelManager | null,
): UsageLoginManager {
  usageLoginManager ??= new UsageLoginManager(requirePaths(), getBrowserPanel);
  return usageLoginManager;
}

function roundRect(rect: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const REMOTE_HTTP_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
const REMOTE_HTTP_REQUEST_TIMEOUT_MS = 60_000;

function assertSafeExternalUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid external URL");
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`External URL protocol is not allowed: ${parsed.protocol}`);
  }
  return parsed.toString();
}

/** The composer "attach files" picker, shared by the main window and the quick composer. */
export async function showAddFilesDialog(
  parent: BrowserWindow,
  payload?: { title?: string; filters?: Electron.FileFilter[]; defaultPath?: string },
): Promise<string[] | null> {
  const result = await dialog.showOpenDialog(parent, {
    properties: ["openFile", "multiSelections"],
    title: payload?.title ?? "Add files or photos",
    filters: payload?.filters ?? [
      { name: "Supported files", extensions: [...SUPPORTED_UPLOAD_EXTENSIONS] },
    ],
    ...(payload?.defaultPath ? { defaultPath: payload.defaultPath } : {}),
  });
  return result.canceled ? null : result.filePaths;
}

export function createLocalIpcHandlers(
  options: CreateLocalIpcHandlersOptions,
): MainLocalIpcHandlerMap {
  const publishProjectsChanged = (projects = dbGetProjects()): void => {
    const server = options.getRemoteAccessServer();
    if (!server) return;
    server.publishSupervisorEvent({
      type: "remote-projects-changed",
      projects: projects.map((project) => remoteProjectSchema.parse(project)),
    });
  };
  const publishThreadsChanged = (
    threadIds: readonly string[],
    viewedThreadIds: readonly string[] = [],
  ): void => {
    if (threadIds.length === 0) return;
    options.getRemoteAccessServer()?.publishSupervisorEvent({
      type: "remote-threads-changed",
      threadIds: [...new Set(threadIds)],
      ...(viewedThreadIds.length > 0 ? { viewedThreadIds: [...new Set(viewedThreadIds)] } : {}),
    });
  };
  // Shared plumbing for the main-local secret/profile handlers: read the
  // settings file, apply one encrypting transform, persist, and notify.
  const applyToSharedSettingsFile = <T>(
    apply: (settings: SharedSettings, baseDir: string) => { settings: SharedSettings; result: T },
  ): T => {
    const settingsPath = options.requireAgentEmployeePaths().settingsPath;
    const applied = apply(readSharedSettingsFile(settingsPath), dirname(settingsPath));
    writeSharedSettingsFile(settingsPath, applied.settings);
    options.onSharedSettingsChanged?.(applied.settings);
    return applied.result;
  };
  return defineMainLocalIpcHandlers({
    ...createKnowledgeIpcHandlers({ requireAgentEmployeePaths: options.requireAgentEmployeePaths }),
    pickFolder: async (defaultPath) => {
      const result = await dialog.showOpenDialog(options.getMainWindow()!, {
        properties: ["openDirectory"],
        title: "Add Project",
        ...(defaultPath ? { defaultPath } : {}),
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    pickFiles: (payload) =>
      showAddFilesDialog(options.getMainWindow()!, {
        ...(payload?.title ? { title: payload.title } : {}),
        ...(payload?.filters ? { filters: payload.filters } : {}),
        ...(payload?.defaultPath ? { defaultPath: payload.defaultPath } : {}),
      }),
    detectProjectIcon: ({ projectLocation }) => detectProjectIconFile(projectLocation),
    listProjectIconFiles: ({ projectLocation }) => listProjectIconFiles(projectLocation),
    saveClipboardImage: (payload) =>
      saveClipboardImageFile(options.requireAgentEmployeePaths(), payload),
    saveHandoffContext: (payload) =>
      saveHandoffContextFile(options.requireAgentEmployeePaths(), payload),
    saveImageFile: async ({ data, suggestedName }) => {
      const win = options.getMainWindow();
      const result = await dialog.showSaveDialog(win!, {
        title: "Save image",
        defaultPath: suggestedName,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] },
        ],
      });
      if (result.canceled || !result.filePath) return null;
      writeImageFile(result.filePath, data);
      return result.filePath;
    },
    copyImageToClipboard: async ({ data }) => {
      // `nativeImage.createFromBuffer` only decodes PNG/JPEG; the renderer
      // converts other formats to PNG first. Report whether anything landed on
      // the clipboard so the UI doesn't claim success on an empty image.
      const image = nativeImage.createFromBuffer(Buffer.from(data));
      if (image.isEmpty()) return false;
      await clipboard.write([
        new ClipboardItem({ "image/png": new Blob([Uint8Array.from(image.toPNG())]) }),
      ]);
      return true;
    },
    readLocalImageFile: ({ url }) => readLocalImageFile(url),
    createProjectDirectory: (payload) => createProjectDirectory(payload),
    // Desktop-as-client: proxy a remote AgentEmployee server request through the
    // main process (no browser CORS). Restricted to http(s) and a bounded
    // response so a hostile/buggy peer can't exfiltrate via odd schemes or
    // exhaust memory. (The remote is one the user explicitly paired with.)
    remoteHttpRequest: async (payload) => {
      const protocol = new URL(payload.url).protocol;
      if (protocol !== "http:" && protocol !== "https:") {
        throw new Error(`remoteHttpRequest only supports http(s), got "${protocol}".`);
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REMOTE_HTTP_REQUEST_TIMEOUT_MS);
      timeout.unref?.();

      try {
        const response = await fetch(payload.url, {
          method: payload.method ?? "GET",
          signal: controller.signal,
          ...(payload.headers ? { headers: payload.headers } : {}),
          ...(payload.body !== undefined
            ? { body: payload.body }
            : payload.bodyBase64 !== undefined
              ? { body: Buffer.from(payload.bodyBase64, "base64") }
              : {}),
        });
        const buffer = await readBoundedResponseBody(response, REMOTE_HTTP_RESPONSE_MAX_BYTES);
        return {
          status: response.status,
          headers: headersToRecord(response.headers),
          body: Buffer.from(buffer).toString(payload.responseEncoding ?? "utf8"),
        };
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error(`Remote request timed out after ${REMOTE_HTTP_REQUEST_TIMEOUT_MS}ms.`, {
            cause: error,
          });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    openExternal: async (url) => {
      const safeUrl = assertSafeExternalUrl(url);
      const browserPanel = options.getBrowserPanelManager();
      if (browserPanel && (await browserPanel.openLink(safeUrl))) {
        return;
      }
      await shell.openExternal(safeUrl);
    },
    openExternalNative: async (url) => {
      await shell.openExternal(assertSafeExternalUrl(url));
    },
    openMicrophoneSettings: () => openMicrophoneSettings(),
    focusWindow: () => {
      const win = options.getMainWindow();
      if (!win || win.isDestroyed()) return;
      showAndFocusWindow(win);
    },
    petNavigateMain: (payload) => {
      // The pet asked to jump the user to a main-window surface. Reveal the
      // main window and forward the target; the main renderer owns the actual
      // navigation. Payload shape is already zod-validated by the procedure layer.
      const win = options.getMainWindow();
      if (!win || win.isDestroyed()) return;
      showAndFocusWindow(win);
      win.webContents.send(IPC_EVENT_CHANNELS.petNavigateMainRequested, payload);
    },
    petSetCollapsed: (payload) => {
      // The pet renderer owns the collapsed mode; main only resizes the
      // frameless window so the ball never leaves an invisible click-through
      // rectangle.
      const win = options.getPetWindow?.();
      if (!win || win.isDestroyed()) return;
      if (!payload.collapsed) {
        // Remember where the user parked the ball before the panel takes over,
        // so collapsing again returns to the same spot.
        const parked = win.getBounds();
        rememberPetBallPosition(parked.x, parked.y);
      }
      setPetWindowCollapsed(win, payload.collapsed);
    },
    petMoveBall: (payload) => {
      // The ball drag runs in the renderer (a CSS drag region would eat the
      // click that restores the panel), so it reports the pointer delta and
      // main moves the frameless window.
      const win = options.getPetWindow?.();
      if (!win || win.isDestroyed()) return;
      movePetBallBy(win, payload.dx, payload.dy);
    },
    petSaveBallPosition: (payload) => {
      // The OS drags the frameless window itself and main records the drop via
      // the window's `moved` event; this is the explicit path for callers that
      // want to report a position without a real drag.
      rememberPetBallPosition(payload.x, payload.y);
    },
    petHideBall: () => {
      // Hiding the ball leaves no visible surface in the pet window; the tray
      // menu item is the restore path.
      const win = options.getPetWindow?.();
      if (!win || win.isDestroyed()) return;
      win.hide();
    },
    petShowBallMenu: (payload) => {
      // The collapsed ball window is too small for a DOM menu, so main pops a
      // native menu with renderer-localized labels and echoes the choice back.
      const win = options.getPetWindow?.();
      if (!win || win.isDestroyed()) return;
      const menu = Menu.buildFromTemplate([
        {
          label: payload.expandLabel,
          click: () => {
            setPetWindowCollapsed(win, false);
            if (!win.isDestroyed()) {
              win.webContents.send(IPC_EVENT_CHANNELS.petBallMenuAction, { action: "expand" });
            }
          },
        },
        {
          label: payload.hideLabel,
          click: () => {
            if (!win.isDestroyed()) win.hide();
          },
        },
      ]);
      menu.popup({ window: win });
    },
    showNotification: (payload) => showOsNotification(payload, options.getMainWindow),
    requestLegacyDataMigration: () => {
      const baseDir = options.requireAgentEmployeePaths().baseDir;
      const channel = resolveAgentEmployeeChannel();
      const electronUserDataDir = app.getPath("userData");
      return requestLegacyDataMigration({
        baseDir,
        channel,
        electronUserDataDir,
        legacyElectronUserDataDir:
          options.legacyElectronUserDataDir ??
          resolveLegacyElectronUserDataDir(electronUserDataDir, channel),
        ...(options.legacyBaseDir ? { legacyBaseDir: options.legacyBaseDir } : {}),
        allowCustomDataRoot: app.isPackaged,
      });
    },
    relaunchApp: () => {
      options.requestRelaunch();
    },
    getHomeScopeLocation: () => homeScopeLocation(),
    getKeybindings: () => readKeybindingsFile(options.requireAgentEmployeePaths().keybindingsPath),
    setKeybindings: (file) => {
      const path = options.requireAgentEmployeePaths().keybindingsPath;
      options.setGlobalShortcutsSuspended?.(false);
      options.onKeybindingsChanged?.(file);
      try {
        return writeKeybindingsFile(path, file);
      } catch (error) {
        try {
          // The write is atomic, so on failure the file still holds the
          // previous bindings — re-apply them to roll the shortcuts back.
          options.onKeybindingsChanged?.(readKeybindingsFile(path).file);
        } catch (restoreError) {
          console.error("[agentemployee] failed to restore global shortcuts:", restoreError);
        }
        throw error;
      }
    },
    setGlobalShortcutsSuspended: (payload) =>
      options.setGlobalShortcutsSuspended?.(payload.suspended),
    getRemoteAccessPairing: () => getRemoteAccessPairingInfo(options.getRemoteAccessServer()),
    refreshRemoteAccessPairing: () => {
      const server = options.getRemoteAccessServer();
      server?.issuePairingUrl("Settings QR");
      return getRemoteAccessPairingInfo(server);
    },
    setRemoteAccessEnabled: (payload) => options.setRemoteAccessEnabled(payload.enabled),
    sshDiscoverHosts: () => options.sshConnectionManager.discoverHosts(),
    sshConnect: (payload) => options.sshConnectionManager.connect(payload),
    sshDisconnect: ({ connectionId }) => options.sshConnectionManager.disconnect(connectionId),
    getRemoteAccessTailscaleStatus: () => options.getRemoteAccessTailscaleStatus(),
    setRemoteAccessTailscaleHttps: (payload) =>
      options.setRemoteAccessTailscaleHttps(payload.enabled),
    startTailscale: () => options.startTailscale(),
    setRemoteAccessAdvertisedUrl: (payload) => options.setRemoteAccessAdvertisedUrl(payload.url),
    revokeRemoteAccessSession: (payload) => {
      const server = options.getRemoteAccessServer();
      if (!server) {
        return { revoked: false };
      }
      return { revoked: server.revokeAccessSession(payload.sessionId) };
    },
    revealProjectEntry: async (payload) => {
      shell.showItemInFolder(resolveProjectFsPath(payload));
    },
    openPluginsFolder: async () => {
      // Created on demand so the folder is always there to drop a package into,
      // even on a fresh install that has never loaded a user plugin.
      const pluginsDir = options.requireAgentEmployeePaths().pluginsDir;
      await mkdir(pluginsDir, { recursive: true });
      await shell.openPath(pluginsDir);
    },
    publishRemoteGitSummaries: (payload) => {
      options.onRemoteGitSummaries?.(payload.summaries);
    },
    getSharedSettings: () =>
      readSharedSettingsFile(options.requireAgentEmployeePaths().settingsPath),
    setSharedSettings: (settings) => {
      const settingsPath = options.requireAgentEmployeePaths().settingsPath;
      // Preserve supervisor-managed fields and encrypted provider-profile
      // environments so the renderer's persist cycle doesn't clobber writes
      // made out-of-band by the supervisor. (Shared with the app-controls MCP
      // `update_settings` tool via `mergeManagedSharedSettings`.)
      const merged = mergeManagedSharedSettings(readSharedSettingsFile(settingsPath), settings);
      writeSharedSettingsFile(settingsPath, merged);
      options.updatePowerSaveBlocker();
      options.onSharedSettingsChanged?.(merged);
    },
    setAgentSecretSetting: (payload) =>
      applyToSharedSettingsFile((settings, baseDir) => {
        const { settings: next, storedValue } = applyAgentSecretSetting(settings, payload, baseDir);
        return { settings: next, result: { storedValue } };
      }),
    removeCrossagentRoutingOverride: ({ tags }) => {
      const settingsPath = options.requireAgentEmployeePaths().settingsPath;
      const current = readSharedSettingsFile(settingsPath);
      const overrides = removeCrossagentRoutingOverride(current.crossagentRoutingOverrides, tags);
      const settings = { ...current, crossagentRoutingOverrides: overrides };
      writeSharedSettingsFile(settingsPath, settings);
      options.onSharedSettingsChanged?.(settings);
      return overrides;
    },
    removeCrossagentMemoryEntry: ({ entry }) => {
      const settingsPath = options.requireAgentEmployeePaths().settingsPath;
      const current = readSharedSettingsFile(settingsPath);
      const usage = removeCrossagentSelectionUsageEntry(current.crossagentSelectionUsage, entry);
      const settings = { ...current, crossagentSelectionUsage: usage };
      writeSharedSettingsFile(settingsPath, settings);
      options.onSharedSettingsChanged?.(settings);
      return usage;
    },
    updateCrossagentMemoryEntryTags: ({ entry, tags }) => {
      const settingsPath = options.requireAgentEmployeePaths().settingsPath;
      const current = readSharedSettingsFile(settingsPath);
      const usage = retagCrossagentSelectionUsageEntry(
        current.crossagentSelectionUsage,
        entry,
        tags,
      );
      const settings = { ...current, crossagentSelectionUsage: usage };
      writeSharedSettingsFile(settingsPath, settings);
      options.onSharedSettingsChanged?.(settings);
      return usage;
    },
    assignTeamMember: (payload) =>
      applyToSharedSettingsFile((settings) => {
        const team = settings.teams.find((candidate) => candidate.id === payload.teamId);
        if (!team) {
          throw new Error(`Team not found: ${payload.teamId}`);
        }
        if (!settings.workspaces.some((workspace) => workspace.id === payload.employeeId)) {
          throw new Error(`Workspace not found: ${payload.employeeId}`);
        }
        const alreadyMember = team.memberEmployeeIds.includes(payload.employeeId);
        const teams = alreadyMember
          ? settings.teams
          : settings.teams.map((candidate) =>
              candidate.id === payload.teamId
                ? {
                    ...candidate,
                    memberEmployeeIds: [...candidate.memberEmployeeIds, payload.employeeId],
                  }
                : candidate,
            );
        const updated = teams.find((candidate) => candidate.id === payload.teamId) ?? team;
        return { settings: { ...settings, teams }, result: updated };
      }),
    recordTeamRun: (payload) => {
      dbInsertTeamRun({
        id: payload.taskId,
        teamId: payload.teamId,
        prompt: payload.prompt,
        policy: payload.policy,
        targetWorkspaceIds: payload.targetWorkspaceIds,
        status: payload.status,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      });
    },
    updateTeamRunStatus: (payload) => {
      dbUpdateTeamRunStatus(payload.runId, payload.status, payload.finishedAt ?? null);
    },
    setProfileEnvironment: (payload) =>
      applyToSharedSettingsFile((settings, baseDir) => {
        const { settings: next, instance } = applyProfileEnvironment(settings, payload, baseDir);
        return { settings: next, result: instance };
      }),
    createProfile: (payload) =>
      applyToSharedSettingsFile((settings, baseDir) => {
        const { settings: next, instance } = applyCreateProfile(settings, payload, baseDir);
        return { settings: next, result: instance };
      }),
    setWindowChrome: async (payload: WindowChromePayload): Promise<WindowChromeResult> => {
      const nativeCapable = supportsNativeWindowMaterial();
      const mainWindow = options.getMainWindow();
      if (!mainWindow) {
        return { nativeCapable };
      }
      if (process.platform === "win32" || process.platform === "linux") {
        mainWindow.setTitleBarOverlay({
          color: payload.backgroundColor,
          symbolColor: payload.symbolColor,
          height: 32,
        });
      }
      // Toggle the native translucency material live. macOS vibrancy is created
      // with the window and revealed/hidden purely via CSS, so there is nothing
      // to switch here. Windows acrylic is toggled at runtime (no relaunch).
      const wantsMaterial = payload.materialEnabled === true && nativeCapable;
      if (process.platform === "win32") {
        mainWindow.setBackgroundMaterial(wantsMaterial ? "acrylic" : "none");
        mainWindow.setBackgroundColor(
          wantsMaterial ? "#00000000" : payload.appearance === "dark" ? "#070709" : "#f1f1f4",
        );
      }
      if (wantsMaterial && payload.appearance) {
        syncNativeThemeForMaterial(payload.appearance);
      }
      return { nativeCapable };
    },
    dbGetProjects: () => dbGetProjects(),
    dbGetThreads: () => dbGetThreads(),
    dbGetState: (key) => dbGetState(key),
    dbSetState: ({ key, value }) => dbSetState(key, value),
    dbUpsertProject: (project) => {
      dbUpsertProject(project, 0);
      publishProjectsChanged();
    },
    dbUpsertThread: (thread) => {
      dbUpsertThread(thread, 0);
      publishThreadsChanged([thread.id]);
    },
    dbDeleteThread: ({ threadId }) => {
      dbDeleteThread(threadId);
      deleteThreadAttachments(options.requireAgentEmployeePaths(), threadId);
      publishThreadsChanged([threadId]);
    },
    dbDeleteProject: ({ projectId }) => {
      const threadIds = dbGetThreads()
        .filter((thread) => thread.projectId === projectId)
        .map((thread) => thread.id);
      dbDeleteProject(projectId);
      publishProjectsChanged();
      publishThreadsChanged(threadIds);
    },
    dbSyncAll: ({ projects, threads, viewJson }) => {
      // Desktop-originated project and thread changes reach SQLite only through
      // this persist. Diff before writing, then publish the same events remote
      // commands send; the remote's debounced refresh reads the post-write state.
      const projectsChanged = syncedProjectsChanged(dbGetProjects(), projects);
      const { changedThreadIds, viewedThreadIds } = diffSyncedThreads(dbGetThreads(), threads);
      const repaired = dbSyncAll(projects, threads, viewJson);
      if (repaired) {
        // Reconcile the originating desktop too. Include unseen recovered
        // threads so its next full-store write cannot delete their transcripts.
        options.getMainWindow()?.webContents.send(IPC_EVENT_CHANNELS.projectStateChanged, {
          projects: dbGetProjects(),
          recoveredThreads: dbGetThreads(),
        });
      }
      if (projectsChanged) publishProjectsChanged();
      publishThreadsChanged(changedThreadIds, viewedThreadIds);
    },
    dbPersistExperimentState: async (payload) => {
      dbPersistExperimentState(payload);
      publishThreadsChanged([
        ...payload.upsertThreads.map(({ thread }) => thread.id),
        ...payload.deletedThreadIds,
      ]);
      const paths = options.requireAgentEmployeePaths();
      await Promise.all(
        payload.deletedThreadIds.map((threadId) => deleteThreadAttachmentsAsync(paths, threadId)),
      );
    },
    dbGetThreadRuntimeItems: ({ threadId }) => dbGetThreadRuntimeItems(threadId),
    dbGetThreadRuntimeItemsPage: ({ threadId, beforePosition, limit, targetTimelineEntryCount }) =>
      dbGetThreadRuntimeItemsPage(threadId, beforePosition, limit, targetTimelineEntryCount),
    dbGetLatestThreadGoalItem: ({ threadId }) => dbGetLatestThreadGoalItem(threadId),
    dbTruncateThreadRuntimeAfter: ({ threadId, itemId }) =>
      dbTruncateThreadRuntimeAfter(threadId, itemId),
    dbReplaceThreadRuntimeItems: ({ threadId, items }) =>
      dbReplaceThreadRuntimeItems(threadId, items),
    dbGetThreadCompletedTurns: ({ threadId }) => dbGetThreadCompletedTurns(threadId),
    dbReplaceThreadCompletedTurns: ({ threadId, turns }) =>
      dbReplaceThreadCompletedTurns(threadId, turns),
    dbReplaceThreadRuntimeSnapshot: ({ threadId, items, turns, contextUsage }) =>
      dbReplaceThreadRuntimeSnapshot(threadId, items, turns, contextUsage),
    dbGetThreadContextUsage: ({ threadId }) => dbGetThreadContextUsage(threadId),
    dbGetProjectNotes: ({ projectId }) => dbGetProjectNotes(projectId),
    dbSetProjectNotes: (notes) => dbSetProjectNotes(notes),
    getTasks: () => options.tasksService.list(),
    createTask: (task) => options.tasksService.create(task),
    updateTask: ({ id, task }) => options.tasksService.update(id, task),
    deleteTask: ({ id }) => options.tasksService.delete(id),
    startTask: ({ id }) => options.tasksService.runNow(id),
    stopTask: ({ id }) => options.tasksService.stop(id),
    setTaskStatus: ({ id, status }) => options.tasksService.setStatus(id, status),
    getTaskRuns: ({ id }) => dbListTaskRuns(id),
    reorderTasks: ({ projectId, orderedIds }) =>
      options.tasksService.reorder(projectId, orderedIds),
    getTaskDrafts: () => options.taskDraftsService.list(),
    createTaskDraft: (draft) => options.taskDraftsService.create(draft),
    updateTaskDraft: ({ id, draft }) => options.taskDraftsService.update(id, draft),
    deleteTaskDraft: ({ id }) => options.taskDraftsService.delete(id),
    reorderTaskDrafts: ({ projectId, orderedIds }) =>
      options.taskDraftsService.reorder(projectId, orderedIds),
    getPrWatch: ({ projectId, prNumber }) => options.prWatchService.get(projectId, prNumber),
    checkPrWatch: ({ projectId, prNumber }) =>
      options.prWatchService.requestCheck(projectId, prNumber),
    upsertPrWatch: (watch) => options.prWatchService.upsert(watch),
    deletePrWatch: ({ projectId, prNumber }) => options.prWatchService.delete(projectId, prNumber),
    syncPrWatchAgent: (agent) => options.prWatchService.syncAgent(agent),
    getUpdateStatus: () => options.autoUpdater.getStatus(),
    checkForUpdate: () => options.autoUpdater.checkForUpdate(),
    startUpdateDownload: () => options.autoUpdater.startUpdateDownload(),
    installUpdate: () => options.autoUpdater.installUpdate(),
    browserGetState: () => requireBrowserPanel(options.getBrowserPanelManager).snapshot(),
    browserCreateTab: (payload) =>
      requireBrowserPanel(options.getBrowserPanelManager).createTab({
        ...(payload.url !== undefined ? { url: payload.url } : {}),
        ...(payload.activate !== undefined ? { activate: payload.activate } : {}),
        ...(payload.reveal !== undefined ? { reveal: payload.reveal } : {}),
      }),
    browserCloseTab: ({ tabId }) =>
      requireBrowserPanel(options.getBrowserPanelManager).closeTab(tabId),
    browserActivateTab: ({ tabId }) => {
      requireBrowserPanel(options.getBrowserPanelManager).setActiveTab(tabId);
    },
    browserMoveTab: ({ tabId, targetTabId, position }) => {
      requireBrowserPanel(options.getBrowserPanelManager).moveTab(tabId, targetTabId, position);
    },
    browserSetGroupCollapsed: ({ groupId, collapsed }) => {
      requireBrowserPanel(options.getBrowserPanelManager).setGroupCollapsed(groupId, collapsed);
    },
    browserUngroupGroup: ({ groupId }) => {
      requireBrowserPanel(options.getBrowserPanelManager).ungroupGroup(groupId);
    },
    browserCloseGroup: ({ groupId }) =>
      requireBrowserPanel(options.getBrowserPanelManager).closeGroup(groupId),
    browserNewTabInGroup: async ({ groupId }) => {
      await requireBrowserPanel(options.getBrowserPanelManager).newTabInGroup(groupId);
    },
    browserRenameGroup: ({ groupId, title }) => {
      requireBrowserPanel(options.getBrowserPanelManager).renameGroup(groupId, title);
    },
    browserSetGroupColor: ({ groupId, color }) => {
      requireBrowserPanel(options.getBrowserPanelManager).setGroupColor(groupId, color);
    },
    browserNavigate: ({ tabId, url }) =>
      requireBrowserPanel(options.getBrowserPanelManager).navigate(tabId, url),
    browserBack: ({ tabId }) => requireBrowserPanel(options.getBrowserPanelManager).back(tabId),
    browserForward: ({ tabId }) =>
      requireBrowserPanel(options.getBrowserPanelManager).forward(tabId),
    browserReload: ({ tabId }) => requireBrowserPanel(options.getBrowserPanelManager).reload(tabId),
    browserHardReload: ({ tabId }) =>
      requireBrowserPanel(options.getBrowserPanelManager).hardReload(tabId),
    browserToggleDevTools: ({ tabId }) =>
      requireBrowserPanel(options.getBrowserPanelManager).toggleDevTools(tabId),
    browserClearHistory: ({ tabId }) =>
      requireBrowserPanel(options.getBrowserPanelManager).clearHistory(tabId),
    browserClearCookies: ({ tabId }) =>
      requireBrowserPanel(options.getBrowserPanelManager).clearCookies(tabId),
    browserClearCache: ({ tabId }) =>
      requireBrowserPanel(options.getBrowserPanelManager).clearCache(tabId),
    browserCopyScreenshot: async ({ tabId }) => {
      const bytes = await requireBrowserPanel(options.getBrowserPanelManager).capturePng(tabId);
      if (bytes) {
        await clipboard.write([
          new ClipboardItem({ "image/png": new Blob([Uint8Array.from(bytes)]) }),
        ]);
      }
    },
    browserCapturePreview: async ({ tabId }) => {
      const bytes = await requireBrowserPanel(options.getBrowserPanelManager).capturePng(tabId);
      if (!bytes) return { dataUrl: null };
      return { dataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
    },
    browserAttachWebContents: ({ tabId, webContentsId }) => {
      requireBrowserPanel(options.getBrowserPanelManager).attachWebContents(tabId, webContentsId);
    },
    browserStartPicker: (payload) =>
      requireBrowserPanel(options.getBrowserPanelManager).startPicker(payload),
    browserCancelPicker: () => {
      requireBrowserPanel(options.getBrowserPanelManager).cancelPicker();
    },
    browserSuggest: ({ query }) =>
      requireBrowserPanel(options.getBrowserPanelManager).suggest(query),
    browserAddBookmark: ({ url, title, faviconUrl }) => {
      requireBrowserPanel(options.getBrowserPanelManager).addBookmark({
        url,
        title,
        createdAt: Date.now(),
        ...(faviconUrl ? { faviconUrl } : {}),
      });
    },
    browserRemoveBookmark: ({ url }) => {
      requireBrowserPanel(options.getBrowserPanelManager).removeBookmark(url);
    },
    browserSetBookmarkBarVisible: ({ visible }) => {
      requireBrowserPanel(options.getBrowserPanelManager).setBookmarkBarVisible(visible);
    },
    browserRecentHistory: ({ limit }) =>
      requireBrowserPanel(options.getBrowserPanelManager).recentHistory(limit),
    browserExtractToWindow: () => {
      options.extractBrowserToWindow();
    },
    browserInjectToMain: () => {
      options.injectBrowserToMain();
    },
    startUsageLogin: (payload) =>
      getUsageLoginManager(
        options.requireAgentEmployeePaths,
        options.getBrowserPanelManager,
      ).startLogin(payload.providerId),
    cancelUsageLogin: (payload) => {
      getUsageLoginManager(
        options.requireAgentEmployeePaths,
        options.getBrowserPanelManager,
      ).cancelLogin(payload.providerId);
    },
    clearUsageLogin: (payload) =>
      getUsageLoginManager(
        options.requireAgentEmployeePaths,
        options.getBrowserPanelManager,
      ).clearLogin(payload.providerId),
    submitUsageApiKey: (payload) =>
      getUsageLoginManager(
        options.requireAgentEmployeePaths,
        options.getBrowserPanelManager,
      ).submitApiKey(payload.providerId, payload.apiKey),
    resolveUsageLoginConfirmation: (payload) => {
      requireBrowserPanel(options.getBrowserPanelManager).resolveUsageLoginConfirmation(payload);
    },
    getUsageLoginState: () =>
      getUsageLoginManager(
        options.requireAgentEmployeePaths,
        options.getBrowserPanelManager,
      ).getLoginState(),
    getProfileCoreStats: (req) => getProfileCoreStats(req),
    getProfileTokenStats: (req) => getProfileTokenStats(req),
    getProfileDevices: () => getProfileDevicesResponse(),
    getProfileIdentity: () => getProfileIdentityResponse(),
    setProfileIdentity: (identity) => setProfileIdentityResponse(identity),
    copyShareImage: async (rect) => {
      const win = options.getMainWindow();
      if (!win) return;
      const image = await win.webContents.capturePage(roundRect(rect));
      if (!image.isEmpty()) {
        await clipboard.write([
          new ClipboardItem({ "image/png": new Blob([Uint8Array.from(image.toPNG())]) }),
        ]);
      }
    },
    appendUsageEvents: ({ events }) => dbAppendUsageEvents(events),
    installClineOffline: async ({ sourcePath }) => {
      const baseDir = options.requireAgentEmployeePaths().baseDir;
      const result = await installClineFromOfflinePackage(sourcePath, baseDir);
      return {
        ok: result.ok,
        ...(result.installDir ? { installDir: result.installDir } : {}),
        ...(result.version ? { version: result.version } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      };
    },
    installGdsAgentOffline: async ({ sourcePath }) => {
      const baseDir = options.requireAgentEmployeePaths().baseDir;
      const result = await installGdsAgentFromOfflinePackage(sourcePath, baseDir);
      return {
        ok: result.ok,
        ...(result.installDir ? { installDir: result.installDir } : {}),
        ...(result.version ? { version: result.version } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      };
    },
    reviewGetIssueStates: ({ projectLocation, taskId }) =>
      reviewGetIssueStates(projectLocation, taskId),
    reviewSetIssueState: ({ projectLocation, taskId, issueId, status }) =>
      reviewSetIssueState(projectLocation, taskId, issueId, status),
    reviewClearIssueStates: ({ projectLocation, taskId }) =>
      reviewClearIssueStates(projectLocation, taskId),
    reviewEnsureMcp: ({ projectLocation }) => ensureCodeReviewMcp(projectLocation),
    reviewClearProject: ({ projectLocation, projectId }) => {
      const result = reviewClearProject(projectLocation);
      if (projectId) clearProjectReviewRows(projectId);
      return result;
    },
    reviewGetProjectData: ({ projectLocation, projectId }) =>
      ingestProjectReviews(projectLocation, projectId),
    reviewCreateTask: ({ projectLocation, projectId, taskName, kind }) =>
      createReviewTask(projectLocation, projectId, { projectLocation, projectId, taskName, kind }),
    staticAnalysisCreateTask: ({
      projectLocation,
      projectId,
      taskName,
      mode,
      selectedRules,
      excelFile,
      codebasePath,
    }) =>
      createStaticAnalysisTask(projectLocation, projectId, {
        taskName,
        mode,
        selectedRules,
        ...(excelFile ? { excelFile } : {}),
        ...(codebasePath ? { codebasePath } : {}),
      }),
    staticAnalysisGetProjectData: ({ projectLocation, projectId }) =>
      ingestStaticAnalysis(projectLocation, projectId),
    staticAnalysisGetRules: () => getStaticAnalysisRules(),
    staticAnalysisGetDefaultRules: () => getStaticAnalysisDefaultRules(),
    staticAnalysisSetDefaultRules: ({ selectedRules }) =>
      setStaticAnalysisDefaultRules(selectedRules),
    staticAnalysisSetProblemStatus: ({ projectId, taskId, problemId, status }) =>
      setStaticAnalysisProblemStatus(projectId, taskId, problemId, status),
    staticAnalysisClearProject: ({ projectLocation, projectId }) =>
      clearProjectStaticAnalysis(projectLocation, projectId),
  });
}
