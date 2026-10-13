import {
  reviewClearIssueStatesPayloadSchema,
  reviewClearProjectPayloadSchema,
  reviewCreateTaskPayloadSchema,
  reviewEnsureMcpPayloadSchema,
  reviewGetIssueStatesPayloadSchema,
  reviewGetProjectDataPayloadSchema,
  reviewSetIssueStatePayloadSchema,
  type ReviewClearIssueStatesPayload,
  type ReviewClearProjectPayload,
  type ReviewCreateTaskPayload,
  type ReviewEnsureMcpPayload,
  type ReviewGetIssueStatesPayload,
  type ReviewGetProjectDataPayload,
  type ReviewIssueStates,
  type ReviewProjectData,
  type ReviewSetIssueStatePayload,
  type ReviewTaskView,
} from "../schemas";
import { definePayloadProcedure } from "../core";

/**
 * Main-local procedures for the code-review panel's persisted issue state
 * (the four audit states). The renderer cannot open the project-local sqlite
 * directly (N-API native module in the browser process is not allowed), so
 * reads/writes go through the main process, which resolves the project root
 * and owns the database. See the main-local handlers in
 * `src/main/ipc/localHandlers.ts` (and `src/main/codeReview/`).
 */
export const codeReviewProcedures = {
  reviewGetIssueStates: definePayloadProcedure<
    ReviewGetIssueStatesPayload,
    ReviewIssueStates,
    "main-local"
  >("reviewGetIssueStates", "main-local", reviewGetIssueStatesPayloadSchema),
  reviewSetIssueState: definePayloadProcedure<
    ReviewSetIssueStatePayload,
    void,
    "main-local"
  >("reviewSetIssueState", "main-local", reviewSetIssueStatePayloadSchema),
  reviewClearIssueStates: definePayloadProcedure<
    ReviewClearIssueStatesPayload,
    void,
    "main-local"
  >("reviewClearIssueStates", "main-local", reviewClearIssueStatesPayloadSchema),
  reviewEnsureMcp: definePayloadProcedure<
    ReviewEnsureMcpPayload,
    void,
    "main-local"
  >("reviewEnsureMcp", "main-local", reviewEnsureMcpPayloadSchema),
  reviewClearProject: definePayloadProcedure<
    ReviewClearProjectPayload,
    void,
    "main-local"
  >("reviewClearProject", "main-local", reviewClearProjectPayloadSchema),
  /** 摄入并返回单个项目的聚合审查数据（渲染端查库取代扫文件）。 */
  reviewGetProjectData: definePayloadProcedure<
    ReviewGetProjectDataPayload,
    ReviewProjectData,
    "main-local"
  >("reviewGetProjectData", "main-local", reviewGetProjectDataPayloadSchema),
  /** 创建审查任务并立即落库（对齐静态分析：创建任务即存数据库）。 */
  reviewCreateTask: definePayloadProcedure<
    ReviewCreateTaskPayload,
    ReviewTaskView,
    "main-local"
  >("reviewCreateTask", "main-local", reviewCreateTaskPayloadSchema),
} as const;
