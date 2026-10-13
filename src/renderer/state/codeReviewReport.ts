/**
 * Review-report parsing now lives in `src/shared/codeReviewReport.ts` so the
 * main process (which ingests reports into the global `state.sqlite`) and the
 * renderer (which displays them) share one tolerant parser. This file re-exports
 * the shared module to keep existing `@/renderer/state/codeReviewReport` imports
 * stable.
 */
export * from "@/shared/codeReviewReport";
