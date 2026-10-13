import type { AgentEmployeePaths } from "@/shared/agentemployeePaths";
import type { MainLocalIpcHandlerMap } from "@/shared/ipc";
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeEntry,
  ensureKnowledgeProject,
  importKnowledgeSources,
  listKnowledgeBases,
  listKnowledgeTree,
  readKnowledgeFile,
  renameKnowledgeBase,
  writeKnowledgeFile,
} from "./knowledgeStore";

type KnowledgeHandlerName =
  | "knowledgeListBases"
  | "knowledgeCreateBase"
  | "knowledgeRenameBase"
  | "knowledgeDeleteBase"
  | "knowledgeRootLocation"
  | "knowledgeListTree"
  | "knowledgeReadFile"
  | "knowledgeWriteFile"
  | "knowledgeImportSources"
  | "knowledgeDeleteEntry";

export function createKnowledgeIpcHandlers(options: {
  requireAgentEmployeePaths(): AgentEmployeePaths;
}): Pick<MainLocalIpcHandlerMap, KnowledgeHandlerName> {
  const ensure = (baseId: string) => ensureKnowledgeProject(options.requireAgentEmployeePaths(), baseId);

  return {
    knowledgeListBases: async () => ({
      bases: await listKnowledgeBases(options.requireAgentEmployeePaths()),
    }),
    knowledgeCreateBase: ({ name }) => createKnowledgeBase(options.requireAgentEmployeePaths(), name),
    knowledgeRenameBase: async ({ baseId, name }) => {
      await renameKnowledgeBase(options.requireAgentEmployeePaths(), baseId, name);
    },
    knowledgeDeleteBase: async ({ baseId }) => {
      await deleteKnowledgeBase(options.requireAgentEmployeePaths(), baseId);
    },
    knowledgeRootLocation: async ({ baseId }) => {
      const root = await ensure(baseId);
      return {
        location: {
          kind: process.platform === "win32" ? ("windows" as const) : ("posix" as const),
          path: root,
        },
      };
    },
    knowledgeListTree: async ({ baseId, directoryPath }) =>
      listKnowledgeTree(await ensure(baseId), directoryPath),
    knowledgeReadFile: async ({ baseId, path }) => readKnowledgeFile(await ensure(baseId), path),
    knowledgeWriteFile: async ({ baseId, path, content }) => {
      await writeKnowledgeFile(await ensure(baseId), path, content);
    },
    knowledgeImportSources: async ({ baseId, absolutePaths }) => {
      const root = await ensure(baseId);
      return { importedPaths: await importKnowledgeSources(root, absolutePaths) };
    },
    knowledgeDeleteEntry: async ({ baseId, path }) => {
      await deleteKnowledgeEntry(await ensure(baseId), path);
    },
  };
}
