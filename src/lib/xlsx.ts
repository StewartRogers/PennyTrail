// A minimal .xlsx reader: cell values only, for the spreadsheet history
// import (docs/cash-flow-plan.md section 6.1). An .xlsx file is a zip of XML
// parts; this reads the zip directory, inflates the parts it needs with the
// platform's own DecompressionStream, and pulls cell values out of the
// sheet XML. Formatting, formulas, and styles are ignored — a formula cell
// yields its cached value, and a date cell yields its serial number (the
// history parser knows which column holds dates).
//
// Written instead of adding a spreadsheet package: the npm `xlsx` release
// carries unfixed advisories, and `exceljs` brings a large, dated dependency
// tree into a browser bundle for what is a one-time import.

export type XlsxCell = string | number | boolean | null;

export interface XlsxSheet {
  name: string;
  hidden: boolean;
  rows: XlsxCell[][];
}

type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

async function inflateRawDefault(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface ZipEntry {
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record sits in the last 22 bytes plus an
  // optional comment of up to 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not an .xlsx file (no zip directory found)");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("The .xlsx file's zip directory is damaged");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, { method, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipText(bytes: Uint8Array, entry: ZipEntry, inflate: Inflate): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localHeaderOffset;
  if (view.getUint32(at, true) !== 0x04034b50) throw new Error("The .xlsx file is damaged");
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  let raw: Uint8Array;
  if (entry.method === 0) raw = data;
  else if (entry.method === 8) raw = await inflate(data);
  else throw new Error(`Unsupported compression in .xlsx file (method ${entry.method})`);
  return new TextDecoder().decode(raw);
}

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, code: string) => {
    if (code === "amp") return "&";
    if (code === "lt") return "<";
    if (code === "gt") return ">";
    if (code === "quot") return '"';
    if (code === "apos") return "'";
    const n = code.startsWith("#x") ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return String.fromCodePoint(n);
  });
}

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = decodeXmlEntities(m[2]);
  return attrs;
}

// All <t> text inside a fragment, concatenated (rich text splits a string
// into runs), leaving out phonetic hints.
function textContent(fragment: string): string {
  const withoutPhonetic = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let text = "";
  for (const m of withoutPhonetic.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) text += decodeXmlEntities(m[1] ?? "");
  return text;
}

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textContent(m[1]));
}

export function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseSheetXml(xml: string, shared: string[]): XlsxCell[][] {
  const rows: XlsxCell[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowAttrs = attributes(rowMatch[1]);
    const rowIndex = rowAttrs.r ? Number(rowAttrs.r) - 1 : rows.length;
    const cells: XlsxCell[] = [];
    let nextCol = 0;
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = attributes(cellMatch[1]);
      const col = attrs.r ? columnIndex(attrs.r) : nextCol;
      nextCol = col + 1;
      const inner = cellMatch[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value: XlsxCell = null;
      switch (attrs.t) {
        case "s":
          value = v !== undefined ? (shared[Number(v)] ?? null) : null;
          break;
        case "inlineStr":
          value = textContent(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
          break;
        case "str":
          value = v !== undefined ? decodeXmlEntities(v) : null;
          break;
        case "b":
          value = v === "1";
          break;
        case "e":
          value = null;
          break;
        default:
          value = v !== undefined && v.trim() !== "" ? Number(v) : null;
          if (typeof value === "number" && !Number.isFinite(value)) value = null;
      }
      cells[col] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
    rows[rowIndex] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = [];
  return rows;
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return "xl/" + target.replace(/^\.\//, "");
}

export async function readXlsx(data: ArrayBuffer | Uint8Array, inflate: Inflate = inflateRawDefault): Promise<XlsxSheet[]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const zip = readZipDirectory(bytes);
  const text = async (path: string) => {
    const entry = zip.get(path);
    return entry ? readZipText(bytes, entry, inflate) : null;
  };

  const workbook = await text("xl/workbook.xml");
  if (!workbook) throw new Error("Not an .xlsx workbook (xl/workbook.xml is missing)");
  const rels = (await text("xl/_rels/workbook.xml.rels")) ?? "";
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const attrs = attributes(m[0]);
    if (attrs.Id && attrs.Target) targets.set(attrs.Id, resolveTarget(attrs.Target));
  }
  const sharedXml = await text("xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  const sheets: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const attrs = attributes(m[0]);
    const path = targets.get(attrs["r:id"] ?? "");
    if (!attrs.name || !path) continue;
    const xml = await text(path);
    if (xml === null) continue;
    sheets.push({ name: attrs.name, hidden: attrs.state === "hidden" || attrs.state === "veryHidden", rows: parseSheetXml(xml, shared) });
  }
  return sheets;
}
