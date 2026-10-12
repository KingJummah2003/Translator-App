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

/* ------------------------------------------------------------------ new Word files */

export interface DocxParagraph {
  text: string;
  kind?: 'heading' | 'paragraph' | 'bullet';
}

/**
 * Builds a minimal, valid Word document from paragraphs. Used for PDF translations, where
 * the original layout can't be edited, so the translated text is delivered as Word.
 */
export function buildDocx(paragraphs: DocxParagraph[], options: { rtl?: boolean; title?: string } = {}): Uint8Array {
  const rtl = options.rtl ? '<w:bidi/>' : '';
  const runRtl = options.rtl ? '<w:rtl/>' : '';
  const body = paragraphs
    .map((p) => {
      const style = p.kind === 'heading' ? '<w:b/><w:sz w:val="32"/>' : '';
      const indent = p.kind === 'bullet' ? '<w:ind w:start="360" w:hanging="360"/>' : '';
      const text = p.kind === 'bullet' ? `• ${p.text}` : p.text;
      const runs = text
        .split('\n')
        .map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:rPr>${style}${runRtl}</w:rPr><w:t xml:space="preserve">${encodeXml(line)}</w:t></w:r>`)
        .join('');
      return `<w:p><w:pPr>${rtl}<w:spacing w:after="160"/>${indent}</w:pPr>${runs}</w:p>`;
    })
    .join('');
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>',
    ),
    'docProps/core.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        `<dc:title>${encodeXml(options.title ?? 'Translation')}</dc:title></cp:coreProperties>`,
    ),
    'word/document.xml': strToU8(document),
  };
  return zipSync(files, { level: 6 });
}

/**
 * Turns text extracted from a PDF page into paragraphs: blank lines separate paragraphs,
 * short lines that look like headings stay on their own, and wrapped lines are joined.
 */
export function pdfTextToParagraphs(pages: string[]): DocxParagraph[] {
  const out: DocxParagraph[] = [];
  // OCR often reads a bullet glyph as '.', '·' or 'e', so those count too before a capital letter.
  const bulletMark = /^(?:[•\-–*▪●◦]\s+|[.·]\s+(?=\p{Lu})|e\s+(?=\p{Lu}))/u;
  const endsSentence = (t: string) => /[.!?:;。؟!…)"'”]$/.test(t);
  const isHeading = (line: string, alone: boolean) =>
    line.length <= 40 && !/[.,;:!?،؛]$/.test(line) && (/^[\p{Lu}\d\s&/+-]+$/u.test(line) || alone);
  for (const page of pages) {
    const lines = page.replace(/\r/g, '').split('\n').map((l) => l.trim());
    let blankBefore = true;
    lines.forEach((line, i) => {
      if (!line) {
        blankBefore = true;
        return;
      }
      const last = out[out.length - 1];
      const nextBlank = !lines[i + 1];
      if (bulletMark.test(line)) {
        out.push({ text: line.replace(bulletMark, ''), kind: 'bullet' });
      } else if (isHeading(line, blankBefore && nextBlank) && !/^\p{Ll}/u.test(line)) {
        out.push({ text: line, kind: 'heading' });
      } else if (last && last.kind !== 'heading' && (!endsSentence(last.text) || /^\p{Ll}/u.test(line)) && !(blankBefore && /^\p{Lu}/u.test(line) && endsSentence(last.text))) {
        // A wrapped line (OCR and PDF text often split sentences and bullets across lines,
        // sometimes with a blank line in between): continue the previous paragraph.
        last.text = `${last.text} ${line}`;
      } else {
        out.push({ text: line, kind: 'paragraph' });
      }
      blankBefore = false;
    });
  }
  return out;
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
