import type { Project } from "@/shared/contracts";
import type { FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import type { FilesPanelContext } from "@/renderer/state/panelStore";
import { buildFileEditorContext } from "@/renderer/utils/gitHelpers";

/** Resolve the files-panel store context into a live file editor root context. */
export function resolveFilesRootContext(
  context: FilesPanelContext | null,
  projects: Project[],
): FileEditorRootContext | null {
  if (!context) return null;
  const project = projects.find((p) => p.id === context.projectId);
  if (!project) return null;
  // A root override (e.g. the knowledge base in app data) browses that location
  // directly, independent of the project's own root/worktree.
  if (context.projectLocation) {
    return {
      projectId: context.projectId,
      projectName: context.projectName,
      projectLocation: context.projectLocation,
      rootLabel: context.rootLabel,
    };
  }
  return {
    ...buildFileEditorContext(project, context.worktreePath),
    rootLabel: context.rootLabel,
  };
}
