import { Hono } from 'hono';
import {
  COSTS,
  REQUEST_LIMITS,
  batchSegments,
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

  const result = await runPaid(getProvider(c.env), c.env.DB, userId, 'translate', chars, COSTS.translateText(chars), c.get('requestId'), (p) =>
    p.translate([body.text], body.source, body.target),
  );
  return c.json<TranslateResponse>({
    translation: result.value.translations[0] ?? '',
    detectedSource: result.value.detectedSource,
    charged: result.charged,
    balance: result.balance,
  });
});

cloud.post('/ocr', async (c) => {
  const body = await parseJson(c, ocrRequest);
  const { id: userId } = c.get('user');
  if (base64Bytes(body.image) > REQUEST_LIMITS.maxImageBytes) throw new ApiError(413, 'too_large', 'That image is too large.');
  const provider = getProvider(c.env);

  const result = await runPaid(provider, c.env.DB, userId, 'ocr', 0, COSTS.ocrImage(), c.get('requestId'), async (p) => {
    const ocr = await p.ocr(body.image);
    if (!body.target || !ocr.text.trim()) return { ...ocr, translation: null };
    // Translating the recognised text is included in the OCR price up to the text limit.
    const text = ocr.text.slice(0, REQUEST_LIMITS.maxTextChars);
    const t = await p.translate([text], ocr.detectedSource ?? 'auto', body.target);
    return { ...ocr, translation: t.translations[0] ?? '', detectedSource: ocr.detectedSource ?? t.detectedSource };
  });
  return c.json<OcrResponse>({
    text: result.value.text,
    translation: result.value.translation,
    detectedSource: result.value.detectedSource,
    charged: result.charged,
    balance: result.balance,
  });
});

/**
 * Multipart upload: file (txt or docx), source ('auto' or code), target.
 * Responds with the translated file. Neither file is stored.
 */
cloud.post('/documents', async (c) => {
  const { id: userId } = c.get('user');
  const length = Number(c.req.header('content-length') ?? 0);
  if (length > REQUEST_LIMITS.maxDocumentBytes + 64 * 1024) throw new ApiError(413, 'too_large', 'That file is too large (10 MB max).');

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
  } catch {
    throw new ApiError(400, 'bad_request', 'That file could not be read. Is it a valid document?');
  }
  const chars = totalChars(doc.segments);
  if (chars === 0) throw new ApiError(400, 'bad_request', 'That document has no text to translate.');
  const tier = await getTier(c.env.DB, userId);
  if (chars > REQUEST_LIMITS.maxDocumentChars[tier]) {
    throw new ApiError(413, 'too_large', `That document is too long for your plan (${REQUEST_LIMITS.maxDocumentChars[tier].toLocaleString('en')} characters max).`);
  }

  const provider = getProvider(c.env);
  const result = await runPaid(provider, c.env.DB, userId, 'document', chars, COSTS.translateDocument(chars), c.get('requestId'), async (p) => {
    const out: string[] = new Array(doc.segments.length);
    let detected: string | null = null;
    for (const batch of batchSegments(doc.segments, p.maxBatchChars)) {
      for (let i = 0; i < batch.texts.length; i += p.maxBatchSegments) {
        const texts = batch.texts.slice(i, i + p.maxBatchSegments);
        const r = await p.translate(texts, detected ?? source, target);
        detected ??= r.detectedSource;
        r.translations.forEach((t, j) => (out[batch.indexes[i + j]!] = t));
      }
    }
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
  action: Action,
  chars: number,
  credits: number,
  requestId: string,
  work: (p: TranslationProvider) => Promise<T>,
): Promise<{ value: T; charged: number; balance: number }> {
  await assertWithinBudget(db, action, chars);
  const taken: Charge = await charge(db, userId, credits, action, requestId);
  let value: T;
  try {
    value = await work(provider);
  } catch (err) {
    await refund(db, taken, requestId);
    throw err;
  }
  await recordUsage(db, userId, action, chars, credits);
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
