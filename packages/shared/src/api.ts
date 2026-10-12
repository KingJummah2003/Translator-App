import { z } from 'zod';
import { BUCKET_KINDS, REQUEST_LIMITS } from './plans';
import { isLanguageCode } from './languages';

/** Request and response shapes for the HTTP API, validated on both ends. */

const languageCode = z.string().min(2).max(12).refine(isLanguageCode, 'Unsupported language');

export const translateRequest = z.object({
  text: z.string().min(1).max(REQUEST_LIMITS.maxTextChars),
  source: z.union([z.literal('auto'), languageCode]),
  target: languageCode,
});
export type TranslateRequest = z.infer<typeof translateRequest>;

export interface TranslateResponse {
  translation: string;
  detectedSource: string | null;
  charged: number;
  balance: number;
}

export const ocrRequest = z.object({
  /** JPEG or PNG, base64 without the data: prefix. */
  image: z.string().min(1).max(Math.ceil((REQUEST_LIMITS.maxImageBytes * 4) / 3) + 4),
  /** When set, the recognised text is also translated in the same request. */
  target: languageCode.optional(),
});
export type OcrRequest = z.infer<typeof ocrRequest>;

export interface OcrResponse {
  text: string;
  translation: string | null;
  detectedSource: string | null;
  charged: number;
  balance: number;
}

export const DOCUMENT_TYPES = {
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;

export interface BucketSummary {
  kind: (typeof BUCKET_KINDS)[number];
  balance: number;
  expiresAt: string | null;
}

export interface Entitlements {
  tier: 'free' | 'credits' | 'pass' | 'pro' | 'vip';
  balance: number;
  buckets: BucketSummary[];
  subscription: { productId: string; expiresAt: string; willRenew: boolean } | null;
  pass: { expiresAt: string } | null;
  /** Unactivated 3-hour passes the user has bought. */
  passesAvailable: number;
  rateLimitPerMinute: number;
}

export interface ApiErrorBody {
  error: {
    code:
      | 'bad_request'
      | 'unauthorized'
      | 'forbidden'
      | 'not_found'
      | 'insufficient_credits'
      | 'rate_limited'
      | 'too_large'
      | 'service_paused'
      | 'upstream_error'
      | 'internal';
    message: string;
  };
}
