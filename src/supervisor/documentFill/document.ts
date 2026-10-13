import {
  attrValue,
  childElements,
  decodeEntities,
  encodeText,
  firstChild,
  parseXml,
  serializeXml,
  type XmlElement,
  type XmlNode,
} from "./xml";
import { StrictTemplateError } from "./errors";

/**
 * A parsed OOXML story part (the main document, or a header/footer). The tree
 * is mutated in place; `serialize()` returns the part's XML.
 */
export class DocPart {
  readonly root: XmlElement;

  private constructor(root: XmlElement) {
    this.root = root;
  }

  static parse(xml: string): DocPart {
    const nodes = parseXml(xml);
    const root = nodes.find(
      (node): node is XmlElement =>
        node.kind === "element" &&
        (node.name === "w:document" || node.name === "w:hdr" || node.name === "w:ftr"),
    );
    if (!root) throw new StrictTemplateError("OOXML 部件缺少根元素");
    return new DocPart(root);
  }

  /** The `w:body` element (main document only). */
  body(): XmlElement {
    const body = firstChild(this.root, "w:body");
    if (!body) throw new StrictTemplateError("document.xml 缺少 w:body");
    return body;
  }

  serialize(): string {
    return serializeXml([this.root]);
  }
}

export function isParagraph(node: XmlNode): node is XmlElement {
  return node.kind === "element" && node.name === "w:p";
}

export function isTable(node: XmlNode): node is XmlElement {
  return node.kind === "element" && node.name === "w:tbl";
}

/** Text of a single run, matching python-docx `Run.text` for the elements it counts. */
export function runText(run: XmlElement): string {
  let out = "";
  for (const node of run.children) {
    if (node.kind !== "element") continue;
    if (node.name === "w:t") out += decodeEntities(nodeText(node));
    else if (node.name === "w:tab") out += "\t";
    else if (node.name === "w:br" || node.name === "w:cr") out += "\n";
  }
  return out;
}

function nodeText(element: XmlElement): string {
  return element.children
    .filter((node): node is Extract<XmlNode, { kind: "text" }> => node.kind === "text")
    .map((node) => node.raw)
    .join("");
}

/** Direct `w:r` children of a paragraph (excludes runs inside `w:hyperlink`). */
export function paragraphRuns(paragraph: XmlElement): XmlElement[] {
  return childElements(paragraph, "w:r");
}

/** Paragraph text = concatenation of its direct runs' text. */
export function paragraphText(paragraph: XmlElement): string {
  return paragraphRuns(paragraph).map(runText).join("");
}

/** Replace a run's text content, preserving its `w:rPr`; drops t/tab/br/cr. */
export function setRunText(run: XmlElement, text: string): void {
  run.children = run.children.filter(
    (node) =>
      !(
        node.kind === "element" &&
        (node.name === "w:t" ||
          node.name === "w:tab" ||
          node.name === "w:br" ||
          node.name === "w:cr")
      ),
  );
  if (text.length === 0) return;
  const preserve = /^\s|\s$/.test(text);
  run.children = [
    ...run.children,
    {
      kind: "element",
      name: "w:t",
      attrs: preserve ? [["xml:space", "preserve"]] : [],
      children: [{ kind: "text", raw: encodeText(text) }],
      selfClosing: false,
    },
  ];
}

/** Set a paragraph to a single string (first non-empty run keeps its style). */
export function setParagraphText(paragraph: XmlElement, text: string): void {
  const runs = paragraphRuns(paragraph);
  if (runs.length === 0) {
    const run: XmlElement = {
      kind: "element",
      name: "w:r",
      attrs: [],
      children: [],
      selfClosing: true,
    };
    setRunText(run, text);
    paragraph.children.push(run);
    return;
  }
  const styleRun = runs.find((run) => runText(run).length > 0) ?? runs[0]!;
  setRunText(styleRun, text);
  for (const run of runs) {
    if (run === styleRun) continue;
    setRunText(run, "");
  }
}

function splitLines(text: string): string[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new StrictTemplateError("写入文本不能为空");
  return lines;
}

/** Split `text` into paragraphs, cloning `prototype` for each extra line. */
export function setParagraphsFromText(
  owner: XmlElement,
  paragraph: XmlElement,
  text: string,
): void {
  const lines = splitLines(text);
  setParagraphText(paragraph, lines[0]!);
  let cursor = paragraph;
  for (const line of lines.slice(1)) {
    const clone = cloneAfter(owner, cursor, paragraph);
    setParagraphText(clone, line);
    cursor = clone;
  }
}

export function childIndex(owner: XmlElement, node: XmlNode): number {
  return owner.children.indexOf(node);
}

/** Deep-clone `prototype` and insert the copy immediately after `anchor`. */
export function cloneAfter(owner: XmlElement, anchor: XmlNode, prototype: XmlElement): XmlElement {
  const clone = structuredClone(prototype);
  const index = childIndex(owner, anchor);
  owner.children.splice(index + 1, 0, clone);
  return clone;
}

export function removeNode(owner: XmlElement, node: XmlNode): void {
  const index = childIndex(owner, node);
  if (index >= 0) owner.children.splice(index, 1);
}

/** Paragraphs directly under a container (body, cell, header, footer). */
export function directParagraphs(container: XmlElement): XmlElement[] {
  return childElements(container, "w:p");
}

export function directTables(container: XmlElement): XmlElement[] {
  return childElements(container, "w:tbl");
}

/**
 * Direct block-level children (paragraphs and tables) in document order. The
 * dynamic renderer interleaves both, so it indexes this list instead of
 * `directParagraphs`.
 */
export function directBlocks(container: XmlElement): XmlElement[] {
  return container.children.filter(
    (node): node is XmlElement => node.kind === "element" && (isParagraph(node) || isTable(node)),
  );
}

/** Paragraphs of a container plus every paragraph inside its tables (recursive). */
export function containerParagraphs(container: XmlElement): XmlElement[] {
  const out = directParagraphs(container);
  for (const table of directTables(container)) {
    for (const row of tableRows(table)) {
      for (const cell of rowCells(row)) out.push(...containerParagraphs(cell));
    }
  }
  return out;
}

export function tableRows(table: XmlElement): XmlElement[] {
  return childElements(table, "w:tr");
}

export function rowCells(row: XmlElement): XmlElement[] {
  return childElements(row, "w:tc");
}

function gridSpanOf(cell: XmlElement): number {
  const tcPr = firstChild(cell, "w:tcPr");
  const gridSpan = tcPr ? firstChild(tcPr, "w:gridSpan") : undefined;
  const value = gridSpan ? attrValue(gridSpan, "w:val") : undefined;
  const span = value ? Number.parseInt(value, 10) : 1;
  return Number.isFinite(span) && span > 0 ? span : 1;
}

function isVMergeContinue(cell: XmlElement): boolean {
  const tcPr = firstChild(cell, "w:tcPr");
  const vMerge = tcPr ? firstChild(tcPr, "w:vMerge") : undefined;
  if (!vMerge) return false;
  const value = attrValue(vMerge, "w:val");
  return value === undefined || value === "continue";
}

/**
 * The table's grid cells, one entry per grid column per row — mirroring
 * python-docx `_Row.cells`: horizontalspan (`w:gridSpan`) repeats the cell, and
 * a `w:vMerge` continuation resolves to the origin cell in the row above.
 */
export function tableGrid(table: XmlElement): { rows: XmlElement[][]; width: number } {
  const rawRows = tableRows(table);
  const grid: XmlElement[][] = [];
  const resolved: XmlElement[][] = [];
  let width = 0;

  for (let r = 0; r < rawRows.length; r += 1) {
    const cells: XmlElement[] = [];
    for (const cell of rowCells(rawRows[r]!)) {
      const span = gridSpanOf(cell);
      for (let i = 0; i < span; i += 1) cells.push(cell);
    }
    grid.push(cells);
    width = Math.max(width, cells.length);

    const row: XmlElement[] = [];
    for (let c = 0; c < cells.length; c += 1) {
      const cell = cells[c]!;
      const origin = isVMergeContinue(cell) ? (resolved[r - 1]?.[c] ?? cell) : cell;
      row.push(origin);
    }
    resolved.push(row);
  }
  return { rows: resolved, width };
}

/** Cell text = its paragraphs joined by "\n" (python-docx `_Cell.text`). */
export function cellText(cell: XmlElement): string {
  return containerParagraphs(cell).map(paragraphText).join("\n");
}

/** Remove every paragraph but the first, then clear it (python-docx `_prepare_cell`). */
export function prepareCell(cell: XmlElement): XmlElement | undefined {
  const paragraphs = directParagraphs(cell);
  if (paragraphs.length === 0) return undefined;
  for (const paragraph of paragraphs.slice(1)) removeNode(cell, paragraph);
  setParagraphText(paragraphs[0]!, "");
  return paragraphs[0]!;
}

export interface StylesMap {
  /** styleId (`w:pStyle/@w:val`) → style name. */
  nameOf(styleId: string | undefined): string | undefined;
}

export function parseStyles(stylesXml: string | undefined): StylesMap {
  if (!stylesXml) return { nameOf: () => undefined };
  const nodes = parseXml(stylesXml);
  const root = nodes.find((node): node is XmlElement => node.kind === "element");
  const map = new Map<string, string>();
  if (root) {
    for (const style of childElements(root, "w:style")) {
      const id = attrValue(style, "w:styleId");
      const name = firstChild(style, "w:name");
      const nameVal = name ? attrValue(name, "w:val") : undefined;
      if (id && nameVal) map.set(id, nameVal);
    }
  }
  return { nameOf: (styleId) => (styleId ? map.get(styleId) : undefined) };
}

export function paragraphStyleId(paragraph: XmlElement): string | undefined {
  const pPr = firstChild(paragraph, "w:pPr");
  const pStyle = pPr ? firstChild(pPr, "w:pStyle") : undefined;
  return pStyle ? attrValue(pStyle, "w:val") : undefined;
}

export function isTocParagraph(paragraph: XmlElement, styles: StylesMap): boolean {
  const name = styles.nameOf(paragraphStyleId(paragraph))?.toLowerCase() ?? "";
  return name.includes("toc") || name.includes("目录");
}

export function isHeading1(paragraph: XmlElement, styles: StylesMap): boolean {
  const name = styles.nameOf(paragraphStyleId(paragraph))?.toLowerCase() ?? "";
  return name.includes("heading 1") || name.includes("标题 1");
}
