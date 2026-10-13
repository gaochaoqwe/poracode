import {
  fillDocumentTemplatePayloadSchema,
  type FillDocumentTemplatePayload,
  type FillDocumentTemplateResult,
} from "../../contracts";
import { definePayloadProcedure } from "../core";

export const documentFillProcedures = {
  fillDocumentTemplate: definePayloadProcedure<
    FillDocumentTemplatePayload,
    FillDocumentTemplateResult,
    "supervisor"
  >("fillDocumentTemplate", "supervisor", fillDocumentTemplatePayloadSchema),
} as const;
