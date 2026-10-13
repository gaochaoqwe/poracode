import { useState } from "react";
import {
  ArrowLeft,
  Check,
  FilePlus2,
  Library,
  MessageCircleQuestion,
  Pencil,
  Plus,
  RefreshCw,
  ScanSearch,
  Trash2,
  X,
} from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common/Button";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import { useKnowledgeBaseStore, knowledgeSectionRoot } from "@/renderer/state/knowledgeBaseStore";
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  exitKnowledgeMode,
  importAndIngest,
  openKnowledgeFile,
  renameKnowledgeBase,
  runKnowledgeSkill,
  selectKnowledgeBase,
} from "@/renderer/actions/knowledgeActions";
import { KnowledgeTree } from "./parts/KnowledgeTree";

/**
 * Left-column knowledge-base panel. Replaces the project/thread sidebar while
 * KB mode is active: a base selector (each base is an independent knowledge
 * base), Sources/Wiki sections, the page tree, and the KB actions.
 */
export function KnowledgeSidebar() {
  const { t } = useLingui();
  const bases = useKnowledgeBaseStore((s) => s.bases);
  const activeBaseId = useKnowledgeBaseStore((s) => s.activeBaseId);
  const location = useKnowledgeBaseStore((s) => s.location);
  const section = useKnowledgeBaseStore((s) => s.section);
  const loading = useKnowledgeBaseStore((s) => s.loading);
  const setSection = useKnowledgeBaseStore((s) => s.setSection);
  const refresh = useKnowledgeBaseStore((s) => s.refresh);

  const [editMode, setEditMode] = useState<"none" | "new" | "rename">("none");
  const [draftName, setDraftName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const available = location !== null;
  const activeBase = bases.find((base) => base.id === activeBaseId);

  const beginNew = () => {
    setDraftName("");
    setConfirmDelete(false);
    setEditMode("new");
  };
  const beginRename = () => {
    setDraftName(activeBase?.name ?? "");
    setConfirmDelete(false);
    setEditMode("rename");
  };
  const commitEdit = async () => {
    const name = draftName.trim();
    if (!name) {
      setEditMode("none");
      return;
    }
    if (editMode === "new") await createKnowledgeBase(name);
    else if (editMode === "rename" && activeBaseId) await renameKnowledgeBase(activeBaseId, name);
    setEditMode("none");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 px-2 pb-2">
      <div className="flex items-center gap-2 px-1 pt-1">
        <Library className="size-4 shrink-0 text-muted" />
        <h1 className="truncate text-sm font-medium text-foreground">
          <Trans>Knowledge Base</Trans>
        </h1>
      </div>

      {editMode !== "none" ? (
        <div className="flex items-center gap-1 px-1">
          <input
            value={draftName}
            placeholder={t`Name`}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitEdit();
              if (event.key === "Escape") setEditMode("none");
            }}
            className="min-w-0 flex-1 rounded border border-border bg-transparent px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-accent"
          />
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            aria-label={t`Create`}
            onPress={() => void commitEdit()}
          >
            <Check className="size-4" />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={t`Cancel`}
            onPress={() => setEditMode("none")}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1 px-1">
          <select
            value={activeBaseId ?? ""}
            onChange={(event) => selectKnowledgeBase(event.target.value)}
            aria-label={t`Select a knowledge base`}
            className="min-w-0 flex-1 rounded border border-border bg-transparent px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-accent"
          >
            {bases.length === 0 ? <option value="">{t`No knowledge bases yet`}</option> : null}
            {bases.map((base) => (
              <option key={base.id} value={base.id}>
                {base.name}
              </option>
            ))}
          </select>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            aria-label={t`New knowledge base`}
            onPress={beginNew}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            aria-label={t`Rename`}
            isDisabled={!activeBase}
            onPress={beginRename}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant={confirmDelete ? "danger" : "tertiary"}
            aria-label={confirmDelete ? t`Confirm delete` : t`Delete`}
            isDisabled={!activeBase}
            onPress={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              setConfirmDelete(false);
              if (activeBaseId) void deleteKnowledgeBase(activeBaseId);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}

      {available ? (
        <>
          <div className="flex shrink-0 items-center gap-1 px-1">
            {(["sources", "wiki"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSection(value)}
                className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                  section === value
                    ? "bg-content2 text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {value === "sources" ? <Trans>Sources</Trans> : <Trans>Wiki</Trans>}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <PixelLoader size="lg" />
              </div>
            ) : (
              <KnowledgeTree
                rootPath={knowledgeSectionRoot(section)}
                onSelectFile={openKnowledgeFile}
              />
            )}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1" />
      )}

      <div className="flex shrink-0 flex-col gap-1 border-t border-border pt-2">
        <Button
          size="sm"
          variant="tertiary"
          className="justify-start"
          isDisabled={!available}
          onPress={() => void importAndIngest()}
        >
          <FilePlus2 className="size-4" />
          <Trans>Import and ingest</Trans>
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          className="justify-start"
          isDisabled={!available}
          onPress={() => void runKnowledgeSkill("query")}
        >
          <MessageCircleQuestion className="size-4" />
          <Trans>Ask</Trans>
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          className="justify-start"
          isDisabled={!available}
          onPress={() => void runKnowledgeSkill("lint")}
        >
          <ScanSearch className="size-4" />
          <Trans>Lint</Trans>
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          className="justify-start"
          isDisabled={!available}
          onPress={() => void refresh()}
        >
          <RefreshCw className="size-4" />
          <Trans>Refresh</Trans>
        </Button>
        <Button size="sm" variant="ghost" className="justify-start" onPress={exitKnowledgeMode}>
          <ArrowLeft className="size-4" />
          <Trans>Back to home</Trans>
        </Button>
      </div>
    </div>
  );
}
