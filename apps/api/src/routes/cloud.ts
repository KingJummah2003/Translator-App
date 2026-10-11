import { Hono } from 'hono';
import {
  COSTS,
  DocumentTooComplexError,
  REQUEST_LIMITS,
  batchSegments,
  splitLong,
  type Tier,
  extractDocument,
  isLanguageCode,
  isRtl,
  ocrRequest,
  totalChars,
  translateRequest,
  type OcrResponse,
  type TranslateResponse,
} from '@translator/shared';
import { charge, getBalance, getTier, refund, type Charge } from '../credits';
import { ApiError } from '../errors';
import type { AppEnv } from '../env';
import { getProvider, type TranslationProvider } from '../providers';
import { assertWithinBudget, recordUsage, type Action } from '../usage';
import { parseJson } from '../validate';

/**
 * Paid cloud features. Each one follows the same order:
 * validate → check service budget → charge credits → call provider → refund on failure.
 */
export const cloud = new Hono<AppEnv>();

cloud.post('/translate', async (c) => {
  const body = await parseJson(c, translateRequest);
  const { id: userId } = c.get('user');
  const chars = body.text.length;
  const tier = await getTier(c.env.DB, userId);

  const result = await runPaid(getProvider(c.env), c.env.DB, userId, tier, 'translate', chars, COSTS.translateText(chars), c.get('requestId'), (p) =>
    p.translate([body.text], body.source, body.target),
  );
  return c.json<TranslateResponse>({
    translation: result.value.translations[0] ?? '',
    detectedSource: result.value.detectedSource,
    charged: result.charged,
    balance: result.balance,
  });
});

/**
 * Reads the text in a photo, and translates it when `target` is given. Reading costs a
 * flat price; translating the text is charged like any other text, so a full page of
 * camera text costs the same as typing it.
 */
cloud.post('/ocr', async (c) => {
  const body = await parseJson(c, ocrRequest);
  const { id: userId } = c.get('user');
  if (base64Bytes(body.image) > REQUEST_LIMITS.maxImageBytes) throw new ApiError(413, 'too_large', 'That image is too large.');
  const provider = getProvider(c.env);
  const tier = await getTier(c.env.DB, userId);
  const requestId = c.get('requestId');

  const ocr = await runPaid(provider, c.env.DB, userId, tier, 'ocr', 0, COSTS.ocrImage(), requestId, (p) => p.ocr(body.image));
  let { charged, balance } = ocr;
  let detectedSource = ocr.value.detectedSource;
  let translation: string | null = null;

  const text = ocr.value.text.slice(0, REQUEST_LIMITS.maxTextChars);
  if (body.target && text.trim()) {
    try {
      const t = await runPaid(provider, c.env.DB, userId, tier, 'translate', text.length, COSTS.translateText(text.length), requestId, (p) =>
        p.translate([text], detectedSource ?? 'auto', body.target!),
      );
      translation = t.value.translations[0] ?? '';
      detectedSource ??= t.value.detectedSource;
      charged += t.charged;
      balance = t.balance;
    } catch (err) {
      // Not enough credits left to translate: still return the text that was read.
      if (!(err instanceof ApiError && err.code === 'insufficient_credits')) throw err;
    }
  }
  return c.json<OcrResponse>({ text: ocr.value.text, translation, detectedSource, charged, balance });
});

/**
 * Multipart upload: file (txt or docx), source ('auto' or code), target.
 * Responds with the translated file. Neither file is stored.
 */
cloud.post('/documents', async (c) => {
  const { id: userId } = c.get('user');
  const form = await c.req.formData().catch(() => {
    throw new ApiError(400, 'bad_request', 'Expected a multipart form upload.');
  });
  const file = form.get('file');
  const source = String(form.get('source') ?? 'auto');
  const target = String(form.get('target') ?? '');
  if (!(file instanceof File)) throw new ApiError(400, 'bad_request', 'Missing file.');
  if (file.size > REQUEST_LIMITS.maxDocumentBytes) throw new ApiError(413, 'too_large', 'That file is too large (10 MB max).');
  if (!isLanguageCode(target) || (source !== 'auto' && !isLanguageCode(source))) {
    throw new ApiError(400, 'bad_request', 'Unsupported language.');
  }

  const type = documentType(file.name);
  if (type === 'pdf') {
    throw new ApiError(400, 'bad_request', 'PDF translation is coming soon. Please use a Word (.docx) or text file.');
  }
  let doc;
  try {
    doc = extractDocument(type, new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof DocumentTooComplexError) throw new ApiError(413, 'too_large', err.message);
    throw new ApiError(400, 'bad_request', 'That file could not be read. Is it a valid document?');
  }
  const chars = totalChars(doc.segments);
  if (chars === 0) throw new ApiError(400, 'bad_request', 'That document has no text to translate.');
  const tier = await getTier(c.env.DB, userId);
  if (chars > REQUEST_LIMITS.maxDocumentChars[tier]) {
    throw new ApiError(413, 'too_large', `That document is too long for your plan (${REQUEST_LIMITS.maxDocumentChars[tier].toLocaleString('en')} characters max).`);
  }

  const provider = getProvider(c.env);
  const result = await runPaid(provider, c.env.DB, userId, tier, 'document', chars, COSTS.translateDocument(chars), c.get('requestId'), async (p) => {
    // Very long paragraphs are split into pieces the provider accepts, then rejoined.
    const pieces: string[] = [];
    const owner: number[] = [];
    doc.segments.forEach((segment, i) => {
      for (const piece of splitLong(segment, p.maxBatchChars)) {
        pieces.push(piece);
        owner.push(i);
      }
    });
    const translated: string[] = new Array(pieces.length);
    let detected: string | null = null;
    for (const batch of batchSegments(pieces, p.maxBatchChars)) {
      for (let i = 0; i < batch.texts.length; i += p.maxBatchSegments) {
        const texts = batch.texts.slice(i, i + p.maxBatchSegments);
        const r = await p.translate(texts, detected ?? source, target);
        detected ??= r.detectedSource;
        r.translations.forEach((t, j) => (translated[batch.indexes[i + j]!] = t));
      }
    }
    const out: string[] = doc.segments.map(() => '');
    translated.forEach((t, k) => (out[owner[k]!] += t));
    return doc.rebuild(out, { rtl: isRtl(target) });
  });

  const name = file.name.replace(/\.[^.]+$/, '') + `.${target}.${type}`;
  return new Response(result.value, {
    headers: {
      'content-type': type === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'x-credits-charged': String(result.charged),
      'x-credits-balance': String(result.balance),
      'cache-control': 'no-store',
    },
  });
});

/* ------------------------------------------------------------------ helpers */

async function runPaid<T>(
  provider: TranslationProvider,
  db: D1Database,
  userId: string,
  tier: Tier,
  action: Action,
  chars: number,
  credits: number,
  requestId: string,
  work: (p: TranslationProvider) => Promise<T>,
): Promise<{ value: T; charged: number; balance: number }> {
  await assertWithinBudget(db, action, chars, tier);
  const taken: Charge = await charge(db, userId, credits, action, requestId);
  let value: T;
  try {
    value = await work(provider);
  } catch (err) {
    // The user gets their credits back, but the provider may already have billed part of
    // the work, so it still counts toward the service's daily cap.
    await refund(db, taken, requestId);
    await recordUsage(db, userId, action, chars, 0, tier).catch(() => {});
    throw err;
  }
  await recordUsage(db, userId, action, chars, credits, tier);
  return { value, charged: credits, balance: await getBalance(db, userId) };
}

function documentType(name: string): 'txt' | 'docx' | 'pdf' {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'txt' || ext === 'docx' || ext === 'pdf') return ext;
  throw new ApiError(400, 'bad_request', 'Supported files: .docx and .txt.');
}

function base64Bytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}
