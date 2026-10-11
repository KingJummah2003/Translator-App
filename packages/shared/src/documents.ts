import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

/**
 * Document translation helpers that run the same way on the phone (offline) and in the
 * Worker (cloud). A document is turned into a list of text segments, the caller
 * translates them, and the document is rebuilt with the translations in place.
 *
 * Word files keep their styles, tables, images, headers and footers. Text inside one
 * paragraph is translated as a whole (so sentences split across bold/italic runs still
 * translate correctly) and written into the paragraph's first run.
 */

export interface ExtractedDocument {
  segments: string[];
  rebuild(translations: string[], options?: { rtl?: boolean }): Uint8Array;
}

/* ------------------------------------------------------------------ plain text */

export function extractText(bytes: Uint8Array): ExtractedDocument {
  const source = strFromU8(bytes).replace(/^\uFEFF/, '');
  // Keep blank-line structure: translate each paragraph, keep separators as they were.
  const parts = source.split(/(\r?\n\s*\r?\n)/);
  if (parts.length > MAX_PARAGRAPHS * 2) throw new DocumentTooComplexError();
  const segmentIndexes: number[] = [];
  const segments: string[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 0 && part.trim()) {
      segmentIndexes.push(i);
      segments.push(part);
    }
  });
  return {
    segments,
    rebuild(translations) {
      assertSameLength(segments, translations);
      const out = [...parts];
      segmentIndexes.forEach((partIndex, i) => {
        out[partIndex] = translations[i]!;
      });
      return strToU8(out.join(''));
    },
  };
}

/* ------------------------------------------------------------------ Word (.docx) */

const DOCX_TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const MAX_UNZIPPED_BYTES = 60 * 1024 * 1024;
/** Limits that keep a small, malicious file from exhausting memory while it is parsed. */
const MAX_TEXT_XML_BYTES = 15 * 1024 * 1024;
const MAX_PARAGRAPHS = 50_000;

export class DocumentTooComplexError extends Error {
  constructor() {
    super('This document is too large or complex to translate.');
  }
}

interface TextNode {
  /** Index in the XML string where the text content starts and ends. */
  start: number;
  end: number;
}

interface Paragraph {
  part: string;
  /** Index right after the opening <w:p ...> tag, used to add RTL paragraph properties. */
  openEnd: number;
  texts: TextNode[];
}

export function extractDocx(bytes: Uint8Array): ExtractedDocument {
  let total = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      total += file.originalSize;
      if (total > MAX_UNZIPPED_BYTES) throw new Error('Document is too large when unpacked');
      return true;
    },
  });
  if (!files['word/document.xml']) throw new Error('Not a Word document');

  const xml: Record<string, string> = {};
  const paragraphs: Paragraph[] = [];
  let xmlBytes = 0;
  for (const name of Object.keys(files).sort()) {
    if (!DOCX_TEXT_PARTS.test(name)) continue;
    xmlBytes += files[name]!.length;
    if (xmlBytes > MAX_TEXT_XML_BYTES) throw new DocumentTooComplexError();
    xml[name] = strFromU8(files[name]!);
    for (const p of scanParagraphs(name, xml[name]!, MAX_PARAGRAPHS - paragraphs.length)) paragraphs.push(p);
  }

  const withText = paragraphs.filter((p) =>
    p.texts.some((t) => xml[p.part]!.slice(t.start, t.end).trim().length > 0),
  );
  const segments = withText.map((p) =>
    p.texts.map((t) => decodeXml(xml[p.part]!.slice(t.start, t.end))).join(''),
  );

  return {
    segments,
    rebuild(translations, options = {}) {
      assertSameLength(segments, translations);
      const edits: Record<string, { start: number; end: number; value: string }[]> = {};
      withText.forEach((p, i) => {
        const list = (edits[p.part] ??= []);
        p.texts.forEach((t, j) => {
          list.push({ start: t.start, end: t.end, value: j === 0 ? encodeXml(translations[i]!) : '' });
        });
        if (options.rtl) list.push(bidiEdit(xml[p.part]!, p.openEnd));
      });

      const out: Zippable = {};
      for (const [name, data] of Object.entries(files)) {
        const partEdits = edits[name];
        out[name] = partEdits ? strToU8(applyEdits(xml[name]!, partEdits)) : data;
      }
      return zipSync(out, { level: 6 });
    },
  };
}

/** Finds every paragraph and the text nodes that belong to it (innermost paragraph wins). */
function scanParagraphs(part: string, source: string, budget: number): Paragraph[] {
  const found: Paragraph[] = [];
  const stack: Paragraph[] = [];
  const tag = /<(\/?)w:(p|t)\b([^>]*)>/g;
  let textStart = -1;
  for (let m = tag.exec(source); m; m = tag.exec(source)) {
    const [whole, closing, name, attrs] = m;
    const selfClosing = attrs!.endsWith('/');
    if (name === 'p') {
      if (closing) {
        const p = stack.pop();
        if (p) found.push(p);
        if (found.length > budget) throw new DocumentTooComplexError();
      } else if (!selfClosing) {
        stack.push({ part, openEnd: m.index + whole.length, texts: [] });
      }
    } else if (closing) {
      if (textStart >= 0 && stack.length) stack[stack.length - 1]!.texts.push({ start: textStart, end: m.index });
      textStart = -1;
    } else if (!selfClosing) {
      textStart = m.index + whole.length;
    }
  }
  return found;
}

// Elements that must come after <w:bidi/> inside <w:pPr> (ECMA-376 CT_PPrBase order).
const AFTER_BIDI =
  /<w:(adjustRightInd|snapToGrid|spacing|ind|contextualSpacing|mirrorIndents|suppressOverlap|jc|textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)\b/;

/** Edit that marks a paragraph right-to-left, keeping Word's required element order. */
function bidiEdit(source: string, openEnd: number): { start: number; end: number; value: string } {
  if (source.startsWith('<w:pPr/>', openEnd)) {
    return { start: openEnd, end: openEnd + 8, value: '<w:pPr><w:bidi/></w:pPr>' };
  }
  if (!source.startsWith('<w:pPr>', openEnd) && !source.startsWith('<w:pPr ', openEnd)) {
    return { start: openEnd, end: openEnd, value: '<w:pPr><w:bidi/></w:pPr>' };
  }
  const contentStart = source.indexOf('>', openEnd) + 1;
  const close = source.indexOf('</w:pPr>', contentStart);
  const content = source.slice(contentStart, close);
  if (content.includes('<w:bidi')) return { start: contentStart, end: contentStart, value: '' };
  const next = AFTER_BIDI.exec(content);
  const at = next ? contentStart + next.index : close;
  return { start: at, end: at, value: '<w:bidi/>' };
}

function applyEdits(source: string, edits: { start: number; end: number; value: string }[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let cursor = 0;
  for (const e of sorted) {
    out += source.slice(cursor, e.start) + e.value;
    cursor = e.end;
  }
  return out + source.slice(cursor);
}

/* ------------------------------------------------------------------ helpers */

export function extractDocument(type: 'txt' | 'docx', bytes: Uint8Array): ExtractedDocument {
  return type === 'docx' ? extractDocx(bytes) : extractText(bytes);
}

/**
 * Packs segments into batches no larger than `maxChars` each so a provider can translate
 * many short paragraphs in one call.
 */
export function batchSegments(segments: string[], maxChars: number): { indexes: number[]; texts: string[] }[] {
  const batches: { indexes: number[]; texts: string[] }[] = [];
  let current = { indexes: [] as number[], texts: [] as string[], size: 0 };
  const flush = () => {
    if (current.texts.length) batches.push({ indexes: current.indexes, texts: current.texts });
    current = { indexes: [], texts: [], size: 0 };
  };
  segments.forEach((text, index) => {
    if (current.size + text.length > maxChars) flush();
    current.indexes.push(index);
    current.texts.push(text);
    current.size += text.length;
  });
  flush();
  return batches;
}

/**
 * Splits text longer than `maxChars` into pieces, preferring sentence ends, then spaces.
 * Each piece keeps its trailing whitespace, so joining the translated pieces with ''
 * restores the spacing.
 */
export function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    // End of the last sentence mark (including its space) in the window, if any.
    const sentenceEnd = Math.max(
      ...['. ', '! ', '? ', '؟ ', '。', '\n'].map((m) => {
        const i = window.lastIndexOf(m);
        return i < 0 ? -1 : i + m.length;
      }),
    );
    const space = window.lastIndexOf(' ');
    const cut = sentenceEnd > maxChars / 2 ? sentenceEnd : space > maxChars / 2 ? space + 1 : maxChars;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export function totalChars(segments: string[]): number {
  return segments.reduce((sum, s) => sum + s.length, 0);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function encodeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function assertSameLength(segments: string[], translations: string[]): void {
  if (segments.length !== translations.length) {
    throw new Error(`Expected ${segments.length} translations, got ${translations.length}`);
  }
}
