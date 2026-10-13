import type { StaticAnalysisProblem } from "@/shared/staticAnalysisReport";

/**
 * Export the (already-filtered) static-analysis problem list to a downloadable
 * .xlsx workbook, one row per problem. Columns mirror the original
 * requirement_extractor staticAnalysis module's Excel 问题单:
 * 文件名称 / 源代码 / 违反规则 / 问题等级 / 问题名称 / 问题来源 / 问题描述 / 修改意见.
 * Downloads in the renderer via a Blob (`xlsx` loaded lazily).
 */
export async function exportProblemsToXlsx(
  problems: readonly StaticAnalysisProblem[],
  title: string,
): Promise<void> {
  const XLSX = await import("xlsx");
  const rows = problems.map((problem) => {
    const sheet = problem.problem_sheet;
    return {
      文件名称: problem.issue_file || problem.file_name,
      源代码: problem.source_code || "",
      违反规则: problem.violation_rules || problem.rule_code,
      问题等级: problem.issue_level,
      问题名称: problem.issue_name,
      问题来源: problem.issue_location,
      问题描述: sheet?.four_part_description || problem.issue_description,
      修改意见: sheet?.test_unit_opinion || "",
    };
  });

  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 28 }, { wch: 40 }, { wch: 14 }, { wch: 8 },
    { wch: 24 }, { wch: 16 }, { wch: 60 }, { wch: 40 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "静态分析问题单");
  const fileName = `${title || "静态分析问题单"}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
