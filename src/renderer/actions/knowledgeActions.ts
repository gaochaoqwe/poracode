import type { Project } from "@/shared/contracts";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useFileEditorStore, type FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { invalidateKnowledgeBases } from "@/renderer/components/composer/useKnowledgeBases";
import { useKnowledgeBaseStore } from "@/renderer/state/knowledgeBaseStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { getCurrentProjectId } from "./currentProject";
import { showFilesPanel } from "./panelActions";
import { newThreadFromText } from "./notesActions";

export type KnowledgeSkillVerb = "ingest" | "query" | "lint";

const knowledgeLabel = msg`Knowledge Base`;
const importedSourcesLabel = msg`Newly imported sources:`;

/** The project the current view is focused on, if any (KB mode anchors its panel here). */
function activeKnowledgeProject(): Project | undefined {
  const projectId = getCurrentProjectId();
  if (!projectId) return undefined;
  return useAppStore.getState().projects.find((project) => project.id === projectId);
}

/** Point the center editor + right file panel at the active base's root. */
function applyKnowledgeLocation(): void {
  const { context, location } = useKnowledgeBaseStore.getState();
  if (!context || !location) return;
  const rootLabel = i18n._(knowledgeLabel);
  const kbRoot: FileEditorRootContext = {
    projectId: context.projectId,
    projectName: context.projectName,
    projectLocation: location.location,
    rootLabel,
  };
  useFileEditorStore.getState().setRootContext(kbRoot);
  usePanelStore.getState().setFilesPanelContext({
    projectId: context.projectId,
    projectName: context.projectName,
    rootLabel,
    projectLocation: location.location,
  });
  showFilesPanel(context.projectId);
}

/**
 * Enter knowledge-base mode: the left nav column swaps to the KB panel, and the
 * center editor + right file panel root at the active base.
 */
export function openKnowledgeBase(): void {
  void enterKnowledgeMode();
}

async function enterKnowledgeMode(): Promise<void> {
  const project = activeKnowledgeProject();
  if (!project) return;
  await useKnowledgeBaseStore.getState().enter({
    projectId: project.id,
    projectName: project.name,
  });
  applyKnowledgeLocation();
}

/** Switch the active knowledge base (updates the tree + file panel root). */
export function selectKnowledgeBase(baseId: string): void {
  void useKnowledgeBaseStore.getState().setActiveBase(baseId).then(applyKnowledgeLocation);
}

/** Create a new knowledge base and make it active. */
export async function createKnowledgeBase(name: string): Promise<void> {
  await useKnowledgeBaseStore.getState().createBase(name);
  invalidateKnowledgeBases();
  applyKnowledgeLocation();
}

export async function renameKnowledgeBase(baseId: string, name: string): Promise<void> {
  await useKnowledgeBaseStore.getState().renameBase(baseId, name);
  invalidateKnowledgeBases();
}

export async function deleteKnowledgeBase(baseId: string): Promise<void> {
  await useKnowledgeBaseStore.getState().deleteBase(baseId);
  invalidateKnowledgeBases();
  applyKnowledgeLocation();
}

/** Exit KB mode and drop the KB root context so normal file editing is unaffected. */
export function exitKnowledgeMode(): void {
  useKnowledgeBaseStore.getState().exit();
  useFileEditorStore.getState().clearSession();
  usePanelStore.getState().setFilesPanelContext(null);
}

/** Open a knowledge-base file in the center editor (KB root context is active). */
export function openKnowledgeFile(path: string): void {
  const mode = useFileEditorStore.getState().overlayMode === "fullscreen" ? "fullscreen" : "modal";
  void useFileEditorStore
    .getState()
    .openFile(path, mode, true)
    .catch(() => {
      // The preview simply stays empty if the file can't be read.
    });
}

/**
 * Start a thread seeded with a knowledge-base skill command for the active base.
 * Opens a draft for review — it does not auto-send.
 */
export async function runKnowledgeSkill(
  verb: KnowledgeSkillVerb,
  options?: { extraText?: string },
): Promise<void> {
  const project = activeKnowledgeProject();
  const baseId = useKnowledgeBaseStore.getState().activeBaseId;
  if (!project || !baseId) return;
  const { location } = await readBridge().knowledgeRootLocation({ baseId });
  const rootPath = location.kind === "wsl" ? location.linuxPath : location.path;
  const seed = [`/knowledge-base ${verb} --kb ${rootPath}`, options?.extraText?.trim()]
    .filter(Boolean)
    .join("\n\n");
  newThreadFromText(project.id, seed, { bindLeadingSkill: true });
}

/**
 * Pick host files, copy them into the active base's `raw/sources/`, then open a
 * seeded ingest draft listing the newly imported paths.
 */
export async function importAndIngest(): Promise<void> {
  const { context, activeBaseId } = useKnowledgeBaseStore.getState();
  if (!context || !activeBaseId) return;
  const files = await readBridge().pickFiles();
  if (!files || files.length === 0) return;
  const result = await readBridge().knowledgeImportSources({
    baseId: activeBaseId,
    absolutePaths: files,
  });
  await useKnowledgeBaseStore.getState().refresh();
  if (result.importedPaths.length === 0) return;
  const extraText = [
    i18n._(importedSourcesLabel),
    ...result.importedPaths.map((p) => `- ${p}`),
  ].join("\n");
  await runKnowledgeSkill("ingest", { extraText });
}

/** Delete a page or source (recursively) from the active knowledge base. */
export async function deleteKnowledgeEntry(path: string): Promise<void> {
  const baseId = useKnowledgeBaseStore.getState().activeBaseId;
  if (!baseId) return;
  await readBridge().knowledgeDeleteEntry({ baseId, path });
  await useKnowledgeBaseStore.getState().refresh();
}
