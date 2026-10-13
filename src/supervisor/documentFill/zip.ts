import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Minimal ZIP reader/writer for OOXML (.docx) packages, built on Node's zlib
 * only — no third-party dependency, so the filler runs with zero external
 * runtime and works offline.
 *
 * Supports the two methods every Word-produced .docx uses: `store` (0) and
 * `deflate` (8). Unknown methods are rejected rather than silently corrupted.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** CRC-32 (IEEE 802.3) table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Read every entry of a ZIP archive, preserving order. Directory entries
 * (names ending in `/`) are skipped. Data is decompressed eagerly.
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEocd(view);
  if (eocd < 0) throw new Error("not a zip archive: end-of-central-directory not found");

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) {
      throw new Error("corrupt zip: central directory signature mismatch");
    }
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = utf8Decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

    if (!name.endsWith("/")) {
      entries.push({ name, data: readLocalEntry(view, bytes, localOffset, method, compSize) });
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readLocalEntry(
  view: DataView,
  bytes: Uint8Array,
  localOffset: number,
  centralMethod: number,
  centralCompSize: number,
): Uint8Array {
  if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
    throw new Error("corrupt zip: local header signature mismatch");
  }
  const method = view.getUint16(localOffset + 8, true) || centralMethod;
  const compSize = view.getUint32(localOffset + 18, true) || centralCompSize;
  const nameLen = view.getUint16(localOffset + 26, true);
  const extraLen = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + compSize);

  if (method === METHOD_STORE) return raw.slice();
  if (method === METHOD_DEFLATE) return new Uint8Array(inflateRawSync(raw));
  throw new Error(`unsupported zip compression method: ${method}`);
}

function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * Write a ZIP archive. Entries are always deflated; `mtime` is fixed (the
 * caller supplies it) so output is deterministic for a given input — golden
 * tests can compare archives byte-for-byte.
 */
export function writeZip(entries: readonly ZipEntry[], mtime: Date): Uint8Array {
  const dosTime = toDosTime(mtime);
  const dosDate = toDosDate(mtime);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = utf8Encode(entry.name);
    const crc = crc32(entry.data);
    const deflated = new Uint8Array(deflateRawSync(entry.data));

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, METHOD_DEFLATE, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, deflated.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, METHOD_DEFLATE, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, deflated.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    chunks.push(local, deflated);
    central.push(centralHeader);
    offset += local.length + deflated.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const header of central) {
    chunks.push(header);
    centralSize += header.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  chunks.push(eocd);

  return concat(chunks);
}

function toDosTime(date: Date): number {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function toDosDate(date: Date): number {
  return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
