import { fillTableFromRule, findTableByLocator } from "./apply";
import {
  cloneAfter,
  directBlocks,
  directTables,
  isTocParagraph,
  paragraphText,
  removeNode,
  setParagraphsFromText,
  setParagraphText,
  type DocPart,
  type StylesMap,
} from "./document";
import { StrictTemplateError } from "./errors";
import type { BuildPlan, DynamicItem, DynamicRule } from "./plan";
import type { XmlElement } from "./xml";

/**
 * Dynamic chapters: clone a prototype block (per-depth headings, a body
 * paragraph, and named tables) once per declared sub-section, recursively.
 * Everything in the prototype region is removed afterwards, so the template
 * ships an editable specimen that never reaches the output.
 */

interface DynamicContext {
  separator: string;
  titleProto: (sectionId: string) => XmlElement;
  bodyProto: XmlElement;
  captionProto: XmlElement | undefined;
  tableProtos: Record<string, XmlElement>;
  prototypeColumns: Record<string, readonly string[]>;
}

function blockIndexOf(body: XmlElement, block: XmlElement): number {
  const index = directBlocks(body).indexOf(block);
  if (index < 0) throw new StrictTemplateError("无法在正文块列表中定位目标块");
  return index;
}

/** One direct paragraph (skipping TOC entries) matching `text` exactly or by substring. */
function findByText(
  blocks: readonly XmlElement[],
  text: string,
  exact: boolean,
  styles: StylesMap,
  label: string,
): XmlElement {
  const matches = blocks.filter(
    (block) =>
      block.name === "w:p" &&
      !isTocParagraph(block, styles) &&
      (exact ? paragraphText(block) === text : paragraphText(block).includes(text)),
  );
  if (matches.length !== 1) {
    const mode = exact ? "精确匹配" : "包含匹配";
    throw new StrictTemplateError(
      `${label}: 模板中 ${mode} \`${text}\` 的段落应为 1 个，实际为 ${matches.length} 个`,
    );
  }
  return matches[0]!;
}

function blocksInRange(body: XmlElement, fromExclusive: number, toExclusive: number): XmlElement[] {
  return directBlocks(body).slice(fromExclusive + 1, toExclusive);
}

function headingSeparator(prototypeTitle: string, mode: "chapter3" | "always"): string {
  if (mode === "chapter3" && !prototypeTitle.startsWith("3.")) return "";
  const stripped = prototypeTitle.replace(/^[0-9.X]+/u, "");
  return stripped.startsWith(" ") ? " " : "";
}

export function applyDynamicSections(
  part: DocPart,
  plan: BuildPlan,
  styles: StylesMap,
  mode: "chapter3" | "always",
): void {
  const body = part.body();
  for (const rule of plan.dynamics) applyDynamic(body, rule, styles, mode);
}

function resolveTitleProtos(
  rule: DynamicRule,
  allBlocks: readonly XmlElement[],
  styles: StylesMap,
): Map<number, XmlElement> {
  const protos = new Map<number, XmlElement>();
  const depth0 = rule.prototypeTitles[0] ?? rule.prototypeTitleAnchor;
  protos.set(0, findByText(allBlocks, depth0, true, styles, `${rule.parentId}.prototype_title`));
  for (const [depthKey, anchor] of Object.entries(rule.prototypeTitles)) {
    const depth = Number.parseInt(depthKey, 10);
    if (depth === 0) continue;
    protos.set(
      depth,
      findByText(allBlocks, anchor, true, styles, `${rule.parentId}.prototype_titles[${depth}]`),
    );
  }
  return protos;
}

function applyDynamic(
  body: XmlElement,
  rule: DynamicRule,
  styles: StylesMap,
  mode: "chapter3" | "always",
): void {
  const allBlocks = directBlocks(body);
  const parentParagraph = findByText(
    allBlocks,
    rule.parentTitle,
    true,
    styles,
    `${rule.parentId}.parent`,
  );
  const summaryParagraph = findByText(
    allBlocks,
    rule.summaryAnchor,
    false,
    styles,
    `${rule.parentId}.summary`,
  );
  const endBefore = findByText(
    allBlocks,
    rule.endBeforeTitle,
    true,
    styles,
    `${rule.parentId}.end`,
  );

  const parentIndex = blockIndexOf(body, parentParagraph);
  const summaryIndex = blockIndexOf(body, summaryParagraph);
  const endBeforeIndex = blockIndexOf(body, endBefore);
  if (!(parentIndex < summaryIndex && summaryIndex < endBeforeIndex)) {
    throw new StrictTemplateError(`${rule.parentId} 的父标题、摘要和结束锚点顺序不合法`);
  }

  const regionBlocks = blocksInRange(body, summaryIndex, endBeforeIndex);
  // Prototypes are located document-wide (SRS keeps them in a shared 3.10 block
  // outside the dynamic region); only in-region ones are cleaned up.
  const titleProtos = resolveTitleProtos(rule, allBlocks, styles);
  const bodyProto = findByText(
    allBlocks,
    rule.prototypeBodyAnchor,
    false,
    styles,
    `${rule.parentId}.prototype_body`,
  );
  const captionProto =
    rule.prototypeCaptionAnchor === undefined
      ? undefined
      : findByText(
          allBlocks,
          rule.prototypeCaptionAnchor,
          true,
          styles,
          `${rule.parentId}.prototype_caption`,
        );
  const tableProtos: Record<string, XmlElement> = {};
  const prototypeColumns: Record<string, readonly string[]> = {};
  for (const [name, spec] of Object.entries(rule.prototypeTables)) {
    tableProtos[name] = findTableByLocator(
      directTables(body),
      spec.locator_rows,
      `${rule.parentId}.prototype_tables.${name}`,
    );
    prototypeColumns[name] = spec.columns;
  }

  const removal = new Set<XmlElement>();
  for (const anchor of rule.cleanupAnchors) {
    removal.add(
      findByText(regionBlocks, anchor, false, styles, `${rule.parentId}.cleanup_anchors`),
    );
  }
  for (const proto of [
    ...titleProtos.values(),
    bodyProto,
    ...(captionProto ? [captionProto] : []),
    ...Object.values(tableProtos),
  ]) {
    if (regionBlocks.includes(proto)) removal.add(proto);
  }

  let removalBlocks: XmlElement[];
  if (rule.cleanupToEnd) {
    if (removal.size === 0) {
      throw new StrictTemplateError(
        `${rule.parentId} 要求从清理起点删到章节结束，但未找到清理锚点`,
      );
    }
    const start = Math.min(...[...removal].map((block) => blockIndexOf(body, block)));
    removalBlocks = directBlocks(body).slice(start, endBeforeIndex);
  } else {
    removalBlocks = [...removal];
  }

  const insertionBeforeIndex =
    removalBlocks.length > 0
      ? Math.min(...removalBlocks.map((block) => blockIndexOf(body, block)))
      : endBeforeIndex;
  if (insertionBeforeIndex <= summaryIndex) {
    throw new StrictTemplateError(`${rule.parentId} 的插入点非法`);
  }
  const insertionAfter = directBlocks(body)[insertionBeforeIndex - 1]!;

  const prototype0 = titleProtos.get(0)!;
  const baseSegments = rule.parentId.split(".").length;
  const declaredDepths = [...titleProtos.keys()].sort((a, b) => a - b);
  const context: DynamicContext = {
    separator: headingSeparator(paragraphText(prototype0), mode),
    titleProto: (sectionId) => {
      // Heading level follows the section number's depth, not tree nesting, so
      // siblings like 4.1.1 and 4.1.2 always share a level even if one is
      // nested under the other in the JSON.
      const depth = Math.max(0, sectionId.split(".").length - baseSegments - 1);
      let chosen = declaredDepths[0] ?? 0;
      for (const declared of declaredDepths) {
        if (declared <= depth) chosen = declared;
        else break;
      }
      const proto = titleProtos.get(chosen);
      if (!proto) throw new StrictTemplateError(`${rule.parentId} 缺少深度 ${chosen} 的标题原型`);
      return proto;
    },
    bodyProto,
    captionProto,
    tableProtos,
    prototypeColumns,
  };

  let cursor: XmlElement = insertionAfter;
  for (const item of rule.items) {
    cursor = renderItem(body, cursor, item, context, rule.parentId);
  }

  const unique = [...new Set(removalBlocks)];
  unique
    .sort((a, b) => blockIndexOf(body, b) - blockIndexOf(body, a))
    .forEach((block) => removeNode(body, block));
}

function renderItem(
  body: XmlElement,
  cursor: XmlElement,
  item: DynamicItem,
  context: DynamicContext,
  parentId: string,
): XmlElement {
  const heading = cloneAfter(body, cursor, context.titleProto(item.sectionId));
  setParagraphText(heading, `${item.sectionId}${context.separator}${item.title}`);
  let next = heading;

  for (const block of item.blocks) {
    if (block.kind === "para") {
      const clone = cloneAfter(body, next, context.bodyProto);
      setParagraphsFromText(body, clone, block.text);
      next = clone;
      continue;
    }
    const proto = context.tableProtos[block.prototype];
    if (!proto) {
      throw new StrictTemplateError(
        `${parentId} 的动态子节 ${item.sectionId} 引用了未定义的表原型: ${block.prototype}`,
      );
    }
    if (block.caption !== undefined) {
      if (!context.captionProto) {
        throw new StrictTemplateError(
          `${parentId} 的动态子节 ${item.sectionId} 声明了表标题，但规则未配置 prototype_caption_anchor`,
        );
      }
      const caption = cloneAfter(body, next, context.captionProto);
      setParagraphText(caption, block.caption);
      next = caption;
    }
    const clone = cloneAfter(body, next, proto);
    fillTableFromRule(clone, {
      key: `${item.sectionId}.${block.prototype}`,
      columns: context.prototypeColumns[block.prototype]!,
      rows: block.rows,
      dataStartRow: block.dataStartRow,
      preserveTailRows: block.preserveTailRows,
    });
    next = clone;
  }

  for (const child of item.children) {
    next = renderItem(body, next, child, context, parentId);
  }
  return next;
}
