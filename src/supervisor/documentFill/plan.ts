import { StrictDataError } from "./errors";
import type { CoverFieldRule, InsertionParentRule, TablePrototype, TemplateRules } from "./rules";

export interface ExactRule {
  key: string;
  oldText: string;
  newText: string;
  expectedMatches: number;
}

export interface ParagraphRule {
  key: string;
  anchorText: string;
  newText: string;
  expectedMatches: number;
}

export interface DynamicItem {
  sectionId: string;
  title: string;
  /** Paragraph text of this node's `blocks`, joined by "\n" (footprint kept for callers). */
  body: string;
  blocks: DynamicBlock[];
  children: DynamicItem[];
}

/** One ordered content unit rendered after a dynamic node's heading. */
export type DynamicBlock =
  | { kind: "para"; text: string }
  | {
      kind: "table";
      prototype: string;
      caption?: string;
      rows: string[][];
      dataStartRow: number;
      preserveTailRows: number;
    };

export interface DynamicRule {
  parentId: string;
  parentTitle: string;
  scope: "placeholder" | "top";
  summaryAnchor: string;
  endBeforeTitle: string;
  prototypeTitleAnchor: string;
  prototypeBodyAnchor: string;
  cleanupAnchors: string[];
  cleanupToEnd: boolean;
  /** Caption paragraph prototype for table blocks, when configured. */
  prototypeCaptionAnchor?: string;
  /** Depth ("0" = item heading) → heading prototype anchor. Absent = fall back to the rule. */
  prototypeTitles: Record<number, string>;
  /** Named prototype tables cloned for a dynamic item's table blocks. */
  prototypeTables: Record<string, TablePrototype>;
  items: DynamicItem[];
  summaryText: string;
}

export interface TableRule {
  key: string;
  locatorRows: string[][];
  columns: string[];
  rows: string[][];
  dataStartRow: number;
  preserveTailRows: number;
}

export interface BuildPlan {
  exact: ExactRule[];
  paragraphs: ParagraphRule[];
  dynamics: DynamicRule[];
  tables: TableRule[];
}

type Json = Record<string, unknown>;

function readConfigString(config: Json, path: string): string {
  let current: unknown = config;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null || !(segment in current)) {
      throw new StrictDataError(`缺少必填字段: ${path}`);
    }
    current = (current as Json)[segment];
  }
  if (typeof current !== "string" || current.trim().length === 0) {
    throw new StrictDataError(`字段为空: ${path}`);
  }
  return current.trim();
}

function coverExactRules(config: Json, rules: readonly CoverFieldRule[]): ExactRule[] {
  return rules.map((rule) => ({
    key: rule.key,
    oldText: rule.anchor,
    newText: `${rule.prefix}${readConfigString(config, rule.field)}${rule.suffix}`,
    expectedMatches: rule.expected,
  }));
}

function sortedEntries(value: unknown, sectionId: string): Array<[string, Json]> {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StrictDataError(`章节 ${sectionId} 的子节结构非法`);
  }
  return Object.entries(value as Json)
    .map(([key, entry]) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new StrictDataError(`章节 ${key} 结构非法`);
      }
      return [key, entry as Json] as [string, Json];
    })
    .sort((a, b) => compareSectionIds(a[0], b[0]));
}

function compareSectionIds(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10));
  const pb = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const va = pa[i] ?? -1;
    const vb = pb[i] ?? -1;
    if (va !== vb) return va - vb;
  }
  return 0;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StrictDataError(`字段为空: ${label}`);
  }
  return value.trim();
}

function requireInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new StrictDataError(`字段不是整数: ${label}`);
  }
  return value;
}

function parseTableRules(sectionId: string, section: Json): TableRule[] {
  const raw = section.tables;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new StrictDataError(`章节 ${sectionId} 的 tables 必须是数组`);
  }
  return raw.map((table, index) => {
    if (typeof table !== "object" || table === null) {
      throw new StrictDataError(`章节 ${sectionId} 的 tables[${index + 1}] 结构非法`);
    }
    const t = table as Json;
    const tableId = requireString(t.table_id, `${sectionId}.tables[${index + 1}].table_id`);
    const dataStartRow = requireInt(t.data_start_row, `${tableId}.data_start_row`);
    const preserveTailRows = requireInt(t.preserve_tail_rows, `${tableId}.preserve_tail_rows`);
    if (dataStartRow < 0 || preserveTailRows < 0) {
      throw new StrictDataError(`章节 ${sectionId} 的表格 ${tableId} 行参数不能为负数`);
    }
    const locatorRows = requireRowMatrix(t.locator_rows, `${tableId}.locator_rows`);
    const columns = requireStringArray(t.columns, `${tableId}.columns`);
    if (new Set(columns).size !== columns.length) {
      throw new StrictDataError(`章节 ${sectionId} 的表格 ${tableId} columns 不能重复`);
    }
    const rows = (Array.isArray(t.rows) ? t.rows : []).map((row, rowIndex) => {
      if (typeof row !== "object" || row === null) {
        throw new StrictDataError(`表格 ${tableId} rows[${rowIndex + 1}] 结构非法`);
      }
      const r = row as Json;
      const keys = Object.keys(r).sort();
      if (keys.join("\u0000") !== [...columns].sort().join("\u0000")) {
        throw new StrictDataError(
          `表格 ${tableId} rows[${rowIndex + 1}] 字段必须严格等于 ${columns.join(",")}`,
        );
      }
      return columns.map((column) => requireString(r[column], `${tableId}.rows.${column}`));
    });
    return {
      key: `${sectionId}.${tableId}`,
      locatorRows,
      columns,
      rows,
      dataStartRow,
      preserveTailRows,
    };
  });
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new StrictDataError(`缺少 ${label}`);
  }
  return value.map((entry, index) => requireString(entry, `${label}[${index + 1}]`));
}

function requireRowMatrix(value: unknown, label: string): string[][] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new StrictDataError(`缺少 ${label}`);
  }
  return value.map((row, index) => requireStringArray(row, `${label}[${index + 1}]`));
}

function applyPatternOverride(sectionId: string, rawAnchor: string, rules: TemplateRules): string {
  return rules.patternOverrides[sectionId] ?? rawAnchor;
}

function dynamicRule(
  id: string,
  parentTitle: string,
  scope: "placeholder" | "top",
  spec: InsertionParentRule,
  section: Json,
  summaryText: string,
  items: DynamicItem[],
): DynamicRule {
  const prototypeTitles: Record<number, string> = {};
  for (const [depth, anchor] of Object.entries(spec.prototype_titles ?? {})) {
    prototypeTitles[Number.parseInt(depth, 10)] = anchor;
  }
  return {
    parentId: id,
    parentTitle,
    scope,
    summaryAnchor: spec.summary_anchor,
    endBeforeTitle: spec.end_before_title,
    prototypeTitleAnchor: spec.prototype_title_anchor,
    prototypeBodyAnchor: spec.prototype_body_anchor,
    ...(spec.prototype_caption_anchor === undefined
      ? {}
      : { prototypeCaptionAnchor: spec.prototype_caption_anchor }),
    cleanupAnchors: [...spec.cleanup_anchors],
    cleanupToEnd: spec.cleanup_to_end,
    prototypeTitles,
    prototypeTables: { ...(spec.prototype_tables ?? {}) },
    items,
    summaryText,
  };
}

function splitParagraphLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

function parseBlockRows(
  raw: unknown,
  id: string,
  prototype: string,
  columns: readonly string[],
  blockIndex: number,
): string[][] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new StrictDataError(
      `动态子节 ${id} 的 blocks[${blockIndex + 1}] (表原型 ${prototype}) rows 必须是数组`,
    );
  }
  return raw.map((row, rowIndex) => {
    if (typeof row !== "object" || row === null) {
      throw new StrictDataError(
        `动态子节 ${id} 的 blocks[${blockIndex + 1}] rows[${rowIndex + 1}] 结构非法`,
      );
    }
    const record = row as Json;
    const keys = Object.keys(record).sort();
    if (keys.join("\u0000") !== [...columns].sort().join("\u0000")) {
      throw new StrictDataError(
        `动态子节 ${id} 的 blocks[${blockIndex + 1}] rows[${rowIndex + 1}] 字段必须严格等于 ${columns.join(",")}`,
      );
    }
    return columns.map((column) =>
      requireString(record[column], `${id}.blocks[${blockIndex + 1}].rows.${column}`),
    );
  });
}

function parseBlock(
  raw: unknown,
  id: string,
  blockIndex: number,
  tables: Record<string, TablePrototype>,
): DynamicBlock {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new StrictDataError(`动态子节 ${id} 的 blocks[${blockIndex + 1}] 结构非法`);
  }
  const block = raw as Json;
  if (block.type === "para") {
    return {
      kind: "para",
      text: requireString(block.text, `${id}.blocks[${blockIndex + 1}].text`),
    };
  }
  if (block.type === "table") {
    const prototype = requireString(block.prototype, `${id}.blocks[${blockIndex + 1}].prototype`);
    const spec = tables[prototype];
    if (!spec) {
      throw new StrictDataError(
        `动态子节 ${id} 的 blocks[${blockIndex + 1}] 引用了未定义的表原型: ${prototype}`,
      );
    }
    const dataStartRow = requireInt(
      block.data_start_row,
      `${id}.blocks[${blockIndex + 1}].data_start_row`,
    );
    const preserveTailRows = requireInt(
      block.preserve_tail_rows,
      `${id}.blocks[${blockIndex + 1}].preserve_tail_rows`,
    );
    if (dataStartRow < 0 || preserveTailRows < 0) {
      throw new StrictDataError(`动态子节 ${id} 的 blocks[${blockIndex + 1}] 行参数不能为负数`);
    }
    return {
      kind: "table",
      prototype,
      ...(block.caption === undefined
        ? {}
        : { caption: requireString(block.caption, `${id}.blocks[${blockIndex + 1}].caption`) }),
      rows: parseBlockRows(block.rows, id, prototype, spec.columns, blockIndex),
      dataStartRow,
      preserveTailRows,
    };
  }
  throw new StrictDataError(
    `动态子节 ${id} 的 blocks[${blockIndex + 1}] type 非法: ${String(block.type)}`,
  );
}

function buildDynamicItems(
  subsections: unknown,
  id: string,
  tables: Record<string, TablePrototype>,
): DynamicItem[] {
  if (subsections === undefined) {
    throw new StrictDataError(`动态章节 ${id} 缺少 subsections`);
  }
  return sortedEntries(subsections, id).map(([subId, sub]) => {
    const title = requireString(sub.name, `${subId}.name`);
    let blocks: DynamicBlock[];
    if (sub.blocks !== undefined) {
      if (!Array.isArray(sub.blocks)) {
        throw new StrictDataError(`动态子节 ${subId} 的 blocks 必须是数组`);
      }
      blocks = sub.blocks.map((block, index) => parseBlock(block, subId, index, tables));
    } else if (sub.content !== undefined) {
      blocks = splitParagraphLines(requireString(sub.content, `${subId}.content`)).map((text) => ({
        kind: "para" as const,
        text,
      }));
    } else {
      throw new StrictDataError(`动态子节 ${subId} 缺少 content 或 blocks`);
    }
    const children =
      sub.subsections === undefined ? [] : buildDynamicItems(sub.subsections, subId, tables);
    const body = blocks
      .filter((block): block is Extract<DynamicBlock, { kind: "para" }> => block.kind === "para")
      .map((block) => block.text)
      .join("\n");
    return { sectionId: subId, title, body, blocks, children };
  });
}

export function buildPlan(config: Json, project: Json, rules: TemplateRules): BuildPlan {
  const exact: ExactRule[] = [
    ...coverExactRules(config, rules.coverRules),
    ...coverExactRules(config, rules.identityRules),
  ];
  const paragraphs: ParagraphRule[] = [];
  const dynamics: DynamicRule[] = [];
  const tables: TableRule[] = [];

  const structure = project.structure;
  if (typeof structure !== "object" || structure === null) {
    throw new StrictDataError("project.json 缺少 structure 对象");
  }

  for (const [sectionId, raw] of Object.entries(structure as Json)) {
    if (typeof raw !== "object" || raw === null) {
      throw new StrictDataError(`章节 ${sectionId} 结构非法`);
    }
    const section = raw as Json;
    const insertionSpec = rules.insertionParentRules[sectionId];

    // Dynamic chapter declared at the top level (SDD's 4.3 / 5).
    if (rules.insertionParentScope === "top" && insertionSpec) {
      const items = buildDynamicItems(
        section.subsections,
        sectionId,
        insertionSpec.prototype_tables ?? {},
      );
      const summaryText = requireString(section.content, `${sectionId}.content`);
      paragraphs.push({
        key: `${sectionId}.summary`,
        anchorText: insertionSpec.summary_anchor,
        newText: summaryText,
        expectedMatches: 1,
      });
      dynamics.push(
        dynamicRule(
          sectionId,
          insertionSpec.parent_title,
          "top",
          insertionSpec,
          section,
          summaryText,
          items,
        ),
      );
      tables.push(...parseTableRules(sectionId, section));

      // A top-level dynamic chapter may also carry fixed sub-parts. Its
      // `placeholders` become plain paragraph fills (e.g. a fixed 4.1.1 whose
      // heading and table are static, with only its body text filled).
      const placeholders = section.placeholders;
      if (placeholders !== undefined && !Array.isArray(placeholders)) {
        throw new StrictDataError(`章节 ${sectionId} 的 placeholders 结构非法`);
      }
      for (const placeholder of (placeholders as Json[] | undefined) ?? []) {
        const placeholderId = requireString(placeholder.id, `${sectionId}.placeholder.id`);
        if ("replacement_pattern" in placeholder && "content" in placeholder) {
          paragraphs.push({
            key: placeholderId,
            anchorText: requireString(
              placeholder.replacement_pattern,
              `${placeholderId}.replacement_pattern`,
            ),
            newText: requireString(placeholder.content, `${placeholderId}.content`),
            expectedMatches: 1,
          });
        }
        for (const [subId, sub] of sortedEntries(placeholder.subsections, placeholderId)) {
          if (!("replacement_pattern" in sub && "content" in sub)) continue;
          paragraphs.push({
            key: subId,
            anchorText: requireString(sub.replacement_pattern, subId),
            newText: requireString(sub.content, `${subId}.content`),
            expectedMatches: 1,
          });
        }
      }
      continue;
    }

    if ("replacement_pattern" in section && "content" in section) {
      paragraphs.push({
        key: sectionId,
        anchorText: applyPatternOverride(
          sectionId,
          requireString(section.replacement_pattern, sectionId),
          rules,
        ),
        newText: requireString(section.content, `${sectionId}.content`),
        expectedMatches: 1,
      });
    }
    tables.push(...parseTableRules(sectionId, section));

    for (const [subId, sub] of sortedEntries(section.subsections, sectionId)) {
      if (rules.insertionParentScope === "placeholder" && rules.insertionParentRules[subId]) {
        throw new StrictDataError(`不支持顶层章节 ${subId} 的动态子节写法`);
      }
      paragraphs.push({
        key: subId,
        anchorText: requireString(sub.replacement_pattern, `${subId}.replacement_pattern`),
        newText: requireString(sub.content, `${subId}.content`),
        expectedMatches: 1,
      });
    }

    const placeholders = section.placeholders;
    if (placeholders !== undefined && !Array.isArray(placeholders)) {
      throw new StrictDataError(`章节 ${sectionId} 的 placeholders 结构非法`);
    }
    for (const placeholder of (placeholders as Json[] | undefined) ?? []) {
      const placeholderId = requireString(placeholder.id, `${sectionId}.placeholder.id`);
      const placeholderSpec = rules.insertionParentRules[placeholderId];

      if (rules.insertionParentScope === "placeholder" && placeholderSpec) {
        const items = buildDynamicItems(
          placeholder.subsections,
          placeholderId,
          placeholderSpec.prototype_tables ?? {},
        );
        const summaryText = requireString(placeholder.content, `${placeholderId}.content`);
        paragraphs.push({
          key: `${placeholderId}.summary`,
          anchorText: placeholderSpec.summary_anchor,
          newText: summaryText,
          expectedMatches: 1,
        });
        dynamics.push(
          dynamicRule(
            placeholderId,
            placeholderSpec.parent_title,
            "placeholder",
            placeholderSpec,
            placeholder,
            summaryText,
            items,
          ),
        );
        continue;
      }

      if ("replacement_pattern" in placeholder && "content" in placeholder) {
        paragraphs.push({
          key: placeholderId,
          anchorText: applyPatternOverride(
            placeholderId,
            requireString(placeholder.replacement_pattern, placeholderId),
            rules,
          ),
          newText: requireString(placeholder.content, `${placeholderId}.content`),
          expectedMatches: 1,
        });
      }

      for (const [subId, sub] of sortedEntries(placeholder.subsections, placeholderId)) {
        if ("replacement_pattern" in sub && "content" in sub) {
          paragraphs.push({
            key: subId,
            anchorText: requireString(sub.replacement_pattern, subId),
            newText: requireString(sub.content, `${subId}.content`),
            expectedMatches: 1,
          });
        } else if (Object.keys(sub).length > 0) {
          throw new StrictDataError(
            `章节 ${subId} 需要明确配置 replacement_pattern，或被声明为动态章节`,
          );
        }
      }
    }
  }

  return { exact, paragraphs, dynamics, tables };
}
