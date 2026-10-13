import {
  knowledgeCreateBasePayloadSchema,
  knowledgeDeleteBasePayloadSchema,
  knowledgeDeleteEntryPayloadSchema,
  knowledgeImportSourcesPayloadSchema,
  knowledgeListTreePayloadSchema,
  knowledgeReadFilePayloadSchema,
  knowledgeRenameBasePayloadSchema,
  knowledgeRootLocationPayloadSchema,
  knowledgeWriteFilePayloadSchema,
  type KnowledgeBaseMeta,
  type KnowledgeCreateBasePayload,
  type KnowledgeDeleteBasePayload,
  type KnowledgeDeleteEntryPayload,
  type KnowledgeImportSourcesPayload,
  type KnowledgeImportSourcesResult,
  type KnowledgeListBasesResult,
  type KnowledgeListTreePayload,
  type KnowledgeListTreeResult,
  type KnowledgeReadFilePayload,
  type KnowledgeReadFileResult,
  type KnowledgeRenameBasePayload,
  type KnowledgeRootLocationPayload,
  type KnowledgeRootLocationResult,
  type KnowledgeWriteFilePayload,
} from "../../contracts";
import { defineNoArgProcedure, definePayloadProcedure } from "../core";

/**
 * Knowledge-base procedures. Knowledge bases live in the host app data directory
 * (one subdirectory per base), so every one of these runs in the main process.
 */
export const knowledgeProcedures = {
  knowledgeListBases: defineNoArgProcedure<KnowledgeListBasesResult, "main-local">(
    "knowledgeListBases",
    "main-local",
  ),
  knowledgeCreateBase: definePayloadProcedure<
    KnowledgeCreateBasePayload,
    KnowledgeBaseMeta,
    "main-local"
  >("knowledgeCreateBase", "main-local", knowledgeCreateBasePayloadSchema),
  knowledgeRenameBase: definePayloadProcedure<KnowledgeRenameBasePayload, void, "main-local">(
    "knowledgeRenameBase",
    "main-local",
    knowledgeRenameBasePayloadSchema,
  ),
  knowledgeDeleteBase: definePayloadProcedure<KnowledgeDeleteBasePayload, void, "main-local">(
    "knowledgeDeleteBase",
    "main-local",
    knowledgeDeleteBasePayloadSchema,
  ),
  knowledgeRootLocation: definePayloadProcedure<
    KnowledgeRootLocationPayload,
    KnowledgeRootLocationResult,
    "main-local"
  >("knowledgeRootLocation", "main-local", knowledgeRootLocationPayloadSchema),
  knowledgeListTree: definePayloadProcedure<
    KnowledgeListTreePayload,
    KnowledgeListTreeResult,
    "main-local"
  >("knowledgeListTree", "main-local", knowledgeListTreePayloadSchema),
  knowledgeReadFile: definePayloadProcedure<
    KnowledgeReadFilePayload,
    KnowledgeReadFileResult,
    "main-local"
  >("knowledgeReadFile", "main-local", knowledgeReadFilePayloadSchema),
  knowledgeWriteFile: definePayloadProcedure<KnowledgeWriteFilePayload, void, "main-local">(
    "knowledgeWriteFile",
    "main-local",
    knowledgeWriteFilePayloadSchema,
  ),
  knowledgeImportSources: definePayloadProcedure<
    KnowledgeImportSourcesPayload,
    KnowledgeImportSourcesResult,
    "main-local"
  >("knowledgeImportSources", "main-local", knowledgeImportSourcesPayloadSchema),
  knowledgeDeleteEntry: definePayloadProcedure<KnowledgeDeleteEntryPayload, void, "main-local">(
    "knowledgeDeleteEntry",
    "main-local",
    knowledgeDeleteEntryPayloadSchema,
  ),
} as const;
