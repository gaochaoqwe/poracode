import {
  resolveDocumentTemplatePayloadSchema,
  type ResolvedDocumentTemplate,
  type ResolveDocumentTemplatePayload,
} from "../../contracts";
import { definePayloadProcedure } from "../core";

export const documentTemplateProcedures = {
  resolveDocumentTemplate: definePayloadProcedure<
    ResolveDocumentTemplatePayload,
    ResolvedDocumentTemplate | null,
    "supervisor"
  >("resolveDocumentTemplate", "supervisor", resolveDocumentTemplatePayloadSchema),
} as const;
