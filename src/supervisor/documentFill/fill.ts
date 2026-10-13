import {
  applyCaptionNumbering,
  applyExactReplacements,
  applyParagraphReplacements,
  applyTableFills,
  markTocForUpdate,
} from "./apply";
import { applyDynamicSections } from "./dynamic";
import { DocPart, parseStyles } from "./document";
import { StrictTemplateError } from "./errors";
import { buildPlan, type BuildPlan } from "./plan";
import { parseTemplateRules, type TemplateRules } from "./rules";
import { readZip, writeZip, type ZipEntry } from "./zip";
import { parseXml, serializeXml, type XmlElement } from "./xml";

export interface FillDocumentInput {
  /** Source template .docx bytes. */
  template: Uint8Array;
  /** Per-template rules (parsed `rules.json`). */
  rules: TemplateRules | unknown;
  /** Parsed config.json. */
  config: unknown;
  /** Parsed project.json. */
  project: unknown;
  /** Zip entry timestamp; fixed for deterministic output. */
  mtime?: Date;
}

const DOCUMENT = "word/document.xml";
const SETTINGS = "word/settings.xml";
const STYLES = "word/styles.xml";
const STORY_PART = /^word\/(?:header|footer)\d*\.xml$/u;
const DEFAULT_MTIME = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

function asJson(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StrictTemplateError(`${label} 不是 JSON 对象`);
  }
  return value as Record<string, unknown>;
}

function firstElement(xml: string): XmlElement {
  const node = parseXml(xml).find(
    (candidate): candidate is XmlElement => candidate.kind === "element",
  );
  if (!node) throw new StrictTemplateError("OOXML 部件缺少根元素");
  return node;
}

/**
 * Fill a GJB/OOXML `.docx` template from `config`/`project` JSON, returning the
 * output bytes. Pure: no filesystem access — the caller owns reading the
 * template and writing the result. Deterministic for a fixed `mtime`.
 */
export function fillDocument(input: FillDocumentInput): Uint8Array {
  const rules: TemplateRules = parseTemplateRules(input.rules);
  const config = asJson(input.config, "config.json");
  const project = asJson(input.project, "project.json");

  const entries = readZip(input.template);
  const xmlByName = new Map(entries.map((entry) => [entry.name, decoder.decode(entry.data)]));

  const documentXml = xmlByName.get(DOCUMENT);
  if (!documentXml) throw new StrictTemplateError("模板缺少 word/document.xml");

  const styles = parseStyles(xmlByName.get(STYLES));
  const plan: BuildPlan = buildPlan(config, project, rules);

  const documentPart = DocPart.parse(documentXml);

  const storyParts: Array<{ name: string; part: DocPart }> = [];
  for (const entry of entries) {
    if (!STORY_PART.test(entry.name)) continue;
    const part = DocPart.parse(xmlByName.get(entry.name)!);
    storyParts.push({ name: entry.name, part });
  }

  const allParts = [documentPart, ...storyParts.map((entry) => entry.part)];
  applyExactReplacements(allParts, plan, styles);
  // Top-level table fills run before dynamic rendering so a cloned prototype
  // table can never be re-matched by a top-level locator.
  applyTableFills(documentPart, plan);
  applyDynamicSections(documentPart, plan, styles, rules.headingSeparator);
  applyParagraphReplacements(allParts, plan);
  applyCaptionNumbering(documentPart, styles, rules.captionMode);

  const replaced = new Map<string, Uint8Array>();
  replaced.set(DOCUMENT, encoder.encode(documentPart.serialize()));

  for (const { name, part } of storyParts) {
    replaced.set(name, encoder.encode(part.serialize()));
  }

  const settingsXml = xmlByName.get(SETTINGS);
  if (settingsXml) {
    const settingsRoot = firstElement(settingsXml);
    markTocForUpdate(settingsRoot, documentPart);
    replaced.set(SETTINGS, encoder.encode(serializeXml([settingsRoot])));
  }

  const output: ZipEntry[] = entries.map((entry) => {
    const next = replaced.get(entry.name);
    return next ? { name: entry.name, data: next } : entry;
  });

  return writeZip(output, input.mtime ?? DEFAULT_MTIME);
}
