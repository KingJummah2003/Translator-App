import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { DocumentTooComplexError, batchSegments, extractDocx, extractText, splitLong } from './documents';

function makeDocx(body: string): Uint8Array {
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(doc),
    'word/media/image1.png': new Uint8Array([1, 2, 3]),
  });
}

const readDocument = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);

describe('extractText', () => {
  it('translates paragraphs and keeps blank-line separators', () => {
    const doc = extractText(strToU8('﻿Hello world\n\nSecond para\r\n\r\n'));
    expect(doc.segments).toEqual(['Hello world', 'Second para']);
    expect(strFromU8(doc.rebuild(['مرحبا', 'ثاني']))).toBe('مرحبا\n\nثاني\r\n\r\n');
  });

  it('rejects a translation count mismatch', () => {
    expect(() => extractText(strToU8('a')).rebuild([])).toThrow(/Expected 1/);
  });
});

describe('extractDocx', () => {
  it('joins runs per paragraph and keeps formatting elements', () => {
    const bytes = makeDocx(
      '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r><w:r><w:t xml:space="preserve">big &amp; small</w:t></w:r></w:p>' +
        '<w:p/><w:p><w:r><w:tab/><w:t></w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    );
    const doc = extractDocx(bytes);
    expect(doc.segments).toEqual(['Hello big & small', 'Cell']);

    const out = doc.rebuild(['Hola <grande>', 'Celda']);
    const xml = readDocument(out);
    expect(xml).toContain('<w:t>Hola &lt;grande&gt;</w:t>');
    expect(xml).toContain('<w:t xml:space="preserve"></w:t>');
    expect(xml).toContain('<w:pStyle w:val="Title"/>');
    expect(xml).toContain('<w:t>Celda</w:t>');
    expect(unzipSync(out)['word/media/image1.png']).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('marks paragraphs right-to-left in schema order', () => {
    const bytes = makeDocx(
      '<w:p><w:pPr><w:pStyle w:val="A"/><w:jc w:val="left"/></w:pPr><w:r><w:t>One</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Two</w:t></w:r></w:p>' +
        '<w:p><w:pPr/><w:r><w:t>Three</w:t></w:r></w:p>',
    );
    const xml = readDocument(extractDocx(bytes).rebuild(['١', '٢', '٣'], { rtl: true }));
    expect(xml).toContain('<w:pPr><w:pStyle w:val="A"/><w:bidi/><w:jc w:val="left"/></w:pPr>');
    expect(xml).toContain('<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>٢</w:t>');
    expect(xml).toContain('<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>٣</w:t>');
  });

  it('assigns text in a nested text box to the inner paragraph', () => {
    const bytes = makeDocx(
      '<w:p><w:r><w:t>Outer</w:t></w:r><w:r><w:txbxContent><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:txbxContent></w:r></w:p>',
    );
    expect(extractDocx(bytes).segments.sort()).toEqual(['Inner', 'Outer']);
  });

  it('rejects files that are not Word documents', () => {
    expect(() => extractDocx(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/Not a Word document/);
  });
});

describe('batchSegments', () => {
  it('groups segments under the size limit and keeps their positions', () => {
    expect(batchSegments(['aaa', 'bb', 'cccc', 'd'], 5)).toEqual([
      { indexes: [0, 1], texts: ['aaa', 'bb'] },
      { indexes: [2, 3], texts: ['cccc', 'd'] },
    ]);
  });
});

describe('limits', () => {
  it('rejects a tiny file with a huge number of paragraphs before using lots of memory', () => {
    const body = '<w:p/><w:p></w:p>'.repeat(60_000);
    expect(() => extractDocx(makeDocx(body))).toThrow(DocumentTooComplexError);
  });

  it('splits long text on sentence ends and rejoins without losing characters', () => {
    const text = 'One two three. '.repeat(50);
    const parts = splitLong(text, 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join('')).toBe(text);
    expect(parts[0]!.endsWith('. ')).toBe(true);
  });

  it('hard-splits text without spaces', () => {
    const parts = splitLong('x'.repeat(250), 100);
    expect(parts.map((p) => p.length)).toEqual([100, 100, 50]);
  });
});
