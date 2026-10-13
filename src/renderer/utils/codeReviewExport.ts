import type { ReviewIssueStatus } from "@/shared/ipc";
import {
  fileLevelLocation,
  splitDescriptionLocation,
  type ReviewIssueView,
} from "@/renderer/state/codeReviewReport";

/**
 * 导出「已标记问题」工作簿，列结构对齐源项目 requirement_extractor
 * (`FUNCTION_MARKED_PROBLEM_COLUMNS`)：
 *
 *   源代码 | 测试活动 | 问题类型 | 问题等级 | 问题数目 | 问题名称 | 问题来源 | 问题描述
 *
 * 「问题描述」把四段拼成多行文本（需求描述 / 问题描述 / 问题定位 / 影响分析），
 * 与源项目逐字一致，便于评审表格直接使用。`xlsx` 懒加载，避免把 ~200KB 的纯 JS
 * 塞进渲染进程的冷启动依赖图。
 */
export async function exportIssuesToXlsx(
  issues: readonly ReviewIssueView[],
  statuses: Readonly<Record<string, ReviewIssueStatus>>,
  title: string,
): Promise<void> {
  const XLSX = await import("xlsx");
  const rows = issues.map((issue) => {
    // 「源代码」优先用报告给的函数完整源码；缺失时回退到 description_location
    // 里引用的源程序片段，保证该列不为空。
    const sourceCode = issue.sourceCode || splitDescriptionLocation(issue.descriptionLocation).source;
    const description = [
      `需求描述：${issue.suggestion}`,
      `问题描述：${issue.descriptionIssue}`,
      `问题定位：${issue.descriptionLocation}`,
      `影响分析：${issue.impact}`,
    ].join("\n");
    return {
      源代码: sourceCode,
      测试活动: "代码审查",
      问题类型: "程序问题",
      问题等级: issue.severity,
      问题数目: 1,
      问题名称: issue.summary,
      问题来源: fileLevelLocation(issue.issueLocation, issue.file),
      问题描述: description,
    };
  });

  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 52 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 8 }, { wch: 48 }, { wch: 28 }, { wch: 60 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "已标记问题");
  const fileName = `${title || "代码审查问题清单"}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
