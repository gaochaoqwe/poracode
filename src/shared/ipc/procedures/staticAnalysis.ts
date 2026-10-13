import {
  staticAnalysisClearProjectPayloadSchema,
  staticAnalysisCreateTaskPayloadSchema,
  staticAnalysisGetProjectDataPayloadSchema,
  staticAnalysisSetDefaultRulesPayloadSchema,
  staticAnalysisSetProblemStatusPayloadSchema,
  type StaticAnalysisClearProjectPayload,
  type StaticAnalysisCreateTaskPayload,
  type StaticAnalysisGetProjectDataPayload,
  type StaticAnalysisSetDefaultRulesPayload,
  type StaticAnalysisSetProblemStatusPayload,
} from "../schemas";
import { defineNoArgProcedure, definePayloadProcedure } from "../core";
import type { StaticAnalysisProjectData, StaticAnalysisRule, StaticAnalysisTaskView } from "../../staticAnalysisReport";

/**
 * Main-local procedures for the static-analysis module (migrated from the
 * original requirement_extractor staticAnalysis app). The renderer cannot open
 * the global sqlite directly, so task creation (persisted immediately), report
 * ingestion, rule lookup, and problem marking go through the main process.
 */
export const staticAnalysisProcedures = {
  /** 创建静态分析任务并立即落库（任务创建时就要存数据库）。 */
  staticAnalysisCreateTask: definePayloadProcedure<
    StaticAnalysisCreateTaskPayload,
    StaticAnalysisTaskView,
    "main-local"
  >("staticAnalysisCreateTask", "main-local", staticAnalysisCreateTaskPayloadSchema),
  /** 摄入并返回单个项目的静态分析聚合数据（任务/问题/文件/规则）。 */
  staticAnalysisGetProjectData: definePayloadProcedure<
    StaticAnalysisGetProjectDataPayload,
    StaticAnalysisProjectData,
    "main-local"
  >("staticAnalysisGetProjectData", "main-local", staticAnalysisGetProjectDataPayloadSchema),
  /** 返回全部规则库（GJB8114 / CWE，从原项目迁入）。 */
  staticAnalysisGetRules: defineNoArgProcedure<StaticAnalysisRule[], "main-local">(
    "staticAnalysisGetRules",
    "main-local",
  ),
  /** 返回全局默认选中的规则码集合（"保存为默认规则配置"读）。 */
  staticAnalysisGetDefaultRules: defineNoArgProcedure<string[], "main-local">(
    "staticAnalysisGetDefaultRules",
    "main-local",
  ),
  /** 把当前勾选保存为全局默认规则配置（"保存为默认规则配置"写）。 */
  staticAnalysisSetDefaultRules: definePayloadProcedure<
    StaticAnalysisSetDefaultRulesPayload,
    string[],
    "main-local"
  >("staticAnalysisSetDefaultRules", "main-local", staticAnalysisSetDefaultRulesPayloadSchema),
  /** 更新单个问题的问题状态（0 新发现 / 1 已查看 / 2 已过滤 / 3 已标记）。 */
  staticAnalysisSetProblemStatus: definePayloadProcedure<
    StaticAnalysisSetProblemStatusPayload,
    void,
    "main-local"
  >("staticAnalysisSetProblemStatus", "main-local", staticAnalysisSetProblemStatusPayloadSchema),
  /** 清除项目静态分析记录（项目保留）。 */
  staticAnalysisClearProject: definePayloadProcedure<
    StaticAnalysisClearProjectPayload,
    void,
    "main-local"
  >("staticAnalysisClearProject", "main-local", staticAnalysisClearProjectPayloadSchema),
} as const;
