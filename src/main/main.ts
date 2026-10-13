import { watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  session as electronSession,
  type RenderProcessGoneDetails,
} from "electron";
import { BROWSER_SESSION_PARTITION } from "@/shared/browserPartition";
import { resolveThemeMode } from "@/shared/themeMode";
import { isThreadTurnActive, type RemoteThreadCommand } from "@/shared/contracts";
import {
  closeDatabase,
  dbDeleteThread,
  dbGetProject,
  dbGetProjectNotes,
  dbGetProjects,
  dbGetThread,
  dbGetThreads,
  dbInsertTaskRun,
  dbInterruptTaskRuns,
  dbSetTaskAwaiting,
  dbUpdateTaskRun,
  dbUpsertTask,
  dbUpsertThread,
  initDatabase,
  onProjectThreadDataChanged,
} from "./db";
import { dbInsertTeamRun, dbUpdateTeamRunStatus } from "./db/teamStore";
import { applySettingsWritePatch } from "./applySettingsWritePatch";
import { cleanupOrphanedAttachments, prepareAgentEmployeeDataRoot } from "./agentemployeeData";
import { createLocalIpcHandlers, showAddFilesDialog } from "./ipc/localHandlers";
import { registerIpcHandlers } from "./ipc/registerHandlers";
import { createSleepInhibitor } from "./sleepInhibitor";
import { seedStaticAnalysisRules } from "./staticAnalysis/staticAnalysisIngest";
import { shouldPreventSystemSleep } from "./sleepPolicy";
import {
  installLocalFileProtocolHandler,
  registerLocalFileProtocolScheme,
} from "./attachments/localFiles";
import {
  BrowserMcpIngress,
  BrowserPanelManager,
  ChromeBridgeServer,
  ChromeMcpIngress,
  installPickerProtocolHandler,
  registerPickerProtocolScheme,
} from "./browser";
import { buildBrowserUserAgent } from "./browser/userAgent";
import { startUsageLoginCookieMirror } from "./usageLogin/UsageLoginCookieMirror";
import {
  ComputerUseDesktopOverlay,
  ComputerUseMcpIngress,
  ComputerUseWakeLock,
  type ComputerUseMcpIngressInfo,
  resolveComputerUseHelperBinaryPath,
} from "./computer-use";
import { SupervisorClient } from "./supervisor/SupervisorClient";
import { createAutoUpdaterController } from "./updates/autoUpdater";
import { showOsNotification } from "./osNotifications";
import { createMainWindow } from "./window/createMainWindow";
import { requestTrackedRendererReload } from "./window/windowHardening";
import {
  createQuickComposerWindow,
  showQuickComposerWindow,
} from "./window/createQuickComposerWindow";
import { createPetWindow, showPetWindow } from "./window/createPetWindow";
import {
  createJsonTaskInboxStore,
  startTaskInboxWatcher,
  type TaskInboxItem,
  type TaskInboxWatcher,
} from "./taskInboxWatcher";
import { showAndFocusWindow } from "./window/showAndFocusWindow";
import { createMainWindowCloseLifecycle } from "./window/mainWindowClose";
import { createTray, type TrayHandle } from "./tray";
import { readKeybindingsFile } from "./keybindingsFile";
import { QuickComposerShortcutManager } from "./quickComposerShortcut";
import { shouldStartMinimized, syncWindowsStartupRegistration } from "./startupSettings";
import { type AgentEmployeePaths, resolveAgentEmployeeBaseDir } from "@/shared/agentemployeePaths";
import {
  incrementCrossagentSelectionUsage,
  removeCrossagentRoutingOverride,
  upsertCrossagentRoutingOverride,
} from "@/shared/crossagentRanking";
import { getAppName } from "@/shared/appName";
import { productNameFor, resolveAgentEmployeeChannel } from "@/shared/channel";
import {
  IPC_EVENT_CHANNELS,
  IPC_WINDOW_CHANNELS,
  isAgentStatusSupervisorEvent,
  quickComposerSubmissionSchema,
  type EmployeeQueueSnapshotEvent,
  type PrWatchStatusEvent,
  type QuickComposerSubmission,
  type SupervisorEvent,
} from "@/shared/ipc";
import { defaultSharedSettings, type SharedSettings } from "@/shared/settings";
import { readSharedSettingsFile, writeSharedSettingsFile } from "./sharedSettingsFile";
import { ensureOrganizationSeed } from "./organizationSeed";
import { remoteProjectCommandResultSchema } from "@/shared/remote";
import { WindowsJobObjectManager } from "./windowsJobObject";
import { captureMainException, initializeMainSentry } from "./diagnostics/sentry";
import { installMainLogFile } from "./diagnostics/logFile";
import {
  classifyRendererProcessGone,
  type RendererProcessGoneIntent,
} from "./diagnostics/processGone";
import { configureSecretStorageKey } from "@/shared/secretStorage";
import { readOrCreateSafeStorageSecretKey } from "./secretStorageKey";
import { createDesktopRemoteAccessController, type DesktopRemoteAccessController } from "./remote";
import { readOrCreateRemoteAccessIdentity } from "./remote/identity";
import { createGitStateExecutor, GitStateService } from "./gitState";
import { SshConnectionManager } from "./ssh/SshConnectionManager";
import {
  createDeviceTaskService,
  ensureHomeProjectRow,
  TaskRunCoordinator,
  type TasksService,
} from "./tasks";
import { createDeviceTaskDraftsService, type TaskDraftsService } from "./drafts";
import {
  AppControlsMcpIngress,
  buildSharedAppControlsIngressDeps,
  createAppControlsSupervisorCaller,
} from "./app-controls";
import { KnowledgeMcpIngress } from "./knowledge/mcp/KnowledgeMcpIngress";
import { legacyProductNameFor, resolveLegacyElectronUserDataDir } from "./legacyDataMigration";
import { refreshMacDockIcon } from "./macDockIcon";
import { repairLegacyMacAppPath } from "./macAppPathMigration";
import { persistSupervisorEvent } from "./remote/server/runtimePersistence";
import {
  buildPrWatchExecutionDeps,
  createDevicePrWatchService,
  type PrWatchService,
} from "./prWatch";
import { shouldUseMockKeychain } from "./mockKeychain";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const channel = resolveAgentEmployeeChannel();
const baseDirOverride = process.env.AGENTEMPLOYEE_BASE_DIR;
const legacyBaseDirOverride = process.env.LIGHTCODE_BASE_DIR?.trim() || undefined;
const defaultElectronUserDataDir = app.getPath("userData");
const legacyElectronUserDataDir = legacyBaseDirOverride
  ? join(legacyBaseDirOverride, "userData")
  : resolveLegacyElectronUserDataDir(defaultElectronUserDataDir, channel, isDev);

// Electron keys macOS Keychain and Linux secret-store entries by app name.
// Initialize Chromium's crypto under the pre-rebrand technical identity so
// migrated secrets and browser sessions remain decryptable. The visible name
// is restored after Electron captures the crypto configuration during startup.
const preserveLegacySafeStorageIdentity = !isDev && process.platform !== "win32";
if (preserveLegacySafeStorageIdentity) {
  app.setName(legacyProductNameFor(channel));
  app.setPath("userData", defaultElectronUserDataDir);
}

if (process.env.AGENTEMPLOYEE_CDP_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.AGENTEMPLOYEE_CDP_PORT);
}

// Isolated smoke runs replace HOME so they cannot read developer credentials.
// On macOS that also hides the login keychain from Chromium, which otherwise
// opens a blocking "Keychain Not Found" dialog while safeStorage initializes.
// Chromium's mock keychain is intended for automated tests and must never be
// enabled for packaged or ordinary dev launches.
if (shouldUseMockKeychain({ isDev })) {
  app.commandLine.appendSwitch("use-mock-keychain");
}

// Windows HDR can make DWM acrylic visibly change opacity when Chromium starts
// compositing image content in the display color space. Keep Chromium in sRGB so
// acrylic stays translucent without breathing as image planes appear/disappear.
if (process.platform === "win32") {
  app.commandLine.appendSwitch("force-color-profile", "srgb");
}
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
}

const browserUserAgent = buildBrowserUserAgent(app.userAgentFallback);
app.userAgentFallback = browserUserAgent;

if (baseDirOverride) {
  app.setPath("userData", join(baseDirOverride, "userData"));
} else if (isDev) {
  app.setPath("userData", join(app.getPath("userData"), "Dev"));
}

const hasSingleInstanceLock = isDev || app.requestSingleInstanceLock();
let agentemployeePaths: AgentEmployeePaths | null = null;
if (hasSingleInstanceLock) {
  const electronUserDataDir = app.getPath("userData");
  agentemployeePaths = prepareAgentEmployeeDataRoot(
    baseDirOverride ??
      (isDev ? join(homedir(), ".agentemployee-dev") : resolveAgentEmployeeBaseDir(channel)),
    {
      channel,
      electronUserDataDir,
      legacyElectronUserDataDir,
      ...(legacyBaseDirOverride ? { legacyBaseDir: legacyBaseDirOverride } : {}),
      allowCustomDataRoot: app.isPackaged,
    },
  );
}

// Capture main-process + supervisor output to a file. A packaged Windows build
// has no console, so crash-attribution lines (child-process-gone, supervisor
// exit codes, `[acp] …`) would otherwise be unrecoverable. Packaged builds log
// to `<dataRoot>/logs/agentemployee.log` (rotating); `AGENTEMPLOYEE_LOG_FILE=<path>`
// overrides, `AGENTEMPLOYEE_LOG_FILE=0` disables.
const explicitLogFile = process.env.AGENTEMPLOYEE_LOG_FILE?.trim();
if (explicitLogFile && explicitLogFile !== "0") {
  installMainLogFile(explicitLogFile);
} else if (app.isPackaged && agentemployeePaths) {
  installMainLogFile(join(agentemployeePaths.logsDir, "agentemployee.log"));
}

const sentryEnabled = initializeMainSentry({ appVersion: app.getVersion(), isDev, channel });

// Fallback global handlers so a stray throw in any main-process callback
// (IPC handler, Electron event listener, timer) is reported rather than
// silently taking the whole app — and the supervisor and all windows — down.
// Sentry's Electron integration also hooks these, but only when a DSN is
// configured and initialization succeeded; this guarantees coverage otherwise.
process.on("uncaughtException", (error) => {
  console.error("[agentemployee] uncaught exception:", error);
  captureMainException(error, { "agentemployee.feature_area": "main" });
});
process.on("unhandledRejection", (reason) => {
  console.error("[agentemployee] unhandled rejection:", reason);
  captureMainException(reason, { "agentemployee.feature_area": "main" });
});
const posthogEnabled = process.env.POSTHOG_ENABLED !== "0";
const posthogKey = posthogEnabled ? (process.env.POSTHOG_KEY ?? "").trim() : "";
const posthogHost = (process.env.POSTHOG_HOST ?? "").trim();
const posthogEnableDev = process.env.POSTHOG_ENABLE_DEV === "1";

const WINDOW_CHROME_HEIGHT = 32;
/** Grace period before rebuilding a destroyed pet window (the pet is resident). */
const PET_WINDOW_RECREATE_DELAY_MS = 1_000;
/** Cap on spontaneous rebuilds so a pet window that cannot stay alive can't spin. */
const PET_WINDOW_MAX_RECREATES = 5;

let mainWindow: BrowserWindow | null = null;
let quickComposerWindow: BrowserWindow | null = null;
// The desktop pet (chief-steward avatar) is a resident always-on-top ball; it
// is created at startup and closed only on quit.
let petWindow: BrowserWindow | null = null;
// Watches the user-configured task-inbox directory (settings.taskInboxPath);
// restarted whenever that path changes.
let taskInboxWatcher: TaskInboxWatcher | null = null;
// Newest supervisor employee-queue snapshot (in-memory only; the supervisor
// rebuilds queue state on restart, so main deliberately does not persist it).
let latestEmployeeQueueSnapshot: EmployeeQueueSnapshotEvent | null = null;
let quickComposerDialogOpen = false;
let quickComposerDismissTimer: ReturnType<typeof setTimeout> | null = null;
let revealMainAfterQuickComposerDismiss = false;
let mainRendererReady = false;
const pendingQuickComposerSubmissions: QuickComposerSubmission[] = [];
let pendingTrayThreadId: string | null = null;
let windowsJobObjectManager: WindowsJobObjectManager | null = null;
let browserPanelManager: BrowserPanelManager | null = null;
let browserMcpIngress: BrowserMcpIngress | null = null;
let computerUseMcpIngress: ComputerUseMcpIngress | null = null;
let appControlsMcpIngress: AppControlsMcpIngress | null = null;
let knowledgeMcpIngress: KnowledgeMcpIngress | null = null;
let computerUseDesktopOverlay: ComputerUseDesktopOverlay | null = null;
let chromeBridgeServer: ChromeBridgeServer | null = null;
let chromeMcpIngress: ChromeMcpIngress | null = null;
let browserExtractWindow: BrowserWindow | null = null;
// Retained module-scope so the native Tray icon stays reachable from GC.
let tray: TrayHandle | null = null;
let quickComposerShortcutManager: QuickComposerShortcutManager | null = null;
let isQuitting = false;
let petWindowRecreateTimer: ReturnType<typeof setTimeout> | null = null;
let petWindowRecreateCount = 0;
/** Set during startup; the single "tear the app down" hook, run on `will-quit`. */
let disposeAppResources: (() => void) | null = null;

function captureRendererProcessGone(
  details: RenderProcessGoneDetails,
  featureArea: "browser" | "quick-composer" | "renderer",
  intent?: RendererProcessGoneIntent,
): void {
  const diagnostic = classifyRendererProcessGone(
    details,
    process.platform,
    isQuitting ? "app-shutdown" : intent,
  );
  if (!diagnostic) return;
  captureMainException(
    new Error(`Electron renderer process gone (${diagnostic.bucket})`),
    {
      "agentemployee.feature_area": featureArea,
      "agentemployee.process": "renderer",
    },
    diagnostic.fingerprint,
  );
}

function isCloseToTrayEnabled(): boolean {
  if (!agentemployeePaths) return false;
  try {
    return readSharedSettingsFile(agentemployeePaths.settingsPath).closeToTray;
  } catch {
    return false;
  }
}

/**
 * Resolves the saved appearance + opt-in translucent ("liquid glass") sidebar in
 * a single settings read, so the window opens already matching the theme and
 * material (flash-free first paint) before the renderer paints.
 */
function resolveWindowChromeOptions(): {
  appearance: "light" | "dark";
  sidebarTranslucency: boolean;
} {
  let mode: "system" | "light" | "dark" = "dark";
  let wantGlass = false;
  if (agentemployeePaths) {
    try {
      const settings = readSharedSettingsFile(agentemployeePaths.settingsPath);
      mode = settings.themeMode;
      wantGlass = settings.sidebarTranslucency === true;
    } catch {
      // Fall back to dark / opaque.
    }
  }
  return {
    appearance: resolveThemeMode(mode, nativeTheme.shouldUseDarkColors),
    sidebarTranslucency: wantGlass,
  };
}

function primeBrowserAllowFlags(settings?: SharedSettings): void {
  if (!agentemployeePaths) return;
  let allowEval = false;
  let allowDataAccess = false;
  try {
    const s = settings ?? readSharedSettingsFile(agentemployeePaths.settingsPath);
    allowEval = s.browser?.allowEval === true;
    allowDataAccess = s.browser?.allowDataAccess === true;
  } catch {
    allowEval = false;
    allowDataAccess = false;
  }
  // The embedded browser and the external Chrome bridge share the same
  // eval / data-access gates from browser settings.
  browserMcpIngress?.setAllowEval(allowEval);
  browserMcpIngress?.setAllowDataAccess(allowDataAccess);
  chromeMcpIngress?.setAllowEval(allowEval);
  chromeMcpIngress?.setAllowDataAccess(allowDataAccess);
}

// setLoginItemSettings writes the HKCU Run registry key on Windows; skip it
// when launchAtStartup hasn't changed so routine settings saves stay cheap.
let lastAppliedLaunchAtStartup: boolean | null = null;

function syncStartupSettings(settings?: SharedSettings): void {
  if (!agentemployeePaths) return;
  try {
    const s = settings ?? readSharedSettingsFile(agentemployeePaths.settingsPath);
    if (s.launchAtStartup === lastAppliedLaunchAtStartup) return;
    syncWindowsStartupRegistration(app, s, process.platform, isDev);
    lastAppliedLaunchAtStartup = s.launchAtStartup;
  } catch (error) {
    console.warn("[agentemployee] failed to update Windows startup registration", error);
  }
}

function broadcastTaskInboxItem(item: TaskInboxItem): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(IPC_EVENT_CHANNELS.taskInboxItem, item);
  }
}

function broadcastEmployeeQueueSnapshot(): void {
  const snapshot = latestEmployeeQueueSnapshot;
  if (!snapshot) return;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(IPC_EVENT_CHANNELS.employeeQueueSnapshot, snapshot);
  }
}

function maybeHandleEmployeeQueueSnapshot(event: SupervisorEvent): void {
  if (event.type !== "employee-queue-snapshot") return;
  latestEmployeeQueueSnapshot = event.snapshot;
  broadcastEmployeeQueueSnapshot();
}

function restartTaskInboxWatcher(settings: SharedSettings): void {
  taskInboxWatcher?.stop();
  taskInboxWatcher = null;
  const dirPath = settings.taskInboxPath;
  if (!dirPath) return;
  const store = createJsonTaskInboxStore(
    join(app.getPath("userData"), "task-inbox-processed.json"),
  );
  taskInboxWatcher = startTaskInboxWatcher(dirPath, broadcastTaskInboxItem, store);
}

function handleSharedSettingsChanged(settings: SharedSettings): void {
  primeBrowserAllowFlags(settings);
  syncStartupSettings(settings);
  restartTaskInboxWatcher(settings);
}

/**
 * One-time fixed-organization seed (see ./organizationSeed). Runs on app ready
 * before the renderer fetches settings, so a first launch immediately presents
 * the confirmed org tree. Thin wiring only — the append/idempotency logic lives
 * in organizationSeed.ts; this reuses the existing read → write → notify path
 * rather than inventing a second writer.
 */
function seedOrganizationAtStartup(settingsPath: string): void {
  try {
    const current = readSharedSettingsFile(settingsPath);
    const { changed, settings } = ensureOrganizationSeed(current);
    if (!changed) return;
    writeSharedSettingsFile(settingsPath, settings);
    handleSharedSettingsChanged(settings);
    mainWindow?.webContents.send(IPC_EVENT_CHANNELS.sharedSettingsChanged, settings);
  } catch (error) {
    console.warn("[organizationSeed] failed to apply fixed-organization seed", error);
  }
}

function recordCrossagentSelectionPreference(
  event: Extract<SupervisorEvent, { type: "crossagent-selection-used" }>,
): void {
  const settingsPath = requireAgentEmployeePaths().settingsPath;
  const current = readSharedSettingsFile(settingsPath);
  const next = {
    ...current,
    crossagentSelectionUsage: incrementCrossagentSelectionUsage(
      current.crossagentSelectionUsage,
      event.selections,
    ),
  };
  writeSharedSettingsFile(settingsPath, next);
  handleSharedSettingsChanged(next);
  mainWindow?.webContents.send(IPC_EVENT_CHANNELS.sharedSettingsChanged, next);
}

function updateCrossagentRoutingOverride(
  event: Extract<SupervisorEvent, { type: "crossagent-routing-override-changed" }>,
): void {
  const settingsPath = requireAgentEmployeePaths().settingsPath;
  const current = readSharedSettingsFile(settingsPath);
  const next = {
    ...current,
    crossagentRoutingOverrides:
      event.change.action === "set"
        ? upsertCrossagentRoutingOverride(current.crossagentRoutingOverrides, event.change.override)
        : removeCrossagentRoutingOverride(current.crossagentRoutingOverrides, event.change.tags),
  };
  writeSharedSettingsFile(settingsPath, next);
  handleSharedSettingsChanged(next);
  mainWindow?.webContents.send(IPC_EVENT_CHANNELS.sharedSettingsChanged, next);
}

function quickComposerWindowFor(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window && window === quickComposerWindow && !window.isDestroyed() ? window : null;
}

function flushQuickComposerSubmissions(): void {
  if (!mainRendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  for (const submission of pendingQuickComposerSubmissions.splice(0)) {
    mainWindow.webContents.send(IPC_EVENT_CHANNELS.quickComposerSubmit, submission);
  }
}

function flushTrayThreadOpen(): void {
  if (!mainRendererReady || !mainWindow || mainWindow.isDestroyed() || !pendingTrayThreadId) return;
  const threadId = pendingTrayThreadId;
  pendingTrayThreadId = null;
  mainWindow.webContents.send(IPC_EVENT_CHANNELS.threadOpenRequested, { threadId });
}

function ensureMainWindow(showOnReady = true): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainRendererReady = false;
  mainWindow = createMainAppWindow(showOnReady);
  browserPanelManager?.bindHost(mainWindow);
  return mainWindow;
}

function openThreadFromTray(threadId: string): void {
  pendingTrayThreadId = threadId;
  showAndFocusWindow(ensureMainWindow());
  flushTrayThreadOpen();
}

function finishQuickComposerDismiss(window: BrowserWindow): void {
  if (quickComposerDismissTimer) {
    clearTimeout(quickComposerDismissTimer);
    quickComposerDismissTimer = null;
  }
  if (!window.isDestroyed()) window.hide();
  if (!revealMainAfterQuickComposerDismiss) return;
  revealMainAfterQuickComposerDismiss = false;
  const target = ensureMainWindow();
  if (target.webContents.isLoading()) {
    target.once("ready-to-show", () => showAndFocusWindow(target));
  } else {
    showAndFocusWindow(target);
  }
}

function requestQuickComposerDismiss(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  window.webContents.send(IPC_EVENT_CHANNELS.quickComposerDismissRequested);
  if (quickComposerDismissTimer) clearTimeout(quickComposerDismissTimer);
  quickComposerDismissTimer = setTimeout(() => finishQuickComposerDismiss(window), 240);
}

// Window options shared by every app-renderer window (main + quick composer);
// each factory adds only the fields distinct to its surface.
function commonAppWindowOptions() {
  return {
    title: getAppName(channel, isDev),
    isDev,
    channel,
    preloadPath: join(__dirname, "preload.cjs"),
    rendererHtmlPath: join(__dirname, "../renderer/index.html"),
    appVersion: app.getVersion(),
    posthogEnableDev,
    posthogEnabled,
    posthogHost,
    posthogKey,
    sentryEnabled,
    browserUserAgent,
    openDevTools: process.env.AGENTEMPLOYEE_DISABLE_DEVTOOLS !== "1",
    ...(process.env.VITE_DEV_SERVER_URL ? { devServerUrl: process.env.VITE_DEV_SERVER_URL } : {}),
  };
}

function createQuickComposerAppWindow(): BrowserWindow {
  const window = createQuickComposerWindow({
    ...commonAppWindowOptions(),
    onClosed: () => {
      if (quickComposerWindow === window) quickComposerWindow = null;
    },
    onRendererProcessGone: (details, intent) => {
      captureRendererProcessGone(details, "quick-composer", intent);
    },
  });
  window.on("blur", () => {
    setTimeout(() => {
      if (
        !quickComposerDialogOpen &&
        !window.isDestroyed() &&
        window.isVisible() &&
        !window.isFocused()
      ) {
        requestQuickComposerDismiss(window);
      }
    }, 0);
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.key !== "Escape" || input.type !== "keyDown") return;
    event.preventDefault();
    requestQuickComposerDismiss(window);
  });
  return window;
}

function toggleQuickComposerWindow(): void {
  if (quickComposerWindow && !quickComposerWindow.isDestroyed()) {
    if (quickComposerWindow.isVisible()) {
      requestQuickComposerDismiss(quickComposerWindow);
    } else {
      showQuickComposerWindow(quickComposerWindow);
    }
    return;
  }
  quickComposerWindow = createQuickComposerAppWindow();
}

function createPetAppWindow(): BrowserWindow {
  const window = createPetWindow({
    ...commonAppWindowOptions(),
    onClosed: () => {
      if (petWindow !== window) return;
      petWindow = null;
      schedulePetWindowRecreate();
    },
    onRendererProcessGone: (details, intent) => {
      captureRendererProcessGone(details, "renderer", intent);
    },
  });
  return window;
}

/**
 * The pet is resident: it is created at startup and is only ever meant to be
 * hidden (never closed). If its window is destroyed anyway — an accidental
 * close, a crash during teardown, a quit request that was later abandoned — it
 * rebuilds itself instead of silently disappearing with no way back, which
 * previously stranded the user with no ball, no panel and a tray item that did
 * nothing.
 */
function schedulePetWindowRecreate(): void {
  if (isQuitting || petWindowRecreateTimer !== null) return;
  if (petWindowRecreateCount >= PET_WINDOW_MAX_RECREATES) {
    console.error("[agentemployee] pet window keeps disappearing; leaving it to the tray item");
    return;
  }
  petWindowRecreateTimer = setTimeout(() => {
    petWindowRecreateTimer = null;
    if (isQuitting || (petWindow && !petWindow.isDestroyed())) return;
    petWindowRecreateCount += 1;
    console.warn(
      `[agentemployee] pet window was destroyed; recreating it (${petWindowRecreateCount}/${PET_WINDOW_MAX_RECREATES})`,
    );
    petWindow = createPetAppWindow();
  }, PET_WINDOW_RECREATE_DELAY_MS);
}

/** The pet window, rebuilt on demand — the tray item is the user's manual way back. */
function ensurePetWindow(): BrowserWindow {
  if (!petWindow || petWindow.isDestroyed()) {
    // A manual restore starts a fresh auto-recovery budget.
    petWindowRecreateCount = 0;
    petWindow = createPetAppWindow();
  }
  return petWindow;
}

function clearPetWindowRecreateTimer(): void {
  if (petWindowRecreateTimer === null) return;
  clearTimeout(petWindowRecreateTimer);
  petWindowRecreateTimer = null;
}

function forwardAgentStatusEventToQuickComposer(event: SupervisorEvent): void {
  if (!isAgentStatusSupervisorEvent(event)) return;
  // The overlay refetches agent statuses on focus, so a hidden window has no use
  // for the live stream — skip the cross-process send until it's actually shown.
  if (
    quickComposerWindow &&
    !quickComposerWindow.isDestroyed() &&
    quickComposerWindow.isVisible()
  ) {
    quickComposerWindow.webContents.send(IPC_EVENT_CHANNELS.supervisorEvent, event);
  }
}

function createMainAppWindow(showOnReady = true): BrowserWindow {
  const windowChrome = resolveWindowChromeOptions();
  let window: BrowserWindow;
  const closeLifecycle = createMainWindowCloseLifecycle({
    isQuitting: () => isQuitting,
    closeToTrayEnabled: isCloseToTrayEnabled,
    hide: () => window.hide(),
    markQuitting: () => {
      isQuitting = true;
    },
    quit: () => app.quit(),
  });
  window = createMainWindow({
    ...commonAppWindowOptions(),
    windowChromeHeight: WINDOW_CHROME_HEIGHT,
    appearance: windowChrome.appearance,
    sidebarTranslucency: windowChrome.sidebarTranslucency,
    showOnReady,
    onClosed: () => {
      const wasMainWindow = mainWindow === window;
      if (wasMainWindow) mainWindow = null;
      mainRendererReady = false;
      closeLifecycle.handleClosed();
    },
    onClose: (event) => closeLifecycle.handleClose(event),
    onRendererProcessGone: (details, intent) => {
      mainRendererReady = false;
      captureRendererProcessGone(details, "renderer", intent);
    },
  });
  window.webContents.on("did-start-loading", () => {
    if (mainWindow === window) mainRendererReady = false;
  });
  return window;
}

function focusBrowserExtractWindow(): void {
  if (!browserExtractWindow || browserExtractWindow.isDestroyed()) return;
  showAndFocusWindow(browserExtractWindow);
}

function revealBrowserInMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showAndFocusWindow(mainWindow);
  }
  browserPanelManager?.notifyState();
  browserPanelManager?.revealPanel();
}

function createBrowserExtractWindow(): BrowserWindow {
  const windowChrome = resolveWindowChromeOptions();
  const window = createMainWindow({
    title: `${getAppName(channel, isDev)} Browser`,
    windowKind: "browserExtract",
    boundsStateKey: "browser-extract-window-bounds",
    defaultWidth: 1120,
    defaultHeight: 760,
    minWidth: 520,
    minHeight: 420,
    isDev,
    channel,
    preloadPath: join(__dirname, "preload.cjs"),
    rendererHtmlPath: join(__dirname, "../renderer/index.html"),
    appVersion: app.getVersion(),
    posthogEnableDev,
    posthogEnabled,
    posthogHost,
    posthogKey,
    sentryEnabled,
    windowChromeHeight: WINDOW_CHROME_HEIGHT,
    browserUserAgent,
    appearance: windowChrome.appearance,
    sidebarTranslucency: windowChrome.sidebarTranslucency,
    openDevTools: false,
    ...(process.env.VITE_DEV_SERVER_URL ? { devServerUrl: process.env.VITE_DEV_SERVER_URL } : {}),
    onClosed: () => {
      browserExtractWindow = null;
      browserPanelManager?.notifyState();
      // Closing the window — whether via the OS controls or "bring back to
      // panel" (injectBrowserToMain) — returns the browser to the main window.
      if (!isQuitting) {
        revealBrowserInMainWindow();
      }
    },
    onRendererProcessGone: (details, intent) => {
      captureRendererProcessGone(details, "browser", intent);
    },
  });
  return window;
}

function extractBrowserToWindow(): void {
  if (browserExtractWindow && !browserExtractWindow.isDestroyed()) {
    browserPanelManager?.notifyState();
    focusBrowserExtractWindow();
    return;
  }
  browserExtractWindow = createBrowserExtractWindow();
  // Bind the host (which emits state) only after `browserExtractWindow` is
  // assigned, so the snapshot's `extracted` flag reads true. Otherwise the main
  // window keeps showing its own browser until the next unrelated state emit.
  browserPanelManager?.bindHost(browserExtractWindow);
  focusBrowserExtractWindow();
}

function injectBrowserToMain(): void {
  const window = browserExtractWindow;
  if (!window || window.isDestroyed()) {
    browserExtractWindow = null;
    revealBrowserInMainWindow();
    return;
  }
  // The window's `onClosed` handler returns the browser to the main window.
  window.close();
}

const workingThreads = new Set<string>();
const sleepInhibitor = createSleepInhibitor();
// A locked desktop is uncontrollable and unobservable for computer use, so the
// display is held awake for the duration of a session. Owned here (not by the
// ingress) so it survives ingress restarts and is released on quit.
const computerUseWakeLock = new ComputerUseWakeLock();

function requireAgentEmployeePaths(): AgentEmployeePaths {
  if (!agentemployeePaths) {
    throw new Error("AgentEmployee paths are not initialized.");
  }
  return agentemployeePaths;
}

function updatePowerSaveBlocker(): void {
  if (!agentemployeePaths) {
    sleepInhibitor.setActive(workingThreads.size > 0);
    computerUseWakeLock.setEnabled(defaultSharedSettings.computerUseKeepAwake);
    return;
  }
  const settings = readSharedSettingsFile(agentemployeePaths.settingsPath);
  sleepInhibitor.setActive(shouldPreventSystemSleep(settings, workingThreads.size));
  // Every settings write funnels through here, so toggling the setting off
  // releases an already-held wake lock immediately.
  computerUseWakeLock.setEnabled(settings.computerUseKeepAwake);
}

function handleSupervisorEventForSleep(event: SupervisorEvent): void {
  if (event.type === "thread-state") {
    const active = event.status === "working" || event.status === "launching";
    if (active) {
      workingThreads.add(event.threadId);
    } else {
      workingThreads.delete(event.threadId);
    }
    updatePowerSaveBlocker();
    return;
  }
  if (event.type === "thread-exited") {
    workingThreads.delete(event.threadId);
    updatePowerSaveBlocker();
  }
}

registerLocalFileProtocolScheme();
registerPickerProtocolScheme();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    if (!app.isReady()) return;
    if (
      agentemployeePaths &&
      shouldStartMinimized(
        readSharedSettingsFile(agentemployeePaths.settingsPath),
        commandLine,
        process.platform,
      )
    ) {
      return;
    }
    showAndFocusWindow(ensureMainWindow());
  });

  void app
    .whenReady()
    .then(async () => {
      if (preserveLegacySafeStorageIdentity) app.setName(productNameFor(channel));
      repairLegacyMacAppPath(channel, { isPackaged: app.isPackaged });
      refreshMacDockIcon();
      Menu.setApplicationMenu(null);

      installLocalFileProtocolHandler();
      installPickerProtocolHandler();
      // Keep the pre-rebrand partition so browser cookies and sign-ins survive.
      const browserSession = electronSession.fromPartition(BROWSER_SESSION_PARTITION);
      browserSession.setUserAgent(browserUserAgent);

      const paths = requireAgentEmployeePaths();
      // Re-seal an already-signed-in provider's cookie whenever the live jar
      // refreshes it, so providers with session-scoped auth cookies (Alibaba's
      // console) don't age out of the one snapshot taken at sign-in.
      startUsageLoginCookieMirror({ cacheDir: paths.cacheDir, session: browserSession });
      seedOrganizationAtStartup(paths.settingsPath);
      const initialSettings = readSharedSettingsFile(paths.settingsPath);
      syncStartupSettings(initialSettings);
      const showMainWindowOnReady = !shouldStartMinimized(
        initialSettings,
        process.argv,
        process.platform,
      );
      let jobObjectReady: Promise<void> = Promise.resolve();
      if (process.platform === "win32") {
        const manager = new WindowsJobObjectManager();
        windowsJobObjectManager = manager;
        jobObjectReady = manager.start().catch((error) => {
          console.error(
            "[agentemployee] Windows Job Object helper unavailable:",
            error instanceof Error ? error.message : String(error),
          );
          captureMainException(error, { "agentemployee.feature_area": "process-lifecycle" });
          if (windowsJobObjectManager === manager) {
            windowsJobObjectManager = null;
          }
        });
      }

      initDatabase(paths.dbPath);
      seedStaticAnalysisRules();
      const secretStorageKey = readOrCreateSafeStorageSecretKey(paths.baseDir);
      // Configure the same key in main so it can seal captured secrets (e.g. usage
      // login cookies); the supervisor configures it from the env var it receives.
      configureSecretStorageKey(secretStorageKey);

      const supervisorPath = join(__dirname, "supervisor.cjs");
      const wslHelpersDir = app.isPackaged
        ? join(process.resourcesPath, "wsl-helpers")
        : join(__dirname, "..", "..", "resources", "wsl-helpers");
      const bundledSkillsDir = app.isPackaged
        ? join(process.resourcesPath, "skills")
        : join(__dirname, "..", "..", "resources", "skills");
      const bundledPluginsDir = app.isPackaged
        ? join(process.resourcesPath, "plugins")
        : join(__dirname, "..", "..", "resources", "plugins");
      const bundledTemplatesDir = app.isPackaged
        ? join(process.resourcesPath, "templates")
        : join(__dirname, "..", "..", "resources", "templates");
      const bundledPythonDir = app.isPackaged
        ? join(process.resourcesPath, "python")
        : join(__dirname, "..", "..", "resources", "python");
      const bundledGraphvizDir = app.isPackaged
        ? join(process.resourcesPath, "graphviz")
        : join(__dirname, "..", "..", "resources", "graphviz");
      const bundledOfficeCliDir = app.isPackaged
        ? join(process.resourcesPath, "officecli")
        : join(__dirname, "..", "..", "resources", "officecli");
      const sshConnectionManager = new SshConnectionManager({
        mainBundleDir: __dirname,
        agentPluginsDir: app.isPackaged
          ? join(process.resourcesPath, "agent-plugins")
          : join(__dirname, "..", "..", "resources", "agent-plugins"),
        wslHelpersDir,
        bundledSkillsDir,
        bundledPluginsDir,
        cacheDir: join(paths.baseDir, "ssh-runtime-bundles"),
      });

      // Assigned after the browser services are composed and before the
      // supervisor starts emitting events.
      let remoteAccessController: DesktopRemoteAccessController | null = null;
      // Assigned right after the supervisor client below; the `onEvent` tap only
      // fires once the supervisor is started, by which point it is set.
      let taskRunCoordinator: TaskRunCoordinator | null = null;
      let prWatchService: PrWatchService | null = null;
      let gitStateService: GitStateService | null = null;
      const supervisorClient = new SupervisorClient({
        appVersion: app.getVersion(),
        isDev,
        supervisorPath,
        wslHelpersDir,
        bundledSkillsDir,
        bundledPluginsDir,
        bundledTemplatesDir,
        bundledPythonDir,
        bundledGraphvizDir,
        bundledOfficeCliDir,
        secretStorageKey,
        resolveExtraEnv: () => {
          const env: Record<string, string> = {};
          const browserInfo = browserMcpIngress?.getInfo();
          if (browserInfo) {
            env.AGENTEMPLOYEE_BROWSER_MCP_URL = browserInfo.url;
            env.AGENTEMPLOYEE_BROWSER_MCP_TOKEN = browserInfo.token;
          }
          const chromeInfo = chromeMcpIngress?.getInfo();
          if (chromeInfo) {
            env.AGENTEMPLOYEE_CHROME_MCP_URL = chromeInfo.url;
            env.AGENTEMPLOYEE_CHROME_MCP_TOKEN = chromeInfo.token;
          }
          const computerUseInfo = computerUseMcpIngress?.getInfo();
          if (computerUseInfo) {
            env.AGENTEMPLOYEE_COMPUTER_USE_MCP_URL = computerUseInfo.url;
            env.AGENTEMPLOYEE_COMPUTER_USE_MCP_TOKEN = computerUseInfo.token;
          }
          const appControlsInfo = appControlsMcpIngress?.getInfo();
          if (appControlsInfo) {
            env.AGENTEMPLOYEE_APP_CONTROLS_MCP_URL = appControlsInfo.url;
            env.AGENTEMPLOYEE_APP_CONTROLS_MCP_TOKEN = appControlsInfo.token;
          }
          const knowledgeInfo = knowledgeMcpIngress?.getInfo();
          if (knowledgeInfo) {
            env.AGENTEMPLOYEE_KB_MCP_URL = knowledgeInfo.url;
            env.AGENTEMPLOYEE_KB_MCP_TOKEN = knowledgeInfo.token;
          }
          return env;
        },
        assignPid: async (pid) => {
          await windowsJobObjectManager?.assignPid(pid);
        },
        reportError: (error, tags) => {
          captureMainException(error, tags);
        },
        onEvent: (event) => {
          if (event.type === "crossagent-selection-used") {
            try {
              recordCrossagentSelectionPreference(event);
            } catch (error) {
              captureMainException(error, { "agentemployee.feature_area": "crossagents-routing" });
            }
            return;
          }
          if (event.type === "crossagent-routing-override-changed") {
            let errorMessage: string | undefined;
            try {
              updateCrossagentRoutingOverride(event);
            } catch (error) {
              errorMessage =
                error instanceof Error ? error.message : "Unable to save the routing preference";
              captureMainException(error, { "agentemployee.feature_area": "crossagents-routing" });
            }
            void supervisorClient
              .call("confirmCrossagentRoutingOverride", {
                requestId: event.requestId,
                ok: errorMessage === undefined,
                ...(errorMessage ? { error: errorMessage } : {}),
              })
              .catch((error) => {
                captureMainException(error, {
                  "agentemployee.feature_area": "crossagents-routing",
                });
              });
            return;
          }
          if (event.type === "team-run-change") {
            // Supervisor cannot reach SQLite; this is its persistence request for
            // team dispatch runs. No finishedAt → insert; with finishedAt → update.
            try {
              const { run } = event;
              if (run.finishedAt !== undefined) {
                dbUpdateTeamRunStatus(run.id, run.status, run.finishedAt);
              } else {
                dbInsertTeamRun({
                  id: run.id,
                  teamId: run.teamId,
                  prompt: run.prompt,
                  policy: run.policy,
                  targetWorkspaceIds: run.targetWorkspaceIds,
                  status: run.status,
                  createdAt: run.createdAt,
                  finishedAt: null,
                });
              }
            } catch (error) {
              captureMainException(error, { "agentemployee.feature_area": "team-runs" });
            }
            return;
          }
          if (event.type === "settings-write-request") {
            // Chief steward tools define employees / teams / the steward id; the
            // supervisor process cannot touch the settings file, so it patches us.
            try {
              const settingsPath = requireAgentEmployeePaths().settingsPath;
              const next = applySettingsWritePatch(
                readSharedSettingsFile(settingsPath),
                event.patch,
              );
              writeSharedSettingsFile(settingsPath, next);
              handleSharedSettingsChanged(next);
              mainWindow?.webContents.send(IPC_EVENT_CHANNELS.sharedSettingsChanged, next);
            } catch (error) {
              captureMainException(error, { "agentemployee.feature_area": "chief-steward" });
            }
            return;
          }
          if (event.type === "task-create-request") {
            // Chief steward created a task board entry; supervisor has no SQLite
            // access, so main performs the write via the existing TasksService.
            try {
              taskService.create({
                title: event.task.title,
                prompt: event.task.prompt,
                agentKind: event.task.agentKind,
                config: { model: event.task.model },
                isolation: "project",
                scheduleEnabled: false,
                ...(event.task.projectId ? { projectId: event.task.projectId } : {}),
              });
            } catch (error) {
              captureMainException(error, { "agentemployee.feature_area": "chief-steward" });
            }
            return;
          }
          persistSupervisorEvent(event);
          handleSupervisorEventForSleep(event);
          appControlsMcpIngress?.observeSupervisorEvent(event);
          taskRunCoordinator?.observeSupervisorEvent(event);
          prWatchService?.observeSupervisorEvent(event);
          gitStateService?.observeSupervisorEvent(event);
          remoteAccessController?.handleSupervisorEvent(event);
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.supervisorEvent, event);
          forwardAgentStatusEventToQuickComposer(event);
          maybeHandleEmployeeQueueSnapshot(event);
        },
        onReset: () => {
          workingThreads.clear();
          remoteAccessController?.handleSupervisorReset();
          // Queue state belongs to the supervisor process. A crash/restart
          // drops its in-memory records without emitting per-thread events,
          // so clear every renderer cache at the same boundary instead of
          // leaving rows whose actions can only fail with item-not-found.
          for (const thread of dbGetThreads()) {
            mainWindow?.webContents.send(IPC_EVENT_CHANNELS.supervisorEvent, {
              type: "thread-follow-up-queue",
              threadId: thread.id,
              queue: null,
            } satisfies SupervisorEvent);
          }
          updatePowerSaveBlocker();
        },
      });
      const taskCoordinator = new TaskRunCoordinator({
        startThread: (payload) => supervisorClient.call("startThread", payload),
        interruptThread: (threadId) => supervisorClient.call("interruptThread", { threadId }),
        getAgentStatuses: (wslDistros) => supervisorClient.call("getAgentStatuses", { wslDistros }),
        addWorktree: (payload) => supervisorClient.call("gitAddWorktree", payload),
        sendThreadCommand: (command) => {
          if (!mainWindow) return false;
          mainWindow.webContents.send(IPC_EVENT_CHANNELS.remoteThreadCommand, command);
          return true;
        },
        ensureHomeProject: ensureHomeProjectRow,
        getProject: dbGetProject,
        getSharedSettings: () => readSharedSettingsFile(requireAgentEmployeePaths().settingsPath),
        getEmployee: (employeeId) => {
          const workspace = readSharedSettingsFile(
            requireAgentEmployeePaths().settingsPath,
          ).workspaces?.find((candidate) => candidate.id === employeeId);
          if (!workspace) return null;
          return {
            id: workspace.id,
            name: workspace.name,
            agentKind: workspace.agentKind,
            agentInstanceId: workspace.agentInstanceId,
            model: workspace.defaultThreadConfig?.model,
            effort: workspace.defaultThreadConfig?.effort,
            fast: workspace.defaultThreadConfig?.fast,
          };
        },
        upsertThread: dbUpsertThread,
        deleteThread: dbDeleteThread,
        threadExists: (threadId) => dbGetThread(threadId) != null,
        upsertTask: dbUpsertTask,
        setTaskAwaiting: (taskId, awaiting) =>
          dbSetTaskAwaiting(taskId, awaiting, new Date().toISOString()),
        insertRun: dbInsertTaskRun,
        updateRun: dbUpdateTaskRun,
      });
      taskRunCoordinator = taskCoordinator;
      const taskService: TasksService = createDeviceTaskService({
        runTask: (task) => taskCoordinator.runTaskAsThread(task),
        cancelRun: async (taskId) => {
          await taskCoordinator.cancelRun(taskId);
        },
        onStartupInterrupted: (taskId) => dbInterruptTaskRuns(taskId, new Date().toISOString()),
      });
      const taskDraftsService: TaskDraftsService = createDeviceTaskDraftsService();
      const emitRemoteThreadCommand = (command: RemoteThreadCommand): boolean => {
        if (!mainWindow) return false;
        mainWindow.webContents.send(IPC_EVENT_CHANNELS.remoteThreadCommand, command);
        return true;
      };
      const publishProjectsChanged = (): void => {
        const projects = dbGetProjects();
        remoteAccessController?.getServer()?.publishSupervisorEvent({
          type: "remote-projects-changed",
          projects: remoteProjectCommandResultSchema.parse({ projects }).projects,
        });
        mainWindow?.webContents.send(IPC_EVENT_CHANNELS.projectStateChanged, { projects });
      };
      const sharedAppControlsDeps = buildSharedAppControlsIngressDeps({
        call: (name, payload) => supervisorClient.call(name, payload),
        sendThreadCommand: emitRemoteThreadCommand,
        getSharedSettings: () => readSharedSettingsFile(requireAgentEmployeePaths().settingsPath),
        publishProjectsChanged,
      });
      prWatchService = createDevicePrWatchService({
        getProject: dbGetProject,
        getPrForBranch: (project, branch) =>
          supervisorClient.call("ghGetPrForBranch", {
            projectLocation: project.location,
            branch,
          }),
        getPrDetails: (project, prNumber) =>
          supervisorClient
            .call("ghGetPrDetails", { projectLocation: project.location, prNumber })
            .then((result) => result.details),
        getPrReviewThreads: (project, prNumber) =>
          supervisorClient
            .call("ghGetPrReviewComments", { projectLocation: project.location, prNumber })
            .then((result) => result.threads),
        getMergeMethod: () =>
          readSharedSettingsFile(requireAgentEmployeePaths().settingsPath).prMergeMethod,
        mergePr: (project, prNumber, method) =>
          supervisorClient.call("ghMergePr", {
            projectLocation: project.location,
            prNumber,
            method,
            admin: false,
          }),
        onPrMerged: (mergedWatch) =>
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.prWatchMerged, {
            projectId: mergedWatch.projectId,
            prNumber: mergedWatch.prNumber,
            ...(mergedWatch.worktreePath ? { worktreePath: mergedWatch.worktreePath } : {}),
          }),
        onPrObserved: (observedWatch, pr, details) => {
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.prWatchStatus, {
            projectId: observedWatch.projectId,
            prNumber: observedWatch.prNumber,
            headBranch: observedWatch.headBranch,
            ...(observedWatch.worktreePath ? { worktreePath: observedWatch.worktreePath } : {}),
            pr,
            ...(details ? { details } : {}),
          } satisfies PrWatchStatusEvent);
          // Paired remote clients read PR state from the git-state snapshot, not
          // this IPC channel, so hand the same observation to the service that
          // publishes their patches.
          gitStateService?.applyObservedPullRequest(observedWatch, pr, details);
        },
        createThread: sharedAppControlsDeps.createThread,
        isThreadActive: (threadId) => {
          const status = dbGetThread(threadId)?.status;
          return status !== undefined && isThreadTurnActive(status);
        },
        ...buildPrWatchExecutionDeps({
          call: (name, payload) => supervisorClient.call(name, payload),
          getSharedSettings: () => readSharedSettingsFile(requireAgentEmployeePaths().settingsPath),
        }),
      });
      gitStateService = new GitStateService({
        hostId: readOrCreateRemoteAccessIdentity(paths.baseDir).desktopId,
        executor: createGitStateExecutor((name, payload) => supervisorClient.call(name, payload)),
        getProject: dbGetProject,
        onPatch: (patch) => {
          remoteAccessController?.getServer()?.publishSupervisorEvent({
            type: "remote-git-state",
            patch,
          });
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.gitStateChanged, patch);
        },
      });
      appControlsMcpIngress = new AppControlsMcpIngress({
        taskService,
        getThread: dbGetThread,
        getThreads: dbGetThreads,
        getProjects: dbGetProjects,
        getProject: dbGetProject,
        getProjectNotes: dbGetProjectNotes,
        ...sharedAppControlsDeps,
        settings: {
          read: () => readSharedSettingsFile(requireAgentEmployeePaths().settingsPath),
          write: (next) => {
            writeSharedSettingsFile(requireAgentEmployeePaths().settingsPath, next);
            updatePowerSaveBlocker();
            handleSharedSettingsChanged(next);
            mainWindow?.webContents.send(IPC_EVENT_CHANNELS.sharedSettingsChanged, next);
          },
        },
        getAppInfo: () => ({
          version: app.getVersion(),
          platform: process.platform,
          hasRendererWindow: mainWindow !== null && !mainWindow.isDestroyed(),
        }),
        supervisor: createAppControlsSupervisorCaller((name, payload) =>
          supervisorClient.call(name, payload),
        ),
        emitRemoteThreadCommand,
        deleteThread: dbDeleteThread,
        // The desktop always has (or ensures) a main window to open into.
        openThreadInUi: (threadId) => {
          openThreadFromTray(threadId);
          return true;
        },
        notifyUser: ({ title, body, threadId }) => {
          const delivered = showOsNotification({ title, body, threadId }, () => mainWindow);
          return delivered
            ? { delivered: true }
            : {
                delivered: false,
                note: "The operating system did not show the notification (notifications may be unsupported or disabled).",
              };
        },
        checkForUpdate: async () => {
          await autoUpdaterController.checkForUpdate();
          const status = autoUpdaterController.getStatus();
          const availableVersion =
            status && (status.type === "update-available" || status.type === "downloaded")
              ? status.version
              : undefined;
          return {
            supported: true,
            currentVersion: app.getVersion(),
            ...(status ? { status: status.type } : {}),
            ...(availableVersion ? { availableVersion } : {}),
            note: "A background update check was triggered; its result surfaces in the app's update UI. status/availableVersion reflect the most recent known check, which may predate this call.",
          };
        },
      });

      knowledgeMcpIngress = new KnowledgeMcpIngress({ requireAgentEmployeePaths });

      const autoUpdaterController = createAutoUpdaterController(
        (status) => {
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.updateStatus, status);
        },
        channel,
        isDev,
        captureMainException,
        () => {
          isQuitting = true;
        },
      );

      browserPanelManager = new BrowserPanelManager(paths, browserUserAgent, {
        isExtracted: () => browserExtractWindow !== null && !browserExtractWindow.isDestroyed(),
        focusExtractedWindow: focusBrowserExtractWindow,
      });
      browserMcpIngress = new BrowserMcpIngress();
      browserMcpIngress.setManagerAccessor(() => browserPanelManager);
      // External-Chrome control: a localhost WS bridge the companion extension
      // connects to, plus a `chrome` MCP ingress agents reach the same way as the
      // embedded `browser` server. They live side by side.
      chromeBridgeServer = new ChromeBridgeServer({
        pairingFilePath: join(paths.baseDir, "chrome-bridge.json"),
      });
      chromeMcpIngress = new ChromeMcpIngress();
      chromeMcpIngress.setConnectionAccessor(() => chromeBridgeServer?.getConnection() ?? null);
      primeBrowserAllowFlags(initialSettings);
      const mcpInfoReady = browserMcpIngress.start().catch((err) => {
        console.error("[agentemployee] browser MCP ingress failed to start:", err);
        return null;
      });
      const chromeMcpReady = chromeMcpIngress.start().catch((err) => {
        console.error("[agentemployee] chrome MCP ingress failed to start:", err);
        return null;
      });
      const appControlsMcpReady = appControlsMcpIngress.start().catch((err) => {
        console.error("[agentemployee] app controls MCP ingress failed to start:", err);
        return null;
      });
      const knowledgeMcpReady = knowledgeMcpIngress.start().catch((err) => {
        console.error("[agentemployee] knowledge MCP ingress failed to start:", err);
        return null;
      });
      chromeBridgeServer.start().catch((err) => {
        console.error("[agentemployee] chrome bridge server failed to start:", err);
      });
      const computerUseHelperRoot = app.isPackaged
        ? join(process.resourcesPath, "computer-use-helper")
        : join(
            __dirname,
            "..",
            "..",
            "resources",
            isDev ? "computer-use-helper-dev" : "computer-use-helper",
          );
      // Windows and macOS keep a legacy in-process driver, so they stay
      // supported even without a staged helper. Everywhere else the helper is
      // the only backend: with no binary for this platform/arch the ingress
      // would advertise tools that all fail and would still inject a token into
      // every agent launch, so skip it entirely and let resolveExtraEnv yield
      // nothing because getInfo() stays null.
      const computerUseSupported =
        process.platform === "win32" ||
        process.platform === "darwin" ||
        resolveComputerUseHelperBinaryPath(computerUseHelperRoot) !== null;
      let computerUseMcpInfoReady: Promise<ComputerUseMcpIngressInfo | null> =
        Promise.resolve(null);
      if (computerUseSupported) {
        computerUseDesktopOverlay = new ComputerUseDesktopOverlay({
          onActivityState: (state) => {
            computerUseWakeLock.setSessionActive(state.level !== "hidden");
          },
          onExit: (threadIds) => {
            computerUseMcpIngress?.interruptActiveActions(threadIds);
            for (const threadId of threadIds) {
              void supervisorClient.call("interruptThread", { threadId }).catch((error) => {
                console.error(
                  `[agentemployee] failed to interrupt computer-use thread ${threadId}:`,
                  error,
                );
              });
            }
          },
        });
        computerUseMcpIngress = new ComputerUseMcpIngress({
          driverOptions: {
            helperRootDir: computerUseHelperRoot,
            stateDir: join(app.getPath("userData"), "computer-use"),
            warn: (message) => console.warn(`[agentemployee] ${message}`),
          },
          onActivity: (event) => computerUseDesktopOverlay?.setActivity(event),
          isDisplayKeptAwake: () => computerUseWakeLock.isHeld(),
        });
        computerUseMcpInfoReady = computerUseMcpIngress.start().catch((err) => {
          console.error("[agentemployee] computer use MCP ingress failed to start:", err);
          return null;
        });
      }

      const controller = createDesktopRemoteAccessController({
        appVersion: app.getVersion(),
        channel,
        paths,
        ...(process.env.VITE_DEV_SERVER_URL
          ? { devServerUrl: process.env.VITE_DEV_SERVER_URL }
          : {}),
        callSupervisor: (name, payload) => supervisorClient.call(name, payload),
        dispatchThreadCommand: (command) => {
          if (!mainWindow) return false;
          mainWindow.webContents.send(IPC_EVENT_CHANNELS.remoteThreadCommand, command);
          return true;
        },
        getBrowserPanelManager: () => browserPanelManager,
        notifySharedSettingsChanged: (settings) => {
          updatePowerSaveBlocker();
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.sharedSettingsChanged, settings);
        },
        notifyRemoteAccessPairingChanged: (info) => {
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.remoteAccessPairingChanged, info);
        },
        notifyProjectStateChanged: (projects) => {
          mainWindow?.webContents.send(IPC_EVENT_CHANNELS.projectStateChanged, { projects });
        },
        reportError: captureMainException,
        prWatchService,
        gitStateService,
        updates: {
          currentVersion: () => app.getVersion(),
          status: () => autoUpdaterController.getStatus(),
          check: () => autoUpdaterController.checkForUpdate(),
          install: () => autoUpdaterController.installUpdate(),
        },
      });
      remoteAccessController = controller;

      quickComposerShortcutManager = new QuickComposerShortcutManager(
        globalShortcut,
        process.platform,
        toggleQuickComposerWindow,
        (accelerator) => {
          tray?.setQuickComposerShortcut(accelerator);
          if (accelerator) {
            console.log(`[agentemployee] registered ${accelerator} for quick composer`);
          }
        },
      );
      try {
        quickComposerShortcutManager.apply(
          readKeybindingsFile(requireAgentEmployeePaths().keybindingsPath).file,
        );
      } catch (error) {
        console.warn("[agentemployee] failed to register the quick composer shortcut", error);
      }

      registerIpcHandlers({
        localHandlers: createLocalIpcHandlers({
          getMainWindow: () => mainWindow,
          getPetWindow: () => petWindow,
          getBrowserPanelManager: () => browserPanelManager,
          getRemoteAccessServer: controller.getServer,
          setRemoteAccessEnabled: controller.setEnabled,
          getRemoteAccessTailscaleStatus: controller.getTailscaleStatus,
          setRemoteAccessTailscaleHttps: controller.setTailscaleHttps,
          startTailscale: controller.startTailscale,
          setRemoteAccessAdvertisedUrl: controller.setAdvertisedUrl,
          sshConnectionManager,
          requireAgentEmployeePaths,
          legacyElectronUserDataDir,
          ...(legacyBaseDirOverride ? { legacyBaseDir: legacyBaseDirOverride } : {}),
          updatePowerSaveBlocker,
          autoUpdater: autoUpdaterController,
          onSharedSettingsChanged: handleSharedSettingsChanged,
          onKeybindingsChanged: (file) => quickComposerShortcutManager?.apply(file),
          setGlobalShortcutsSuspended: (suspended) => globalShortcut.setSuspended(suspended),
          onRemoteGitSummaries: controller.updateGitSummaries,
          extractBrowserToWindow,
          injectBrowserToMain,
          requestRelaunch: () => {
            isQuitting = true;
            app.relaunch();
            app.quit();
          },
          tasksService: taskService,
          taskDraftsService,
          prWatchService,
        }),
        callSupervisor: (name, payload) => supervisorClient.call(name, payload),
      });

      ipcMain.handle(IPC_WINDOW_CHANNELS.quickComposerSubmit, (event, payload: unknown) => {
        const overlay = quickComposerWindowFor(event);
        if (!overlay) return;
        const submission = quickComposerSubmissionSchema.parse(payload);
        pendingQuickComposerSubmissions.push(submission);
        revealMainAfterQuickComposerDismiss = true;
        ensureMainWindow(false);
        flushQuickComposerSubmissions();
        if (quickComposerDismissTimer) clearTimeout(quickComposerDismissTimer);
        quickComposerDismissTimer = setTimeout(() => finishQuickComposerDismiss(overlay), 800);
      });
      ipcMain.handle(IPC_WINDOW_CHANNELS.quickComposerDismiss, (event) => {
        const overlay = quickComposerWindowFor(event);
        if (overlay) finishQuickComposerDismiss(overlay);
      });
      ipcMain.handle(IPC_WINDOW_CHANNELS.quickComposerPickFiles, async (event) => {
        const overlay = quickComposerWindowFor(event);
        if (!overlay) return null;
        quickComposerDialogOpen = true;
        const wasVisible = overlay.isVisible();
        try {
          return await showAddFilesDialog(overlay);
        } finally {
          quickComposerDialogOpen = false;
          if (wasVisible && !overlay.isDestroyed()) showQuickComposerWindow(overlay);
        }
      });
      ipcMain.handle(IPC_WINDOW_CHANNELS.quickComposerMainReady, (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window !== mainWindow || window.isDestroyed()) return;
        mainRendererReady = true;
        flushQuickComposerSubmissions();
        flushTrayThreadOpen();
      });
      ipcMain.handle(IPC_WINDOW_CHANNELS.rendererReload, (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) requestTrackedRendererReload(window);
      });

      const initialMainWindow = ensureMainWindow(showMainWindowOnReady);

      // The pet is resident from launch so the user can always click it.
      petWindow = createPetAppWindow();

      // Start the task-inbox watcher from on-disk settings; settings writes
      // restart it via handleSharedSettingsChanged.
      try {
        restartTaskInboxWatcher(readSharedSettingsFile(requireAgentEmployeePaths().settingsPath));
      } catch (error) {
        console.warn("[agentemployee] failed to start task inbox watcher:", error);
      }

      tray = createTray({
        channel,
        appName: getAppName(channel, isDev),
        getProjects: dbGetProjects,
        getThreads: dbGetThreads,
        onOpenThread: openThreadFromTray,
        onShow: () => showAndFocusWindow(ensureMainWindow()),
        onQuickComposer: toggleQuickComposerWindow,
        // The pet ball can be hidden from its context menu; the tray is the
        // always-available restore path for the chief-steward surface.
        onShowPet: () => {
          // Rebuild on demand: the tray is the only manual restore path, so it
          // must work even when the window is gone rather than silently no-op.
          showPetWindow(ensurePetWindow());
        },
        onQuit: () => {
          isQuitting = true;
          app.quit();
        },
      });
      tray.setQuickComposerShortcut(quickComposerShortcutManager.active[0] ?? null);
      onProjectThreadDataChanged(() => tray?.refreshMenu());

      await jobObjectReady;

      const hookDebugOn =
        Boolean(process.env.AGENTEMPLOYEE_HOOK_DEBUG) &&
        process.env.AGENTEMPLOYEE_HOOK_DEBUG !== "0";
      if (hookDebugOn) {
        console.log(
          "[agentemployee] AGENTEMPLOYEE_HOOK_DEBUG is on — watch for [supervisor] hook-debug lines (HookIngress, WSL bridge, L1/L2 spawn, envelopes).",
        );
      }

      await Promise.all([
        mcpInfoReady,
        chromeMcpReady,
        computerUseMcpInfoReady,
        appControlsMcpReady,
        knowledgeMcpReady,
      ]);
      supervisorClient.start(paths.baseDir);
      taskService.start();
      prWatchService.start();
      gitStateService.start();
      // The remote controller performs one bounded warm-up when enabled.
      // Recurring Git refreshes remain demand-driven by connected clients.

      updatePowerSaveBlocker();
      void controller.startIfEnabled();

      initialMainWindow.once("ready-to-show", () => {
        setTimeout(() => {
          const attachmentPaths = requireAgentEmployeePaths();
          cleanupOrphanedAttachments(
            attachmentPaths.attachmentsDir,
            dbGetThreads().map((thread) => thread.id),
          );
        }, 0);
      });

      if (!isDev) {
        autoUpdaterController.initialize();
      }

      if (isDev) {
        let debounce: ReturnType<typeof setTimeout> | null = null;
        watch(supervisorPath, () => {
          if (debounce) {
            clearTimeout(debounce);
          }
          debounce = setTimeout(() => {
            console.log("[agentemployee] supervisor changed, restarting…");
            supervisorClient.start(requireAgentEmployeePaths().baseDir);
          }, 200);
        });
      }

      app.on("activate", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          showAndFocusWindow(mainWindow);
          return;
        }
        ensureMainWindow();
      });

      // Recorded on `before-quit` (registered at module scope), torn down on
      // `will-quit`: a quit can still be aborted while it is being negotiated, so
      // destroying the tray, the pet and the services here could strand the app
      // with no way back if the quit never completed.
      disposeAppResources = () => {
        isQuitting = true;
        clearPetWindowRecreateTimer();
        quickComposerShortcutManager?.dispose();
        quickComposerShortcutManager = null;
        if (quickComposerDismissTimer) clearTimeout(quickComposerDismissTimer);
        quickComposerDismissTimer = null;
        pendingQuickComposerSubmissions.length = 0;
        taskService.dispose();
        prWatchService.dispose();
        gitStateService.dispose();
        supervisorClient.dispose();
        windowsJobObjectManager?.dispose();
        windowsJobObjectManager = null;
        browserMcpIngress?.dispose();
        browserMcpIngress = null;
        computerUseMcpIngress?.dispose();
        computerUseMcpIngress = null;
        appControlsMcpIngress?.dispose();
        appControlsMcpIngress = null;
        knowledgeMcpIngress?.dispose();
        knowledgeMcpIngress = null;
        computerUseDesktopOverlay?.dispose();
        computerUseDesktopOverlay = null;
        computerUseWakeLock.dispose();
        chromeMcpIngress?.dispose();
        chromeMcpIngress = null;
        chromeBridgeServer?.dispose();
        chromeBridgeServer = null;
        void controller.dispose();
        void sshConnectionManager.dispose();
        browserExtractWindow?.close();
        browserExtractWindow = null;
        quickComposerWindow?.close();
        quickComposerWindow = null;
        petWindow?.close();
        petWindow = null;
        taskInboxWatcher?.stop();
        taskInboxWatcher = null;
        browserPanelManager?.dispose();
        browserPanelManager = null;
        sleepInhibitor.dispose();
        tray?.destroy();
        tray = null;
      };
    })
    .catch((error: unknown) => {
      console.error("[agentemployee] failed to initialize:", error);
      captureMainException(error, { "agentemployee.feature_area": "main-initialization" });
      app.quit();
    });
}

// The quit intent is recorded here, before anything else can request a quit
// (a failed startup calls `app.quit()` too). `closeToTray` makes the main window
// cancel its own close, so a quit that arrives while the app is still
// initializing would otherwise be swallowed — leaving a half-initialized app
// running with no tray, no pet window and no way to bring either back.
app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  // Only now is the quit certain, so this is where the app is torn down.
  disposeAppResources?.();
  disposeAppResources = null;
  closeDatabase();
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin" || tray?.available) return;
  app.quit();
});

/**
 * Log Chromium child-process crashes (GPU / utility / …). On an unusual host
 * (e.g. Windows 7 behind a Win10-API compatibility layer) a missing or mis-shimmed
 * API surfaces as one of these; without this hook the process just disappears and
 * the only trace is an OS crash dialog — which names the shared `AgentEmployee.exe`
 * image for *every* Electron process, so it cannot say which one died. `details`
 * carries the process type, the reason, and the platform exit code, which is what
 * actually attributes the crash.
 */
app.on("child-process-gone", (_event, details) => {
  const parts = [`type=${details.type}`, `reason=${details.reason}`];
  if (typeof details.exitCode === "number") {
    parts.push(`exitCode=${details.exitCode} (0x${(details.exitCode >>> 0).toString(16)})`);
  }
  if (details.serviceName) parts.push(`service=${details.serviceName}`);
  console.error(`[agentemployee] child process gone: ${parts.join(" ")}`);
});
