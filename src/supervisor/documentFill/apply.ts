import {
  cellText,
  directParagraphs,
  directTables,
  DocPart,
  isHeading1,
  paragraphText,
  prepareCell,
  rowCells,
  setParagraphText,
  setParagraphsFromText,
  tableGrid,
  tableRows,
  type StylesMap,
} from "./document";
import { StrictTemplateError } from "./errors";
import type { BuildPlan, ParagraphRule } from "./plan";
import { attrValue, childElements, firstChild, type XmlElement, type XmlNode } from "./xml";

interface Located {
  paragraph: XmlElement;
  parent: XmlElement;
}

function containerOf(part: DocPart): XmlElement {
  // Header/footer parts root at w:hdr/w:ftr; the main document roots at w:body.
  try {
    return part.body();
  } catch {
    return part.root;
  }
}

function locate(container: XmlElement): Located[] {
  const out: Located[] = [];
  for (const paragraph of directParagraphs(container)) out.push({ paragraph, parent: container });
  for (const table of directTables(container)) {
    for (const row of tableRows(table)) {
      for (const cell of rowCells(row)) out.push(...locate(cell));
    }
  }
  return out;
}

/** Every paragraph across the given parts (body + tables, plus header/footer content). */
function allParagraphs(parts: readonly DocPart[]): Located[] {
  return parts.flatMap((part) => locate(containerOf(part)));
}

/** Direct paragraphs of the part's body (the main document paragraph list). */
function bodyParagraphs(part: DocPart): XmlElement[] {
  return directParagraphs(part.body());
}

export function applyExactReplacements(
  parts: readonly DocPart[],
  plan: BuildPlan,
  styles: StylesMap,
): void {
  void styles;
  const located = allParagraphs(parts);
  for (const rule of plan.exact) {
    const matches = located.filter((entry) => paragraphText(entry.paragraph) === rule.oldText);
    if (matches.length !== rule.expectedMatches) {
      throw new StrictTemplateError(
        `${rule.key} 期望命中 ${rule.expectedMatches} 个精确段落，实际 ${matches.length} 个：${rule.oldText}`,
      );
    }
    for (const match of matches) setParagraphText(match.paragraph, rule.newText);
  }
}

export function applyParagraphReplacements(parts: readonly DocPart[], plan: BuildPlan): void {
  const located = allParagraphs(parts);
  for (const rule of plan.paragraphs) {
    applyParagraphReplacement(located, rule);
  }
}

function applyParagraphReplacement(located: readonly Located[], rule: ParagraphRule): void {
  const matches = located.filter((entry) =>
    paragraphText(entry.paragraph).includes(rule.anchorText),
  );
  if (matches.length !== rule.expectedMatches) {
    throw new StrictTemplateError(
      `${rule.key} 期望命中 ${rule.expectedMatches} 个段落，实际 ${matches.length} 个：${rule.anchorText}`,
    );
  }
  for (const match of matches) setParagraphsFromText(match.parent, match.paragraph, rule.newText);
}

function gridRowTexts(cells: readonly XmlElement[]): string[] {
  return cells.map((cell) => cellText(cell).trim());
}

/**
 * The GJB 438C templates pin some table rows to a fixed height
 * (`w:trHeight w:hRule="exact"`, e.g. 567 twips = 1cm). Word then *clips* any
 * cell whose filled text wraps past that height -- the symptom is a cell
 * showing only its first line, the rest hidden behind blank space.
 *
 * Relax the rule to `atLeast` for the rows we write into so the row grows to
 * fit its content. Rows that stay short are unaffected: `atLeast` still floors
 * them at the template's height.
 */
export function relaxRowHeight(row: XmlElement | undefined): void {
  if (!row) return;
  const trPr = firstChild(row, "w:trPr");
  const trHeight = trPr ? firstChild(trPr, "w:trHeight") : undefined;
  if (trHeight && attrValue(trHeight, "w:hRule") === "exact") {
    setAttr(trHeight, "w:hRule", "atLeast");
  }
}

export interface TableFillSpec {
  key: string;
  columns: readonly string[];
  rows: readonly string[][];
  dataStartRow: number;
  preserveTailRows: number;
}

/** Locate the one table whose leading rows match `locatorRows`. */
export function findTableByLocator(
  tables: readonly XmlElement[],
  locatorRows: readonly (readonly string[])[],
  key: string,
): XmlElement {
  const matches = tables.filter((table) => {
    const grid = tableGrid(table);
    if (grid.rows.length < locatorRows.length) return false;
    return locatorRows.every(
      (locator, index) =>
        JSON.stringify(gridRowTexts(grid.rows[index]!)) === JSON.stringify(locator),
    );
  });
  if (matches.length !== 1) {
    const seen = tables.map((table) =>
      JSON.stringify(gridRowTexts(tableGrid(table).rows[0] ?? [])),
    );
    throw new StrictTemplateError(
      `${key} 期望命中 1 张表，实际 ${matches.length} 张; locator=${JSON.stringify(locatorRows)}; tables=${seen.join(" | ")}`,
    );
  }
  return matches[0]!;
}

export function applyTableFills(part: DocPart, plan: BuildPlan): void {
  const tables = directTables(part.body());
  for (const rule of plan.tables) {
    const table = findTableByLocator(tables, rule.locatorRows, rule.key);
    fillTableFromRule(table, rule);
  }
}

/**
 * Grow a table to `spec.rows` data rows and write every cell. Shared by
 * top-level table fills and by dynamic table blocks cloned from a prototype.
 */
export function fillTableFromRule(table: XmlElement, spec: TableFillSpec): void {
  const expectedColumns = spec.columns.length;
  const width = tableGrid(table).width;
  if (width !== expectedColumns) {
    throw new StrictTemplateError(`${spec.key} 期望 ${expectedColumns} 列，模板实际 ${width} 列`);
  }
  const rows = tableRows(table);
  if (rows.length <= spec.dataStartRow) {
    throw new StrictTemplateError(`${spec.key} 的 data_start_row 超出模板行数`);
  }
  if (spec.preserveTailRows > rows.length - spec.dataStartRow) {
    throw new StrictTemplateError(`${spec.key} 的 preserve_tail_rows 非法`);
  }
  if (rows.length - spec.dataStartRow - spec.preserveTailRows <= 0) {
    throw new StrictTemplateError(`${spec.key} 没有可用的数据行模板`);
  }

  while (spec.rows.length > tableRows(table).length - spec.dataStartRow - spec.preserveTailRows) {
    const live = tableRows(table);
    const insertAt = live.length - spec.preserveTailRows;
    const prototypeIndex = insertAt - 1;
    if (prototypeIndex < spec.dataStartRow) {
      throw new StrictTemplateError(`${spec.key} 无法确定可克隆的数据行原型`);
    }
    const clone = structuredClone(live[prototypeIndex]!);
    const before = live[insertAt];
    if (before) table.children.splice(table.children.indexOf(before), 0, clone);
    else table.children.push(clone);
  }

  const grid = tableGrid(table);
  const liveRows = tableRows(table);
  spec.rows.forEach((values, offset) => {
    const rowIndex = spec.dataStartRow + offset;
    const resolvedRow = grid.rows[rowIndex]!;
    if (resolvedRow.length !== expectedColumns) {
      throw new StrictTemplateError(`${spec.key} 的目标行列数异常`);
    }
    relaxRowHeight(liveRows[rowIndex]);
    values.forEach((value, cellIndex) => {
      const cell = resolvedRow[cellIndex]!;
      const first = prepareCell(cell);
      if (!first) {
        throw new StrictTemplateError(`${spec.key} 的目标单元格没有段落`);
      }
      setParagraphsFromText(cell, first, value);
    });
  });
}

const CAPTION_RE = /^([表图])(\d+|X)-X(.*)$/u;

export function applyCaptionNumbering(
  part: DocPart,
  styles: StylesMap,
  mode: "strict" | "fallback",
): void {
  const counters = new Map<string, number>();
  let currentChapter = 0;
  for (const paragraph of bodyParagraphs(part)) {
    if (isHeading1(paragraph, styles)) {
      currentChapter += 1;
      continue;
    }
    const text = paragraphText(paragraph).trim();
    const match = CAPTION_RE.exec(text);
    if (!match) continue;
    const [, kind, explicit, rest] = match as unknown as [string, string, string, string];
    let chapter: number;
    if (mode === "strict") {
      if (currentChapter === 0) {
        throw new StrictTemplateError(`图表标题 \`${text}\` 出现在任何一级章节之前`);
      }
      if (explicit !== "X" && Number.parseInt(explicit, 10) !== currentChapter) {
        throw new StrictTemplateError(
          `图表标题 \`${text}\` 的章号与当前位置不一致，当前应在第 ${currentChapter} 章`,
        );
      }
      chapter = currentChapter;
    } else {
      if (explicit === "X") {
        if (currentChapter === 0) {
          throw new StrictTemplateError(`图表标题 \`${text}\` 出现在任何一级章节之前`);
        }
        chapter = currentChapter;
      } else {
        chapter = Number.parseInt(explicit, 10);
      }
    }
    const key = `${kind}${chapter}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    setParagraphText(paragraph, `${kind}${chapter}-${next}${rest}`);
  }
}

export function markTocForUpdate(settings: XmlElement, documentPart: DocPart): void {
  let updateField = firstChild(settings, "w:updateFields");
  if (!updateField) {
    updateField = {
      kind: "element",
      name: "w:updateFields",
      attrs: [],
      children: [],
      selfClosing: true,
    };
    settings.children.push(updateField);
  }
  setAttr(updateField, "w:val", "true");

  for (const field of collectByName(documentPart.body(), "w:fldChar")) {
    if (attrValue(field, "w:fldCharType") === "begin") setAttr(field, "w:dirty", "true");
  }
}

function collectByName(element: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of childElements(element)) {
    if (child.name === name) out.push(child);
    out.push(...collectByName(child, name));
  }
  return out;
}

function setAttr(element: XmlElement, name: string, value: string): void {
  const existing = element.attrs.find(([key]) => key === name);
  if (existing) existing[1] = value;
  else element.attrs.push([name, value]);
}

export type { XmlNode };
