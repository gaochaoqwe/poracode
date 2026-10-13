import { create } from "zustand";
import type {
  KnowledgeBaseMeta,
  KnowledgeRootLocationResult,
  KnowledgeTreeEntry,
} from "@/shared/contracts";
import { readBridge } from "../bridge";
import { expandSidebar } from "./sidebarOverlayStore";

/**
 * The project that anchors the right file panel's scope. Knowledge bases are
 * machine-wide, so the project is identity only.
 */
export interface KnowledgeContext {
  projectId: string;
  projectName: string;
}

/** The two browsable roots inside a knowledge base. */
export type KnowledgeSection = "sources" | "wiki";

/** Directory (relative to the base root) each section is rooted at. */
export function knowledgeSectionRoot(section: KnowledgeSection): string {
  return section === "sources" ? "raw/sources" : "wiki";
}

interface KnowledgeBaseStoreState {
  /** Knowledge-base mode: the left nav column shows the KB panel. */
  open: boolean;
  context: KnowledgeContext | null;
  /** All knowledge bases on this machine. */
  bases: KnowledgeBaseMeta[];
  activeBaseId: string | null;
  /** The active base root as a ProjectLocation (drives the file panel + editor). */
  location: KnowledgeRootLocationResult | null;
  section: KnowledgeSection;
  childrenByPath: Record<string, KnowledgeTreeEntry[]>;
  expandedPaths: string[];
  selectedPath: string | null;
  loading: boolean;
  error: string | null;

  enter: (context: KnowledgeContext) => Promise<void>;
  exit: () => void;
  setSection: (section: KnowledgeSection) => void;
  loadBases: () => Promise<void>;
  setActiveBase: (baseId: string) => Promise<void>;
  createBase: (name: string) => Promise<KnowledgeBaseMeta | null>;
  renameBase: (baseId: string, name: string) => Promise<void>;
  deleteBase: (baseId: string) => Promise<void>;
  refresh: () => Promise<void>;
  toggleDirectory: (path: string) => Promise<void>;
  selectPath: (path: string | null) => void;
}

const EMPTY = {
  location: null,
  childrenByPath: {} as Record<string, KnowledgeTreeEntry[]>,
  expandedPaths: [] as string[],
  selectedPath: null,
  loading: false,
  error: null,
};

export const useKnowledgeBaseStore = create<KnowledgeBaseStoreState>((set, get) => ({
  open: false,
  context: null,
  bases: [],
  activeBaseId: null,
  section: "wiki",
  ...EMPTY,

  async enter(context) {
    set({ open: true, context, section: "wiki", ...EMPTY, loading: true });
    expandSidebar();
    await get().loadBases();
    if (get().activeBaseId) await get().refresh();
    else set({ loading: false });
  },

  exit() {
    set({ open: false, context: null, bases: [], activeBaseId: null, section: "wiki", ...EMPTY });
  },

  setSection(section) {
    if (get().section === section) return;
    set({ section });
  },

  async loadBases() {
    const { bases } = await readBridge().knowledgeListBases();
    const active = get().activeBaseId;
    const stillValid = active && bases.some((base) => base.id === active);
    set({ bases, activeBaseId: stillValid ? active : (bases[0]?.id ?? null) });
  },

  async setActiveBase(baseId) {
    if (get().activeBaseId === baseId) return;
    set({ activeBaseId: baseId, ...EMPTY, loading: true });
    await get().refresh();
  },

  async createBase(name) {
    const meta = await readBridge().knowledgeCreateBase({ name });
    await get().loadBases();
    await get().setActiveBase(meta.id);
    return meta;
  },

  async renameBase(baseId, name) {
    await readBridge().knowledgeRenameBase({ baseId, name });
    await get().loadBases();
  },

  async deleteBase(baseId) {
    await readBridge().knowledgeDeleteBase({ baseId });
    const wasActive = get().activeBaseId === baseId;
    await get().loadBases();
    if (wasActive) {
      const next = get().activeBaseId;
      if (next) await get().setActiveBase(next);
      else set({ ...EMPTY });
    }
  },

  async refresh() {
    const baseId = get().activeBaseId;
    const context = get().context;
    if (!baseId || !context) return;
    set({ loading: true, error: null });
    try {
      const location = await readBridge().knowledgeRootLocation({ baseId });
      if (get().activeBaseId !== baseId) return;
      const [sources, wiki] = await Promise.all([
        readBridge().knowledgeListTree({ baseId, directoryPath: "raw/sources" }),
        readBridge().knowledgeListTree({ baseId, directoryPath: "wiki" }),
      ]);
      if (get().activeBaseId !== baseId) return;
      set({
        location,
        childrenByPath: { "raw/sources": sources.entries, wiki: wiki.entries },
        expandedPaths: [],
        loading: false,
      });
    } catch (error) {
      if (get().activeBaseId !== baseId) return;
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  async toggleDirectory(path) {
    const { baseId, expandedPaths, childrenByPath } = getSnapshot(get);
    if (!baseId) return;
    if (expandedPaths.includes(path)) {
      set({ expandedPaths: expandedPaths.filter((entry) => entry !== path) });
      return;
    }
    set({ expandedPaths: [...expandedPaths, path] });
    if (childrenByPath[path]) return;
    try {
      const tree = await readBridge().knowledgeListTree({ baseId, directoryPath: path });
      if (get().activeBaseId !== baseId) return;
      set({ childrenByPath: { ...get().childrenByPath, [path]: tree.entries } });
    } catch (error) {
      if (get().activeBaseId !== baseId) return;
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  selectPath(path) {
    set({ selectedPath: path });
  },
}));

function getSnapshot(get: () => KnowledgeBaseStoreState) {
  const state = get();
  return {
    baseId: state.activeBaseId,
    expandedPaths: state.expandedPaths,
    childrenByPath: state.childrenByPath,
  };
}
