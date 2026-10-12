import { File, Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { buildDocx, getLanguage, isRtl, pdfTextToParagraphs, translateEnhanced, translateProtected } from '@translator/shared';
import { TranslatorNative, translationAvailable } from 'translator-native';
import { Text } from '@/components/Text';
import { space, useColors } from '@/theme';

/**
 * DEVELOPMENT-ONLY translation test harness (does nothing in release builds).
 *
 * Reads <app files>/<job>.json, translates every segment from English into each listed
 * language with the on-device engine, back-translates to English, and writes one result
 * file per language plus a translated Word file, so accuracy can be reviewed offline.
 * Driven by e2e/translation-test.mjs over adb.
 */
interface Job {
  id: string;
  languages: string[];
  segments?: { id: string; text: string }[];
  /** A PDF in the app's files folder to read first (tests the PDF path too). */
  pdf?: string;
  deleteModelsAfter?: boolean;
  /** Also translate every segment through the English pre-editing pipeline (A/B comparison). */
  compareEnhanced?: boolean;
}

interface Item {
  id: string;
  source: string;
  forward: string;
  back: string;
  forwardMs: number;
  backMs: number;
  forwardEnh?: string;
  backEnh?: string;
  forwardEnhMs?: number;
}

export default function BatchHarness() {
  const c = useColors();
  const { job: jobName = 'job.json' } = useLocalSearchParams<{ job?: string }>();
  const [lines, setLines] = useState<string[]>([]);
  const started = useRef(false);
  const log = (line: string) => setLines((l) => [...l.slice(-200), line]);

  useEffect(() => {
    if (!__DEV__ || started.current) return;
    started.current = true;
    void run(jobName, log).catch((e: Error) => log(`FAILED: ${e.message}`));
  }, [jobName]);

  if (!__DEV__) return null;
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.body}>
      <Text variant="heading">Translation test harness</Text>
      {lines.map((l, i) => (
        <Text key={i} variant="caption" style={styles.mono}>
          {l}
        </Text>
      ))}
    </ScrollView>
  );
}

async function run(jobName: string, log: (l: string) => void) {
  if (!translationAvailable) throw new Error('on-device translation unavailable in this build');
  const job = JSON.parse(await new File(Paths.document, jobName).text()) as Job;
  let segments = job.segments ?? [];

  if (job.pdf) {
    const t = Date.now();
    const pdf = await TranslatorNative.extractPdfText(new File(Paths.document, job.pdf).uri, ['en'], 20);
    const paragraphs = pdfTextToParagraphs(pdf.pages);
    segments = [...segments, ...paragraphs.map((p, i) => ({ id: `cv-${i + 1}`, text: p.text }))];
    write(`${job.id}-pdf.json`, { pages: pdf.pages, paragraphs, ms: Date.now() - t });
    log(`PDF: ${pdf.pageCount} pages, ${segments.length} paragraphs in ${Date.now() - t} ms`);
  }

  await TranslatorNative.downloadModel('en', false);
  for (const lang of job.languages) {
    if (lang === 'en' || !getLanguage(lang)?.offline) continue;
    const outName = `${job.id}-${lang}.json`;
    if (new File(Paths.document, outName).exists) {
      log(`${lang}: already done`);
      continue;
    }
    try {
      const dl = Date.now();
      await withTimeout(TranslatorNative.downloadModel(lang, false), 180_000, 'model download timed out');
      const downloadMs = Date.now() - dl;
      const items: Item[] = [];
      for (const s of segments) {
        const a = Date.now();
        const forward = await translateProtected(s.text, (t) => TranslatorNative.translate(t, 'en', lang));
        const b = Date.now();
        const back = await translateProtected(forward, (t) => TranslatorNative.translate(t, lang, 'en'));
        const item: Item = { id: s.id, source: s.text, forward, back, forwardMs: b - a, backMs: Date.now() - b };
        if (job.compareEnhanced) {
          const c = Date.now();
          const enhanced = await translateEnhanced(s.text, 'en', lang, (t) => TranslatorNative.translate(t, 'en', lang));
          const d = Date.now();
          item.forwardEnh = enhanced;
          item.backEnh = await translateProtected(enhanced, (t) => TranslatorNative.translate(t, lang, 'en'));
          item.forwardEnhMs = d - c;
        }
        items.push(item);
      }
      const detected = await TranslatorNative.identifyLanguage(items.map((i) => i.forward).join(' ').slice(0, 500));
      write(outName, { lang, downloadMs, detected, items });
      const docx = buildDocx(
        items.map((i) => ({ text: i.forward, kind: 'paragraph' as const })),
        { rtl: isRtl(lang), title: `${job.id} (${lang})` },
      );
      const docFile = new File(Paths.document, `${job.id}-${lang}.docx`);
      docFile.create({ overwrite: true });
      docFile.write(docx);
      const avg = Math.round(items.reduce((s, i) => s + i.forwardMs, 0) / Math.max(1, items.length));
      log(`${lang}: ${items.length} segments, avg ${avg} ms, detected ${detected}`);
      if (job.deleteModelsAfter) await TranslatorNative.deleteModel(lang);
    } catch (e) {
      write(outName, { lang, error: (e as Error).message });
      log(`${lang}: ERROR ${(e as Error).message}`);
    }
  }
  write(`${job.id}-done.json`, { done: true });
  log('DONE');
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

function write(name: string, data: unknown) {
  const f = new File(Paths.document, name);
  f.create({ overwrite: true });
  f.write(JSON.stringify(data));
}

const styles = StyleSheet.create({
  body: { padding: space.lg, paddingTop: 80, gap: 4 },
  mono: { fontFamily: 'monospace' },
});
