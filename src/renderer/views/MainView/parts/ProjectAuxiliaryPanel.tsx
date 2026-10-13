import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { isHomeProjectId } from "@/shared/homeScope";
import { resolveProjectLocation } from "@/shared/worktree";
import {
  productSurfaceView,
  useProductViewTracking,
} from "@/renderer/analytics/useProductViewTracking";
import { BrowserDockSlot } from "@/renderer/views/MainView/parts/RightPanel/parts/BrowserPanel/BrowserDockSlot";
import {
  extractBrowserToWindow,
  injectBrowserToMain,
} from "@/renderer/views/MainView/parts/RightPanel/parts/BrowserPanel/browserWindowActions";
import { DevTerminalPanel } from "@/renderer/views/MainView/parts/RightPanel/parts/DevTerminalPanel/DevTerminalPanel";
import {
  UnifiedRightPanel,
  type RightPanelTab,
} from "@/renderer/components/layout/UnifiedRightPanel";
import { ProjectFilesPanel } from "@/renderer/views/FileEditorOverlay/parts/ProjectFilesPanel";
import { NotesPanel } from "@/renderer/views/MainView/parts/RightPanel/parts/NotesPanel/NotesPanel";
import { UsagePanel } from "@/renderer/views/MainView/parts/RightPanel/parts/UsagePanel/UsagePanel";
import { UsagePanelHeaderActions } from "@/renderer/views/MainView/parts/RightPanel/parts/UsagePanel/parts/UsagePanelHeaderActions";
import { SubAgentContent, SubAgentHeaderText } from "@/renderer/components/thread/ChatPane/parts/items/SubAgentOverlay";
import { useAvailableScenarioPanel } from "@/renderer/scenarios/scenarioPanelRegistry";
import { useAppStore } from "@/renderer/state/appStore";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { useFileEditorStore, type FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { usePanelStore, type GitReviewContext } from "@/renderer/state/panelStore";
import { watchRemoteTerminal } from "@/renderer/state/remoteTerminalFeed";
import { prefetchVisibleGitPanelPrData } from "@/renderer/state/gitRefresh";
import {
  closeAllPanels,
  showFilesPanel,
  showGitReviewPanel,
  undockPanelTab,
} from "@/renderer/actions/panelActions";
import { showTerminalPanel } from "@/renderer/actions/terminalActions";
import { getCurrentProjectId } from "@/renderer/actions/currentProject";
import { selectFocusedThreadId, useFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { syncRightPanelTabToFocusedThread } from "@/renderer/hooks/useRightPanelThreadLock";
import { formatProjectScopeLabel } from "@/renderer/utils/projectScopeLabel";
import { useBottomDockedTabs } from "@/renderer/state/panelDockSelectors";
import { GitReviewPanelContent } from "./RightPanel/parts/GitReviewPanelContent";
import { DocumentPreviewPanel } from "./RightPanel/parts/DocumentPreviewPanel/DocumentPreviewPanel";
import { resolveFilesRootContext } from "./RightPanel/parts/resolveFilesRootContext";

interface PanelProjectScope {
  projectId: string;
  worktreePath?: string;
}

function scopeFromGitContext(context: GitReviewContext | null): PanelProjectScope | null {
  if (!context) return null;
  return {
    projectId: context.projectId,
    ...(context.worktreePath ? { worktreePath: context.worktreePath } : {}),
  };
}

function scopeFromFilesContext(context: FileEditorRootContext | null): PanelProjectScope | null {
  if (!context) return null;
  return {
    projectId: context.projectId,
    ...(context.worktreePath ? { worktreePath: context.worktreePath } : {}),
  };
}

export function ProjectAuxiliaryPanel(props: { includeTerminal: boolean; visible: boolean }) {
  const { t } = useLingui();
  const projects = useAppStore((s) => s.projects);
  const gitReviewContext = usePanelStore((s) => s.gitReviewContext);
  const gitReviewAsPanel = usePanelStore((s) => s.gitReviewAsPanel);
  const filesPanelContext = usePanelStore((s) => s.filesPanelContext);
  const subAgentPanelContext = usePanelStore((s) => s.subAgentPanelContext);
  const rightPanelTab = usePanelStore((s) => s.rightPanelTab);
  const rightPanelSplit = usePanelStore((s) => s.rightPanelSplit);
  const bottomDocks = useBottomDockedTabs();
  const dockedTabs = [bottomDocks.left, bottomDocks.right].filter(
    (tab): tab is RightPanelTab => tab !== null,
  );
  const isBottomDocked = (tab: RightPanelTab) => dockedTabs.includes(tab);
  const setRightPanelTab = usePanelStore((s) => s.setRightPanelTab);
  const rightPanelFollowsThread = usePanelStore((s) => s.rightPanelFollowsThread);
  const toggleRightPanelFollowsThread = usePanelStore((s) => s.toggleRightPanelFollowsThread);
  const browserPanelOpen = usePanelStore((s) => s.browserPanelOpen);
  const browserExtracted = useBrowserPanelStore((s) => s.extracted);
  const usagePanelOpen = usePanelStore((s) => s.usagePanelOpen);
  const setUsagePanelOpen = usePanelStore((s) => s.setUsagePanelOpen);
  const notesPanelOpen = usePanelStore((s) => s.notesPanelOpen);
  const setNotesPanelOpen = usePanelStore((s) => s.setNotesPanelOpen);
  const documentPreviewContext = usePanelStore((s) => s.documentPreviewContext);
  const documentPanelOpen = usePanelStore((s) => s.documentPanelOpen);
  const setDocumentPanelOpen = usePanelStore((s) => s.setDocumentPanelOpen);
  // Reactive id of the project the notes panel should show — recomputed (and
  // re-rendered) as the user navigates between threads/drafts/projects.
  const currentProjectId = useAppStore(() => getCurrentProjectId());
  const setBrowserPanelOpen = usePanelStore((s) => s.setBrowserPanelOpen);
  const setBrowserOverlayOpen = usePanelStore((s) => s.setBrowserOverlayOpen);
  const setBrowserOverlayMaximized = usePanelStore((s) => s.setBrowserOverlayMaximized);
  const setGitReviewContext = usePanelStore((s) => s.setGitReviewContext);
  const setGitOverlayOpen = usePanelStore((s) => s.setGitOverlayOpen);
  const setFileEditorOverlayMode = useFileEditorStore((s) => s.setOverlayMode);
  const terminalOpen = useDevTerminalStore((s) => s.isOpen);
  const terminalProjectId = useDevTerminalStore((s) => s.activeProjectId);
  const terminalWorktreePath = useDevTerminalStore((s) => s.activeWorktreePath);
  const terminalProject = projects.find((project) => project.id === terminalProjectId);
  const currentThreadId = useFocusedThreadId();
  const currentThread = useAppStore((state) =>
    currentThreadId ? state.threads.find((thread) => thread.id === currentThreadId) : undefined,
  );
  const currentThreadProject = currentThread
    ? projects.find((project) => project.id === currentThread.projectId)
    : undefined;
  const currentThreadProjectLocation =
    currentThread && currentThreadProject
      ? resolveProjectLocation(currentThreadProject.location, currentThread.worktreePath)
      : undefined;
  // The scenario-panel registry resolves (and polls for) whichever declared
  // panel is available for the focused project. Shared panel hosts never name a
  // concrete scenario.
  const scenarioPanel = useAvailableScenarioPanel(
    currentThreadProject?.id,
    currentThreadProjectLocation,
  );
  // Auto-focus the scenario tab the first time its panel becomes available
  // (once per project+panel), without yanking focus back after the user leaves.
  const autoOpenedScenarioRef = useRef<string | null>(null);
  useEffect(() => {
    const panelId = scenarioPanel?.id;
    const projectId = currentThreadProject?.id;
    if (!panelId || !projectId) return;
    const key = `${projectId}:${panelId}`;
    if (autoOpenedScenarioRef.current === key) return;
    autoOpenedScenarioRef.current = key;
    setRightPanelTab("scenario");
  }, [scenarioPanel?.id, currentThreadProject?.id, setRightPanelTab]);
  // The informational docks (goal/plan/agents/background tasks) and the image
  // gallery live in the floating top-right task panel, so the auxiliary
  // panel's Docks tab is retired: it never activates and never hosts them.
  const docksInCurrentThread = false;
  const docksTabAvailable = false;

  const gitPanelOpen = !!gitReviewContext && gitReviewAsPanel;
  const filesPanelOpen = filesPanelContext !== null;
  const subAgentItemExists = useAppStore((state) =>
    subAgentPanelContext
      ? state.runtimeItemsByIdByThread[subAgentPanelContext.threadId]?.[
          subAgentPanelContext.parentItemId
        ] !== undefined
      : false,
  );
  const subAgentInCurrentThread =
    subAgentPanelContext !== null &&
    subAgentPanelContext.threadId === currentThreadId &&
    subAgentItemExists;

  // Last-non-null context holders. They derive from store state during
  // render, so they are `useState` snapshots adjusted during render — never
  // refs written during render. (Change *detection* for the sync effect below
  // lives in that effect's own ref so the adopting commit still observes it.)
  const [lastGitPanelContext, setLastGitPanelContext] = useState(gitReviewContext);
  if (gitReviewContext && gitReviewAsPanel && lastGitPanelContext !== gitReviewContext) {
    setLastGitPanelContext(gitReviewContext);
  }
  const gitPanelContext = gitPanelOpen ? gitReviewContext : lastGitPanelContext;

  const [lastFilesPanelContext, setLastFilesPanelContext] = useState(filesPanelContext);
  if (filesPanelContext && lastFilesPanelContext !== filesPanelContext) {
    setLastFilesPanelContext(filesPanelContext);
  }
  const rawFilesPanelContext = filesPanelOpen ? filesPanelContext : lastFilesPanelContext;
  const resolvedFilesPanelContext = resolveFilesRootContext(rawFilesPanelContext, projects);

  const requestedTab: RightPanelTab = props.includeTerminal
    ? rightPanelTab === "ports"
      ? "git"
      : rightPanelTab
    : rightPanelTab === "files" ||
        rightPanelTab === "browser" ||
        rightPanelTab === "usage" ||
        rightPanelTab === "notes" ||
        rightPanelTab === "document" ||
        rightPanelTab === "docks" ||
        rightPanelTab === "subagent" ||
        rightPanelTab === "scenario"
      ? rightPanelTab
      : "git";

  function requestedTabIsAvailable(): boolean {
    // A bottom-docked tab already renders in the bottom row.
    if (isBottomDocked(requestedTab)) return false;
    if (requestedTab === "subagent") return subAgentInCurrentThread;
    if (requestedTab === "docks") return docksTabAvailable;
    // The browser panel is dismissed out-of-band when its last tab closes (the
    // browser sync clears browserPanelOpen but leaves rightPanelTab pointing at
    // "browser"), so it must honor its open flag even when no plan is present —
    // otherwise the panel stays open on an empty browser layer.
    if (requestedTab === "browser") return browserPanelOpen;
    // The document tab honors its open flag (like browser): the tracked
    // document persists so it can be reopened after the panel is dismissed.
    if (requestedTab === "document") return documentPanelOpen && documentPreviewContext !== null;
    if (requestedTab === "scenario") return scenarioPanel !== null;
    if (!docksInCurrentThread) return true;
    if (requestedTab === "terminal") return terminalOpen;
    if (requestedTab === "files") return filesPanelOpen;
    if (requestedTab === "git") return gitPanelOpen;
    if (requestedTab === "usage") return usagePanelOpen;
    return requestedTab === "notes" && notesPanelOpen;
  }

  function fallbackActiveTab(): RightPanelTab {
    if (docksInCurrentThread) return "docks";
    if (subAgentInCurrentThread) return "subagent";
    if (filesPanelOpen && !isBottomDocked("files")) return "files";
    if (gitPanelOpen && !isBottomDocked("git")) return "git";
    if (browserPanelOpen && !isBottomDocked("browser")) return "browser";
    if (usagePanelOpen && !isBottomDocked("usage")) return "usage";
    if (notesPanelOpen && !isBottomDocked("notes")) return "notes";
    if (documentPanelOpen && documentPreviewContext && !isBottomDocked("document"))
      return "document";
    if (props.includeTerminal && terminalOpen) return "terminal";
    // Last-resort: don't steal focus from a real tab, but offer the scenario
    // panel when nothing else is available.
    if (scenarioPanel && !isBottomDocked("scenario")) return "scenario";
    return "git";
  }

  const activeTab = requestedTabIsAvailable() ? requestedTab : fallbackActiveTab();
  // Tracks the last git context this sync observed (null initially, so a
  // context present on mount counts as an explicit target and wins). Read and
  // written only inside the effect — never during render.
  const prevGitReviewContextRef = useRef<GitReviewContext | null>(null);
  useEffect(() => {
    if (!props.visible) return;
    // A new git context is an explicit target (for example, clicking thread
    // B's badge while thread A is focused). Let that open win; the follow
    // lock will take over again on the next thread or tab change.
    const gitReviewContextChanged = prevGitReviewContextRef.current !== gitReviewContext;
    prevGitReviewContextRef.current = gitReviewContext;
    let refreshTimer: number | undefined;
    const frame = requestAnimationFrame(() => {
      if (rightPanelFollowsThread && (activeTab !== "git" || !gitReviewContextChanged)) {
        syncRightPanelTabToFocusedThread(activeTab);
      }
      if (activeTab !== "git") return;

      // Let the thread and linked-panel frames paint before paying for PR I/O.
      // The prefetch itself gates on gh availability + GitHub remote, and also
      // throttles and deduplicates per project.
      refreshTimer = window.setTimeout(() => {
        const app = useAppStore.getState();
        if (selectFocusedThreadId(app) !== currentThreadId) return;
        const thread = app.threads.find((item) => item.id === currentThreadId);
        if (!thread || isHomeProjectId(thread.projectId)) return;
        void prefetchVisibleGitPanelPrData(thread.projectId, thread.worktreePath);
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [activeTab, currentThreadId, gitReviewContext, props.visible, rightPanelFollowsThread]);
  useProductViewTracking(productSurfaceView(activeTab, "panel"), "panel", {
    active: props.visible,
    finishWhenInactive: true,
  });

  const gitScope = scopeFromGitContext(gitPanelContext);
  const filesScope = scopeFromFilesContext(resolvedFilesPanelContext);
  const documentScope: PanelProjectScope | null = documentPreviewContext
    ? {
        projectId: documentPreviewContext.projectId,
        ...(documentPreviewContext.worktreePath
          ? { worktreePath: documentPreviewContext.worktreePath }
          : {}),
      }
    : null;
  const terminalScope: PanelProjectScope | null = terminalProjectId
    ? {
        projectId: terminalProjectId,
        ...(terminalWorktreePath ? { worktreePath: terminalWorktreePath } : {}),
      }
    : null;

  function fallbackScope(): PanelProjectScope | null {
    const firstProject = projects[0];
    return firstProject ? { projectId: firstProject.id } : null;
  }

  function activeProjectScope(): PanelProjectScope | null {
    if (activeTab === "terminal") return terminalScope ?? filesScope ?? gitScope;
    if (activeTab === "document") return documentScope ?? filesScope ?? gitScope;
    if (activeTab === "files") return filesScope ?? gitScope ?? terminalScope;
    if (activeTab === "git") return gitScope ?? filesScope ?? terminalScope;
    return filesScope ?? gitScope ?? terminalScope;
  }

  function projectNameForScope(scope: PanelProjectScope | null): string | undefined {
    if (!scope) return undefined;
    return projects.find((p) => p.id === scope.projectId)?.name;
  }

  const notesProjectId = currentProjectId ?? resolveNextProjectScope()?.projectId;

  function resolveProjectName(): string | undefined {
    switch (activeTab) {
      case "browser":
        return t`Browser`;
      case "usage":
        return t`Usage`;
      case "notes":
        return notesProjectId ? projectNameForScope({ projectId: notesProjectId }) : t`Notes`;
      case "document":
        return documentPreviewContext?.title ?? t`Document`;
      case "terminal": {
        const terminalProjectName = projectNameForScope(terminalScope);
        return terminalProjectName
          ? formatProjectScopeLabel(terminalProjectName, terminalWorktreePath ?? undefined)
          : undefined;
      }
      case "docks":
        return t`Thread info`;
      case "subagent":
        return undefined;
      case "files":
        return resolvedFilesPanelContext?.rootLabel ?? projectNameForScope(activeProjectScope());
      default:
        return projectNameForScope(activeProjectScope());
    }
  }
  const projectName = resolveProjectName();
  const isHomeScope = isHomeProjectId(activeProjectScope()?.projectId);

  function resolveNextProjectScope(): PanelProjectScope | null {
    return activeProjectScope() ?? fallbackScope();
  }

  /**
   * Clicking a toolbar icon always lands the tab in this panel, so a tab that
   * currently lives in the split half or the bottom row is pulled back first —
   * otherwise the click would have no visible effect.
   */
  function pressTab(tab: RightPanelTab, open: () => void) {
    undockPanelTab(tab);
    open();
  }

  function handleOpenGit() {
    const scope = resolveNextProjectScope();
    if (!scope) return;
    showGitReviewPanel(scope.projectId, scope.worktreePath);
  }

  function handleOpenFiles() {
    const scope = resolveNextProjectScope();
    if (!scope) return;
    showFilesPanel(scope.projectId, scope.worktreePath);
  }

  function handleOpenTerminal() {
    const scope = resolveNextProjectScope();
    if (!scope) return;
    showTerminalPanel(scope.projectId, scope.worktreePath);
  }

  function handleClose() {
    if (props.includeTerminal) {
      useDevTerminalStore.getState().closePanel();
    }
    closeAllPanels();
  }

  function handleCloseSubAgent() {
    usePanelStore.getState().setSubAgentPanelContext(null);
    handleClose();
  }

  // A bottom-docked tab renders in the bottom row; keep it out of this panel so
  // singleton surfaces (the browser webview) are never mounted twice.
  const renderTerminalContent = props.includeTerminal && terminalOpen;
  const renderGitContent = gitPanelOpen && !isBottomDocked("git");
  const renderFilesContent = filesPanelOpen && !isBottomDocked("files");
  const renderBrowserContent = browserPanelOpen && !isBottomDocked("browser");
  const renderUsageContent = usagePanelOpen && !isBottomDocked("usage");
  const renderNotesContent =
    notesPanelOpen && notesProjectId !== undefined && !isBottomDocked("notes");
  const renderDocksContent = docksTabAvailable;
  const renderSubAgentContent = subAgentInCurrentThread;
  const renderDocumentContent = documentPanelOpen && documentPreviewContext !== null;
  const renderScenarioContent = scenarioPanel !== null;

  return (
    <UnifiedRightPanel
      activeTab={activeTab}
      onTabChange={(tab) => {
        if (tab === "subagent" && !renderSubAgentContent) return;
        if (tab === "docks" && !renderDocksContent) return;
        if (tab === "document" && !documentPreviewContext) return;
        if (tab === "scenario" && !renderScenarioContent) return;
        pressTab(tab, () => setRightPanelTab(tab));
      }}
      {...(renderTerminalContent
        ? {
            terminalContent: (
              <DevTerminalPanel
                hideHeader
                {...(terminalProject?.remoteServerId
                  ? {
                      watchTerminal: (terminalId, listener) =>
                        watchRemoteTerminal(terminalProject.remoteServerId!, terminalId, listener),
                    }
                  : {})}
              />
            ),
          }
        : {})}
      gitContent={
        renderGitContent ? (
          <GitReviewPanelContent
            gitPanelContext={gitPanelContext}
            onClose={() => setGitReviewContext(null)}
            onExpandToOverlay={() => setGitOverlayOpen(true)}
          />
        ) : undefined
      }
      filesContent={
        renderFilesContent && resolvedFilesPanelContext ? (
          <ProjectFilesPanel rootContext={resolvedFilesPanelContext} />
        ) : undefined
      }
      browserContent={
        renderBrowserContent ? (
          <BrowserDockSlot
            extracted={browserExtracted}
            onBringBack={injectBrowserToMain}
            onFocusWindow={extractBrowserToWindow}
          />
        ) : undefined
      }
      usageContent={renderUsageContent ? <UsagePanel /> : undefined}
      {...(renderScenarioContent && scenarioPanel
        ? {
            scenarioContent: (
              <scenarioPanel.Component
                key={`${scenarioPanel.projectId}:${scenarioPanel.id}`}
                projectId={scenarioPanel.projectId}
                {...(scenarioPanel.projectLocation
                  ? { projectLocation: scenarioPanel.projectLocation }
                  : {})}
              />
            ),
            scenarioTabLabel: scenarioPanel.label,
            scenarioTabIcon: scenarioPanel.icon,
          }
        : {})}
      notesContent={
        renderNotesContent && notesProjectId ? (
          <NotesPanel key={notesProjectId} projectId={notesProjectId} />
        ) : undefined
      }
      documentContent={
        renderDocumentContent && documentPreviewContext ? (
          <DocumentPreviewPanel
            key={`${documentPreviewContext.projectId}:${documentPreviewContext.path}`}
            projectId={documentPreviewContext.projectId}
            path={documentPreviewContext.path}
            {...(documentPreviewContext.worktreePath
              ? { worktreePath: documentPreviewContext.worktreePath }
              : {})}
          />
        ) : undefined
      }
      subagentContent={
        renderSubAgentContent ? (
          <SubAgentContent
            key={`${subAgentPanelContext.threadId}:${subAgentPanelContext.parentItemId}`}
            threadId={subAgentPanelContext.threadId}
            parentItemId={subAgentPanelContext.parentItemId}
            hideHeader
            {...(subAgentPanelContext.projectLocation
              ? { projectLocation: subAgentPanelContext.projectLocation }
              : {})}
          />
        ) : undefined
      }
      usageHeaderActions={
        <UsagePanelHeaderActions dragControlClass="agentemployee-overlay-header__controls" />
      }
      showTerminalTab={props.includeTerminal}
      showFilesTab={!isHomeScope}
      showGitTab={!isHomeScope}
      showNotesTab={notesProjectId !== undefined}
      showDocumentTab={documentPreviewContext !== null}
      showDocksTab={renderDocksContent}
      showScenarioTab={renderScenarioContent}
      showSubagentTab={renderSubAgentContent}
      {...(renderSubAgentContent
        ? {
            subagentModel: (
              <SubAgentHeaderText
                threadId={subAgentPanelContext.threadId}
                parentItemId={subAgentPanelContext.parentItemId}
                compact
                part="description"
              />
            ),
            subagentTitle: (
              <SubAgentHeaderText
                threadId={subAgentPanelContext.threadId}
                parentItemId={subAgentPanelContext.parentItemId}
                compact
                part="title"
              />
            ),
            onCloseSubagent: handleCloseSubAgent,
          }
        : {})}
      projectName={projectName}
      onExpandGitToOverlay={() => setGitOverlayOpen(true)}
      onExpandFilesToOverlay={() => setFileEditorOverlayMode("fullscreen")}
      onExpandBrowserToOverlay={() => {
        setBrowserOverlayMaximized(true);
        setBrowserOverlayOpen(true);
      }}
      onExtractBrowserToWindow={extractBrowserToWindow}
      onOpenGit={() => pressTab("git", handleOpenGit)}
      onOpenFiles={() => pressTab("files", handleOpenFiles)}
      {...(props.includeTerminal
        ? { onOpenTerminal: () => pressTab("terminal", handleOpenTerminal) }
        : {})}
      onOpenBrowser={() =>
        pressTab("browser", () => {
          if (browserExtracted) {
            extractBrowserToWindow();
            return;
          }
          setBrowserPanelOpen(true);
          setRightPanelTab("browser");
        })
      }
      onOpenUsage={() =>
        pressTab("usage", () => {
          setUsagePanelOpen(true);
          setRightPanelTab("usage");
        })
      }
      onOpenNotes={() =>
        pressTab("notes", () => {
          setNotesPanelOpen(true);
          setRightPanelTab("notes");
        })
      }
      onOpenDocument={() =>
        pressTab("document", () => {
          if (!documentPreviewContext) return;
          setDocumentPanelOpen(true);
          setRightPanelTab("document");
        })
      }
      onOpenScenario={() =>
        pressTab("scenario", () => {
          if (!scenarioPanel) return;
          setRightPanelTab("scenario");
        })
      }
      followsThread={rightPanelFollowsThread}
      onToggleFollowsThread={toggleRightPanelFollowsThread}
      dockedTabs={dockedTabs}
      {...(rightPanelSplit && !isBottomDocked(rightPanelSplit.tab)
        ? {
            splitTab: rightPanelSplit.tab,
            splitPlacement: rightPanelSplit.placement,
            onCloseSplit: () => usePanelStore.getState().setRightPanelSplit(null),
          }
        : {})}
      onClose={handleClose}
    />
  );
}
