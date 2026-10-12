// Runs the on-device translation harness (src/app/dev/batch.tsx) on the Android emulator.
//
//   node e2e/translation-test.mjs <jobId> <segments.json|file.pdf> <outDir> [lang,lang,...]
//
// segments.json: [{ id, text }] in English. A .pdf is copied into the app and read on the
// device (tests the PDF path too). Results (<jobId>-<lang>.json and .docx) are copied to
// <outDir>. Languages default to every offline language. Re-running resumes.
// Several inputs can be combined with '+': corpus.json+cv.pdf
// COMPARE=1 also runs each segment through the English pre-editing pipeline (forwardEnh/backEnh).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { OFFLINE_LANGUAGE_CODES } from '../../../packages/shared/src/languages.ts';
import { appFileExists, launch, openLink, readAppFile, sleep, writeAppFile } from './driver.mjs';

const [jobId, input, outDir, langArg] = process.argv.slice(2);
if (!jobId || !input || !outDir) {
  console.error('usage: node e2e/translation-test.mjs <jobId> <segments.json|file.pdf> <outDir> [langs]');
  process.exit(1);
}
const languages = langArg ? langArg.split(',') : OFFLINE_LANGUAGE_CODES.filter((c) => c !== 'en');
mkdirSync(outDir, { recursive: true });

// <input> may list several files separated by '+', e.g. corpus.json+cv.pdf
const job = { id: jobId, languages, deleteModelsAfter: true, compareEnhanced: process.env.COMPARE === '1', segments: [] };
for (const part of input.split('+')) {
  if (part.endsWith('.pdf')) {
    writeAppFile(`files/${basename(part)}`, readFileSync(part));
    job.pdf = basename(part);
  } else {
    job.segments.push(...JSON.parse(readFileSync(part, 'utf8')).map((s) => ({ id: String(s.id), text: s.text })));
  }
}
writeAppFile(`files/${jobId}.job.json`, JSON.stringify(job));

const exists = (name) => appFileExists(`files/${name}`);

launch();
await sleep(8000);
openLink(`dev/batch?job=${jobId}.job.json`);

const started = Date.now();
const pulled = new Set();
for (;;) {
  for (const lang of languages) {
    if (pulled.has(lang)) continue;
    if (exists(`${jobId}-${lang}.json`)) {
      writeFileSync(join(outDir, `${jobId}-${lang}.json`), readAppFile(`files/${jobId}-${lang}.json`));
      try {
        writeFileSync(join(outDir, `${jobId}-${lang}.docx`), readAppFile(`files/${jobId}-${lang}.docx`));
      } catch {
        // no docx when the language failed
      }
      pulled.add(lang);
      console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${lang} (${pulled.size}/${languages.length})`);
    }
  }
  if (exists(`${jobId}-done.json`) && pulled.size >= languages.length) break;
  if (Date.now() - started > 3 * 60 * 60 * 1000) throw new Error('timed out after 3 hours');
  await sleep(5000);
}
if (job.pdf) writeFileSync(join(outDir, `${jobId}-pdf.json`), readAppFile(`files/${jobId}-pdf.json`));
console.log(`done: ${pulled.size} languages in ${Math.round((Date.now() - started) / 1000)}s`);
