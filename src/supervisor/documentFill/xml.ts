/**
 * Minimal XML tree for OOXML parts (word/document.xml, styles.xml, …).
 *
 * Deliberately small and dependency-free: it only needs to cover well-formed
 * OOXML — elements, attributes, text, comments, and processing instructions —
 * with no DTD, CDATA, or namespace resolution. Text is kept RAW (entities are
 * not decoded on parse) so a parse→serialize round-trip preserves unknown parts
 * byte-for-byte; use {@link decodeEntities} when comparing visible text.
 */

export interface XmlElement {
  kind: "element";
  name: string;
  /** Attribute name/value pairs in source order, values kept raw (quoted text). */
  attrs: Array<[string, string]>;
  children: XmlNode[];
  /** True when the source used `<x/>`; preserved so round-trips stay exact. */
  selfClosing?: boolean;
}

export interface XmlText {
  kind: "text";
  raw: string;
}

export interface XmlRaw {
  kind: "comment" | "pi";
  raw: string;
}

export type XmlNode = XmlElement | XmlText | XmlRaw;

const NAME_START = /[A-Za-z_:]/;

/** Parse an XML document string into an ordered node list (prolog included). */
export function parseXml(source: string): XmlNode[] {
  let pos = 0;
  const len = source.length;

  function skipWs(): void {
    while (pos < len && /\s/.test(source[pos]!)) pos += 1;
  }

  function readName(): string {
    const start = pos;
    while (pos < len && /[^\s/>=]/.test(source[pos]!)) pos += 1;
    return source.slice(start, pos);
  }

  function readAttrs(): Array<[string, string]> {
    const attrs: Array<[string, string]> = [];
    for (;;) {
      skipWs();
      const ch = source[pos];
      if (ch === undefined || ch === ">" || ch === "/") break;
      const name = readName();
      skipWs();
      if (source[pos] === "=") {
        pos += 1;
        skipWs();
        const quote = source[pos];
        if (quote === '"' || quote === "'") {
          pos += 1;
          const start = pos;
          while (pos < len && source[pos] !== quote) pos += 1;
          attrs.push([name, source.slice(start, pos)]);
          pos += 1; // closing quote
        } else {
          attrs.push([name, ""]);
        }
      } else {
        attrs.push([name, ""]);
      }
    }
    return attrs;
  }

  function parseElement(): XmlElement {
    pos += 1; // consume '<'
    const name = readName();
    const attrs = readAttrs();
    const children: XmlNode[] = [];

    skipWs();
    if (source[pos] === "/") {
      pos += 2; // '/>'
      return { kind: "element", name, attrs, children, selfClosing: true };
    }
    pos += 1; // '>'

    for (;;) {
      const lt = source.indexOf("<", pos);
      if (lt < 0) throw new Error(`unterminated element <${name}>`);
      if (lt > pos) {
        children.push({ kind: "text", raw: source.slice(pos, lt) });
        pos = lt;
      }

      if (source.startsWith("</", pos)) {
        pos += 2;
        readName();
        skipWs();
        pos += 1; // '>'
        return { kind: "element", name, attrs, children, selfClosing: false };
      }
      if (source.startsWith("<!--", pos)) {
        const end = source.indexOf("-->", pos);
        if (end < 0) throw new Error("unterminated comment");
        children.push({ kind: "comment", raw: source.slice(pos, end + 3) });
        pos = end + 3;
        continue;
      }
      if (source.startsWith("<?", pos)) {
        const end = source.indexOf("?>", pos);
        if (end < 0) throw new Error("unterminated processing instruction");
        children.push({ kind: "pi", raw: source.slice(pos, end + 2) });
        pos = end + 2;
        continue;
      }
      if (source[pos + 1] && !NAME_START.test(source[pos + 1]!)) {
        throw new Error(`unexpected markup at ${pos}`);
      }
      children.push(parseElement());
    }
  }

  const nodes: XmlNode[] = [];
  for (;;) {
    const lt = source.indexOf("<", pos);
    if (lt < 0) {
      if (pos < len) nodes.push({ kind: "text", raw: source.slice(pos) });
      break;
    }
    if (lt > pos) {
      nodes.push({ kind: "text", raw: source.slice(pos, lt) });
      pos = lt;
    }
    if (source.startsWith("<?", pos)) {
      const end = source.indexOf("?>", pos);
      if (end < 0) throw new Error("unterminated processing instruction");
      nodes.push({ kind: "pi", raw: source.slice(pos, end + 2) });
      pos = end + 2;
      continue;
    }
    if (source.startsWith("<!--", pos)) {
      const end = source.indexOf("-->", pos);
      if (end < 0) throw new Error("unterminated comment");
      nodes.push({ kind: "comment", raw: source.slice(pos, end + 3) });
      pos = end + 3;
      continue;
    }
    nodes.push(parseElement());
  }
  return nodes;
}

export function serializeXml(nodes: readonly XmlNode[]): string {
  let out = "";
  for (const node of nodes) out += serializeNode(node);
  return out;
}

function serializeNode(node: XmlNode): string {
  switch (node.kind) {
    case "text":
    case "comment":
    case "pi":
      return node.raw;
    case "element": {
      const attrs = node.attrs.map(([name, value]) => `${name}="${value}"`).join(" ");
      const open = attrs ? `<${node.name} ${attrs}` : `<${node.name}`;
      if (node.children.length === 0 && node.selfClosing !== false) return `${open}/>`;
      return `${open}>${serializeXml(node.children)}</${node.name}>`;
    }
  }
}

export function decodeEntities(raw: string): string {
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    switch (body) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return match;
    }
  });
}

export function encodeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function attrValue(element: XmlElement, name: string): string | undefined {
  return element.attrs.find(([key]) => key === name)?.[1];
}

/** Direct element children matching `name`. */
export function childElements(element: XmlElement, name?: string): XmlElement[] {
  return element.children.filter(
    (node): node is XmlElement =>
      node.kind === "element" && (name === undefined || node.name === name),
  );
}

/** First direct element child named `name`. */
export function firstChild(element: XmlElement, name: string): XmlElement | undefined {
  return childElements(element, name)[0];
}

export function elementText(element: XmlElement): string {
  let out = "";
  for (const node of element.children) {
    if (node.kind === "text") out += decodeEntities(node.raw);
    else if (node.kind === "element") out += elementText(node);
  }
  return out;
}
