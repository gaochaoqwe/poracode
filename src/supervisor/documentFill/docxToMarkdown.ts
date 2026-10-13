import {
  attrValue,
  childElements,
  elementText,
  firstChild,
  parseXml,
  type XmlElement,
} from "./xml";
import {
  containerParagraphs,
  directBlocks,
  isParagraph,
  isTable,
  parseStyles,
  paragraphStyleId,
  rowCells,
  tableRows,
  type StylesMap,
} from "./document";
import { readZip, type ZipEntry } from "./zip";

/**
 * Convert a Word `.docx` package to Markdown, dependency-free (Node `zlib` only).
 *
 * Used when a user attaches a `.docx` in a work scenario: the supervisor writes
 * the Markdown next to the project's attachments so the agent can read it with
 * ordinary file tools. This is intentionally lossy — it extracts the readable
 * body text (headings, paragraphs, lists, tables) and drops anything that has no
 * faithful Markdown form.
 *
 * Not handled: images/`w:drawing` (alt text dropped), headers and footers,
 * footnotes/endnotes, comments, text boxes, hyperlink URLs, inline run
 * formatting (bold/italic), equations, and field results (a table of contents
 * may emit its cached text). Complex list numbering restarts are not tracked.
 */
export function docxToMarkdown(bytes: Uint8Array): string {
  const entries = readZip(bytes);
  const documentXml = textEntry(entries, "word/document.xml");
  if (!documentXml) throw new Error("docx is missing word/document.xml");

  const styles = parseStyles(textEntry(entries, "word/styles.xml"));
  const numbering = parseNumbering(textEntry(entries, "word/numbering.xml"));

  const root = parseXml(documentXml).find(
    (node): node is XmlElement => node.kind === "element" && node.name === "w:document",
  );
  const body = root ? firstChild(root, "w:body") : undefined;
  if (!body) throw new Error("docx document.xml is missing w:body");

  const blocks: string[] = [];
  const numberingState = new Map<string, number>();
  for (const block of directBlocks(body)) {
    if (isParagraph(block)) {
      const rendered = renderParagraph(block, styles, numbering, numberingState);
      if (rendered) blocks.push(rendered);
    } else if (isTable(block)) {
      const rendered = renderTable(block);
      if (rendered) blocks.push(rendered);
    }
  }

  return normalizeBlankLines(blocks.join("\n\n")).trim();
}

function textEntry(entries: readonly ZipEntry[], name: string): string | undefined {
  const entry = entries.find((candidate) => candidate.name === name);
  return entry ? new TextDecoder("utf-8").decode(entry.data) : undefined;
}

/** Concatenate a paragraph's visible text, including text inside `w:hyperlink`. */
function collectText(element: XmlElement): string {
  let out = "";
  for (const node of element.children) {
    if (node.kind !== "element") continue;
    switch (node.name) {
      case "w:t":
        out += elementText(node);
        break;
      case "w:tab":
        out += " ";
        break;
      case "w:br":
      case "w:cr":
        out += "\n";
        break;
      default:
        // Recurse so text inside `w:r`, `w:hyperlink`, `w:ins`, `w:sdt`, … survives.
        out += collectText(node);
    }
  }
  return out;
}

function parseIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampHeading(level: number): number {
  return Math.min(6, Math.max(1, level));
}

/** Heading level 1–6 from the paragraph style name/id or a direct outline level. */
function headingLevel(paragraph: XmlElement, styles: StylesMap): number | undefined {
  const styleId = paragraphStyleId(paragraph);
  const name = styles.nameOf(styleId) ?? "";
  const match =
    /(?:heading|标题)\s*([1-9])/i.exec(name) ??
    (styleId ? /(?:heading|标题)\s*([1-9])/i.exec(styleId) : null);
  if (match) return clampHeading(Number.parseInt(match[1]!, 10));

  const pPr = firstChild(paragraph, "w:pPr");
  const outline = pPr ? firstChild(pPr, "w:outlineLvl") : undefined;
  const value = outline ? attrValue(outline, "w:val") : undefined;
  if (value !== undefined) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return clampHeading(parsed + 1);
  }
  return undefined;
}

interface NumberingMap {
  formatOf(numId: string, level: number): string | undefined;
}

function parseNumbering(xml: string | undefined): NumberingMap {
  if (!xml) return { formatOf: () => undefined };

  const root = parseXml(xml).find((node): node is XmlElement => node.kind === "element");
  const abstractLevels = new Map<string, Map<number, string>>();
  const numToAbstract = new Map<string, string>();
  if (root) {
    for (const abstract of childElements(root, "w:abstractNum")) {
      const id = attrValue(abstract, "w:abstractNumId");
      if (!id) continue;
      const levels = new Map<number, string>();
      for (const lvl of childElements(abstract, "w:lvl")) {
        const fmt = firstChild(lvl, "w:numFmt");
        const value = fmt ? attrValue(fmt, "w:val") : undefined;
        if (value) levels.set(parseIntOr(attrValue(lvl, "w:ilvl"), 0), value);
      }
      abstractLevels.set(id, levels);
    }
    for (const num of childElements(root, "w:num")) {
      const numId = attrValue(num, "w:numId");
      const abstractRef = firstChild(num, "w:abstractNumId");
      const abstractId = abstractRef ? attrValue(abstractRef, "w:val") : undefined;
      if (numId && abstractId) numToAbstract.set(numId, abstractId);
    }
  }

  return {
    formatOf: (numId, level) => {
      const abstractId = numToAbstract.get(numId);
      return abstractId ? abstractLevels.get(abstractId)?.get(level) : undefined;
    },
  };
}

function renderParagraph(
  paragraph: XmlElement,
  styles: StylesMap,
  numbering: NumberingMap,
  numberingState: Map<string, number>,
): string | undefined {
  const text = collectText(paragraph)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  if (text.length === 0) return undefined;

  const level = headingLevel(paragraph, styles);
  if (level !== undefined) return `${"#".repeat(level)} ${text}`;

  const list = listMarker(paragraph, numbering, numberingState);
  if (list) return `${list.indent}${list.marker}${text}`;

  return text;
}

function listMarker(
  paragraph: XmlElement,
  numbering: NumberingMap,
  state: Map<string, number>,
): { indent: string; marker: string } | undefined {
  const pPr = firstChild(paragraph, "w:pPr");
  const numPr = pPr ? firstChild(pPr, "w:numPr") : undefined;
  if (!numPr) return undefined;

  const ilvl = firstChild(numPr, "w:ilvl");
  const numIdEl = firstChild(numPr, "w:numId");
  const level = parseIntOr(ilvl ? attrValue(ilvl, "w:val") : undefined, 0);
  const numId = numIdEl ? attrValue(numIdEl, "w:val") : undefined;
  const safeLevel = Math.max(0, Math.min(8, level));
  const format = numId ? numbering.formatOf(numId, safeLevel) : undefined;
  const ordered = format !== undefined && format !== "bullet";

  const indent = "  ".repeat(safeLevel);
  if (!ordered) return { indent, marker: "- " };

  const key = `${numId ?? ""}:${safeLevel}`;
  const next = (state.get(key) ?? 0) + 1;
  state.set(key, next);
  return { indent, marker: `${next}. ` };
}

function renderTable(table: XmlElement): string | undefined {
  const rows = tableRows(table).map((row) => rowCells(row).map(cellMarkdown));
  if (rows.length === 0) return undefined;

  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const pad = (row: string[]): string[] => [...row, ...Array<string>(width - row.length).fill("")];
  const header = pad(rows[0]!);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${pad(row).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function cellMarkdown(cell: XmlElement): string {
  return containerParagraphs(cell)
    .map((paragraph) => collectText(paragraph))
    .join("\n")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function normalizeBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}
