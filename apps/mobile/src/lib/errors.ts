import { DocumentTooComplexError, isLanguageCode } from '@translator/shared';
import { nativeErrorCode } from 'translator-native';
import { ApiError } from './api';
import { formatList, languageName, t, type StringKey } from './i18n';

/**
 * Turns any failure into a short message in the interface language. Screens never show
 * `e.message`: server text, native exceptions and library errors are English (or worse,
 * internal), so everything is mapped to a stable code first and the code to a string.
 *
 * Understands: ApiError codes, native module codes (MODEL_MISSING:xx, BAD_PDF, …), speech
 * errors (SpeechError and raw recognizer codes), better-auth, Apple and Google sign-in,
 * RevenueCat, local authentication results, fetch failures and user cancellations.
 */

export type ErrorCode =
  // API and network
  | 'network'
  | 'timeout'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'insufficient_credits'
  | 'rate_limited'
  | 'too_large'
  | 'service_paused'
  | 'upstream_error'
  | 'internal'
  // on-device translation, camera and documents
  | 'model_missing'
  | 'download_failed'
  | 'delete_failed'
  | 'unsupported_language'
  | 'on_device_unavailable'
  | 'translate_failed'
  | 'detect_failed'
  | 'bad_image'
  | 'ocr_failed'
  | 'ocr_unavailable'
  | 'bad_pdf'
  | 'locked_pdf'
  | 'bad_document'
  | 'document_too_complex'
  // speech recognition
  | 'speech_permission'
  | 'speech_blocked'
  | 'speech_unavailable'
  | 'speech_not_allowed'
  | 'speech_language'
  | 'speech_no_speech'
  | 'speech_network'
  | 'speech_busy'
  | 'speech_interrupted'
  | 'speech_audio'
  | 'speech_timeout'
  | 'speech_failed'
  // sign-in
  | 'auth_invalid_credentials'
  | 'auth_invalid_email'
  | 'auth_invalid_code'
  | 'auth_code_expired'
  | 'auth_too_many_attempts'
  | 'auth_user_exists'
  | 'auth_password_too_short'
  | 'auth_password_too_long'
  | 'auth_email_not_verified'
  | 'auth_failed'
  | 'play_services'
  // purchases
  | 'purchases_unavailable'
  | 'purchase_sign_in_required'
  | 'purchase_in_progress'
  | 'payment_pending'
  | 'store_problem'
  | 'purchase_not_allowed'
  | 'already_owned'
  | 'receipt_in_use'
  | 'product_unavailable'
  // app lock
  | 'biometric_lockout'
  | 'biometric_unavailable'
  | 'biometric_failed'
  // the user backed out: show nothing
  | 'cancelled'
  | 'unknown';

/** What a banner can offer next to the message. */
export type ErrorAction = 'getCredits' | 'signIn' | 'openSettings' | 'download' | 'chooseLanguage' | 'restorePurchases';

export interface AppError {
  code: ErrorCode;
  /** Ready to show; empty for cancellations. */
  message: string;
  action?: ErrorAction;
  /** Languages the error is about: models to download, or the unsupported language. */
  languages?: string[];
}

interface Classified {
  code: ErrorCode;
  languages?: string[];
}

/* ------------------------------------------------------------------ messages */

const MESSAGES: Record<Exclude<ErrorCode, 'cancelled'>, StringKey> = {
  network: 'errorNetwork',
  timeout: 'errorTimeout',
  bad_request: 'errorBadRequest',
  unauthorized: 'errorUnauthorized',
  forbidden: 'errorForbidden',
  not_found: 'errorNotFound',
  conflict: 'passAlreadyActive', // the API's only 409 today
  insufficient_credits: 'notEnoughCredits',
  rate_limited: 'errorRateLimited',
  too_large: 'errorTooLarge',
  service_paused: 'errorServicePaused',
  upstream_error: 'errorUpstream',
  internal: 'errorInternal',
  model_missing: 'downloadToUseOffline',
  download_failed: 'errorDownloadFailed',
  delete_failed: 'errorDeleteFailed',
  unsupported_language: 'errorUnsupportedLanguage',
  on_device_unavailable: 'errorOnDeviceUnavailable',
  translate_failed: 'errorTranslateFailed',
  detect_failed: 'detectFailed',
  bad_image: 'errorBadImage',
  ocr_failed: 'errorOcrFailed',
  ocr_unavailable: 'errorOcrUnavailable',
  bad_pdf: 'errorBadPdf',
  locked_pdf: 'pdfLocked',
  bad_document: 'errorBadDocument',
  document_too_complex: 'errorDocumentTooComplex',
  speech_permission: 'micPermission',
  speech_blocked: 'micBlocked',
  speech_unavailable: 'speechUnavailable',
  speech_not_allowed: 'speechNotAllowed',
  speech_language: 'speechLanguageUnsupported',
  speech_no_speech: 'speechNoSpeech',
  speech_network: 'speechNetwork',
  speech_busy: 'speechBusy',
  speech_interrupted: 'speechInterrupted',
  speech_audio: 'speechAudio',
  speech_timeout: 'speechTimeout',
  speech_failed: 'speechError',
  auth_invalid_credentials: 'errorInvalidCredentials',
  auth_invalid_email: 'invalidEmail',
  auth_invalid_code: 'errorInvalidCode',
  auth_code_expired: 'errorCodeExpired',
  auth_too_many_attempts: 'errorTooManyAttempts',
  auth_user_exists: 'errorUserExists',
  auth_password_too_short: 'errorPasswordTooShort',
  auth_password_too_long: 'errorPasswordTooLong',
  auth_email_not_verified: 'errorEmailNotVerified',
  auth_failed: 'signInFailed',
  play_services: 'errorPlayServices',
  purchases_unavailable: 'purchasesUnavailable',
  purchase_sign_in_required: 'purchaseSignInRequired',
  purchase_in_progress: 'errorPurchaseInProgress',
  payment_pending: 'errorPaymentPending',
  store_problem: 'errorStoreProblem',
  purchase_not_allowed: 'errorPurchaseNotAllowed',
  already_owned: 'errorAlreadyOwned',
  receipt_in_use: 'errorReceiptInUse',
  product_unavailable: 'errorProductUnavailable',
  biometric_lockout: 'biometricLockout',
  biometric_unavailable: 'biometricsUnavailable',
  biometric_failed: 'unlockFailed',
  unknown: 'error',
};

const ACTIONS: Partial<Record<ErrorCode, ErrorAction>> = {
  insufficient_credits: 'getCredits',
  unauthorized: 'signIn',
  purchase_sign_in_required: 'signIn',
  model_missing: 'download',
  detect_failed: 'chooseLanguage',
  speech_blocked: 'openSettings',
  speech_not_allowed: 'openSettings',
  already_owned: 'restorePurchases',
};

const ACTION_LABELS: Record<ErrorAction, StringKey> = {
  getCredits: 'getCredits',
  signIn: 'signIn',
  openSettings: 'openSettings',
  download: 'download',
  chooseLanguage: 'chooseLanguage',
  restorePurchases: 'restorePurchases',
};

/** Button text for an error's action. */
export function errorActionLabel(action: ErrorAction): string {
  return t(ACTION_LABELS[action]);
}

function names(codes: readonly string[]): string {
  return formatList(codes.map((c) => languageName(c)));
}

function messageFor({ code, languages = [] }: Classified): string {
  if (code === 'cancelled') return '';
  const known = languages.filter((l) => l !== 'auto');
  if (code === 'speech_language' && known.length) return t('speechLanguageUnsupportedNamed', { lang: names(known) });
  // Native errors normally name the language; without one, fall back to a sentence that needs none.
  if (!known.length && code === 'model_missing') return t('downloadLanguagesToUseOffline');
  if (!known.length && code === 'download_failed') return t('errorNetwork');
  if (!known.length && code === 'delete_failed') return t('error');
  if (!known.length && code === 'unsupported_language') return t('errorOnDeviceUnavailable');
  return t(MESSAGES[code], { lang: names(known) });
}

/* ------------------------------------------------------------------ classification */

function field(e: unknown, key: string): unknown {
  return e !== null && typeof e === 'object' ? (e as Record<string, unknown>)[key] : undefined;
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

/** ML Kit and Apple language codes that differ from ours. */
const LANGUAGE_ALIASES: Record<string, string> = { iw: 'he', fil: 'tl', nb: 'no', 'zh-Hant': 'zh-TW', 'zh-Hans': 'zh' };

function languageList(detail: string | undefined): string[] {
  return (detail ?? '')
    .split(/[,\s]+/)
    .map((c) => LANGUAGE_ALIASES[c] ?? c)
    .filter(isLanguageCode);
}

const API_CODES: Record<string, ErrorCode> = {
  network: 'network',
  bad_request: 'bad_request',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  not_found: 'not_found',
  insufficient_credits: 'insufficient_credits',
  rate_limited: 'rate_limited',
  too_large: 'too_large',
  service_paused: 'service_paused',
  upstream_error: 'upstream_error',
  internal: 'internal',
};

function fromApiError(e: ApiError): Classified {
  if (e.code === 'network') return { code: e.timedOut || /timed out/i.test(e.message) ? 'timeout' : 'network' };
  if (e.code === 'bad_request') {
    if (e.status === 409) return { code: 'conflict' };
    if (/detect/i.test(e.message)) return { code: 'detect_failed' };
  }
  return { code: API_CODES[e.code] ?? 'unknown' };
}

/** Native module codes, also found inside wrapped messages ("… Caused by: MODEL_MISSING:ar"). */
const NATIVE_CODES: Record<string, ErrorCode> = {
  MODEL_MISSING: 'model_missing',
  DOWNLOAD_FAILED: 'download_failed',
  DELETE_FAILED: 'delete_failed',
  LIST_FAILED: 'unknown',
  NO_CONTEXT: 'unknown',
  NO_CONNECTION: 'network',
  UNSUPPORTED_LANGUAGE: 'unsupported_language',
  ON_DEVICE_UNAVAILABLE: 'on_device_unavailable',
  TRANSLATE_FAILED: 'translate_failed',
  DETECT_FAILED: 'detect_failed',
  BAD_IMAGE: 'bad_image',
  OCR_FAILED: 'ocr_failed',
  OCR_UNAVAILABLE: 'ocr_unavailable',
  BAD_PDF: 'bad_pdf',
  LOCKED_PDF: 'locked_pdf',
  PDF_TOO_COMPLEX: 'document_too_complex',
  DOCUMENT_TOO_COMPLEX: 'document_too_complex',
  BAD_DOCUMENT: 'bad_document',
  PURCHASES_UNAVAILABLE: 'purchases_unavailable',
};
const NATIVE_TOKEN = new RegExp(`\\b(${Object.keys(NATIVE_CODES).join('|')})\\b(?::\\s*([\\w, -]+))?`, 'i');

/** Speech recognizer codes: SpeechError codes, raw expo-speech-recognition codes and older aliases. */
const SPEECH_CODES: Record<string, ErrorCode> = {
  permission: 'speech_permission',
  'permission-blocked': 'speech_blocked',
  'not-allowed': 'speech_blocked',
  'service-not-allowed': 'speech_not_allowed',
  unavailable: 'speech_unavailable',
  'language-not-supported': 'speech_language',
  'language-unsupported': 'speech_language',
  'no-speech': 'speech_no_speech',
  'speech-timeout': 'speech_no_speech',
  network: 'speech_network',
  busy: 'speech_busy',
  'too-many-requests': 'speech_busy',
  interrupted: 'speech_interrupted',
  'audio-capture': 'speech_audio',
  audio: 'speech_audio',
  timeout: 'speech_timeout',
  client: 'speech_failed',
  'bad-grammar': 'speech_failed',
  unknown: 'speech_failed',
  aborted: 'cancelled',
};

/** expo-local-authentication result errors (underscored, unlike the speech codes). */
const BIOMETRIC_CODES: Record<string, ErrorCode> = {
  user_cancel: 'cancelled',
  system_cancel: 'cancelled',
  app_cancel: 'cancelled',
  user_fallback: 'cancelled',
  lockout: 'biometric_lockout',
  not_enrolled: 'biometric_unavailable',
  not_available: 'biometric_unavailable',
  passcode_not_set: 'biometric_unavailable',
  authentication_failed: 'biometric_failed',
  unable_to_process: 'biometric_failed',
  invalid_context: 'biometric_failed',
  timeout: 'timeout',
};

/** better-auth error codes (core and email-OTP plugin). */
const AUTH_CODES: Record<string, ErrorCode> = {
  INVALID_EMAIL_OR_PASSWORD: 'auth_invalid_credentials',
  INVALID_PASSWORD: 'auth_invalid_credentials',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'auth_invalid_credentials',
  USER_NOT_FOUND: 'auth_invalid_credentials',
  INVALID_EMAIL: 'auth_invalid_email',
  INVALID_OTP: 'auth_invalid_code',
  INVALID_TOKEN: 'auth_invalid_code',
  OTP_EXPIRED: 'auth_code_expired',
  TOKEN_EXPIRED: 'auth_code_expired',
  TOO_MANY_ATTEMPTS: 'auth_too_many_attempts',
  TOO_MANY_REQUESTS: 'rate_limited',
  USER_ALREADY_EXISTS: 'auth_user_exists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth_user_exists',
  PASSWORD_TOO_SHORT: 'auth_password_too_short',
  PASSWORD_TOO_LONG: 'auth_password_too_long',
  EMAIL_NOT_VERIFIED: 'auth_email_not_verified',
  SESSION_EXPIRED: 'unauthorized',
  FAILED_TO_GET_SESSION: 'unauthorized',
  FAILED_TO_CREATE_USER: 'auth_failed',
  FAILED_TO_CREATE_SESSION: 'auth_failed',
  FAILED_TO_GET_USER_INFO: 'auth_failed',
};

/** Apple and Google sign-in, and fetch cancellation. */
const CANCEL_CODES = new Set(['ERR_REQUEST_CANCELED', 'ERR_CANCELED', 'SIGN_IN_CANCELLED', 'IN_PROGRESS', '-5', '12501']);

/** purchases.ts PurchaseError codes. */
const PURCHASE_ERROR_CODES: Record<string, ErrorCode> = {
  purchases_unavailable: 'purchases_unavailable',
  sign_in_required: 'purchase_sign_in_required',
  payment_pending: 'payment_pending',
  purchase_not_allowed: 'purchase_not_allowed',
  product_unavailable: 'product_unavailable',
  already_owned: 'already_owned',
  receipt_in_use: 'receipt_in_use',
  purchase_in_progress: 'purchase_in_progress',
  store_problem: 'store_problem',
  network: 'network',
  purchase_failed: 'unknown',
};

/** RevenueCat PURCHASES_ERROR_CODE values (errors that reach us without purchases.ts). */
const PURCHASE_CODES: Record<string, ErrorCode> = {
  '1': 'cancelled',
  '2': 'store_problem',
  '3': 'purchase_not_allowed',
  '4': 'store_problem',
  '5': 'product_unavailable',
  '6': 'already_owned',
  '7': 'receipt_in_use',
  '10': 'network',
  '13': 'receipt_in_use',
  '15': 'purchase_in_progress',
  '20': 'payment_pending',
  '23': 'purchases_unavailable',
  '24': 'purchases_unavailable',
  '32': 'timeout',
  '35': 'network',
};

/** Last resort for plain Errors from libraries (fetch, better-auth messages wrapped by callers). */
function fromMessage(message: string): Classified | null {
  const native = NATIVE_TOKEN.exec(message);
  if (native) {
    const code = NATIVE_CODES[native[1]!.toUpperCase()] ?? 'unknown';
    return { code, languages: languageList(native[2]) };
  }
  const m = message.toLowerCase();
  if (/network request failed|failed to fetch|network error|no connection|internet connection appears to be offline/.test(m)) {
    return { code: 'network' };
  }
  if (/timed? ?out/.test(m)) return { code: 'timeout' };
  if (m.includes('too large or complex')) return { code: 'document_too_complex' };
  if (m.includes('not a word document') || m.includes('too large when unpacked')) return { code: 'bad_document' };
  if (m.includes('invalid email or password')) return { code: 'auth_invalid_credentials' };
  if (m.includes('invalid otp') || m.includes('invalid code')) return { code: 'auth_invalid_code' };
  if (m.includes('otp expired') || m.includes('code expired')) return { code: 'auth_code_expired' };
  if (m.includes('already exists')) return { code: 'auth_user_exists' };
  if (m.includes('too many')) return { code: 'rate_limited' };
  return null;
}

function classify(e: unknown): Classified {
  if (e === null || e === undefined) return { code: 'unknown' };

  if (typeof e === 'string') {
    // Bare codes shared by several sources ('network', 'timeout', 'unknown') get the general meaning.
    const speech = e === 'network' || e === 'timeout' || e === 'unknown' ? undefined : SPEECH_CODES[e];
    const code = speech ?? API_CODES[e] ?? BIOMETRIC_CODES[e];
    return code ? { code } : (fromMessage(e) ?? { code: 'unknown' });
  }

  if (e instanceof ApiError) return fromApiError(e);
  // Same shape from another copy of the module (fast refresh keeps old class instances alive).
  if (field(e, 'name') === 'ApiError' && typeof field(e, 'code') === 'string') return fromApiError(e as ApiError);
  if (e instanceof DocumentTooComplexError) return { code: 'document_too_complex' };

  const name = text(field(e, 'name'));
  const code = text(field(e, 'code'));
  const message = text(field(e, 'message')) ?? '';

  if (name === 'AbortError') return { code: 'cancelled' };

  // speech.ts SpeechError: code + language + permissionBlocked.
  if (name === 'SpeechError' && code) {
    if (code === 'permission' && field(e, 'permissionBlocked') === true) return { code: 'speech_blocked' };
    const language = text(field(e, 'language'));
    return { code: SPEECH_CODES[code] ?? 'speech_failed', languages: language ? [language] : [] };
  }

  // purchases.ts PurchaseError.
  if (name === 'PurchaseError') return { code: (code && PURCHASE_ERROR_CODES[code]) || 'unknown' };

  // translator.ts ModelMissingError (an EngineError listing every missing model).
  const missing = field(e, 'missing');
  if (Array.isArray(missing)) return { code: 'model_missing', languages: missing.filter((m): m is string => typeof m === 'string') };

  // RevenueCat.
  if (typeof field(e, 'userCancelled') === 'boolean' || text(field(e, 'readableErrorCode'))) {
    if (field(e, 'userCancelled') === true) return { code: 'cancelled' };
    return { code: (code && PURCHASE_CODES[code]) || 'store_problem' };
  }
  if (name === 'UninitializedPurchasesError' || name === 'UnsupportedPlatformError') return { code: 'purchases_unavailable' };

  // Native module rejections and translator.ts EngineError: a stable code, and the language
  // in `language` (EngineError) or as "CODE:detail" in the message.
  const nativeCode = nativeErrorCode(e);
  if (nativeCode && nativeCode in NATIVE_CODES) {
    const language = text(field(e, 'language'));
    const detail = language ?? new RegExp(`${nativeCode}:\\s*([\\w, -]+)`).exec(message)?.[1];
    return { code: NATIVE_CODES[nativeCode] ?? 'unknown', languages: languageList(detail) };
  }

  if (code && CANCEL_CODES.has(code)) return { code: 'cancelled' };
  if (code === 'PLAY_SERVICES_NOT_AVAILABLE') return { code: 'play_services' };
  if (code === 'ERR_REQUEST_FAILED' || code === 'ERR_INVALID_RESPONSE') return { code: 'auth_failed' };
  if (code && AUTH_CODES[code]) return { code: AUTH_CODES[code] };

  // { error: 'no-speech' } from the recognizer, { error: 'lockout' } from local authentication,
  // and better-auth's { error: { code, status } } wrapper.
  const inner = field(e, 'error');
  if (typeof inner === 'string') {
    if (BIOMETRIC_CODES[inner]) return { code: BIOMETRIC_CODES[inner] };
    if (SPEECH_CODES[inner]) return { code: SPEECH_CODES[inner] };
  } else if (inner && typeof inner === 'object') {
    return classify(inner);
  }

  const status = field(e, 'status');
  if (typeof status === 'number') {
    if (status === 429) return { code: 'rate_limited' };
    if (status === 401) return { code: 'unauthorized' };
    if (status >= 500) return { code: 'internal' };
    if (status === 0) return { code: 'network' };
  }

  return fromMessage(message) ?? { code: 'unknown' };
}

/* ------------------------------------------------------------------ public API */

/** The code, localized message and suggested action for any thrown value or error object. */
export function toAppError(e: unknown): AppError {
  const c = classify(e);
  const action = ACTIONS[c.code];
  return {
    code: c.code,
    message: messageFor(c),
    ...(action ? { action } : {}),
    ...(c.languages?.length ? { languages: c.languages } : {}),
  };
}

/**
 * A short message in the interface language for any error. Returns '' when the user simply
 * cancelled (closed a sign-in sheet, a purchase or a fingerprint prompt), so
 * `setError(errorMessage(e))` then shows nothing.
 */
export function errorMessage(e: unknown): string {
  return messageFor(classify(e));
}

export function errorCode(e: unknown): ErrorCode {
  return classify(e).code;
}

/** True when the user backed out on purpose; don't show an error. */
export function isCancellation(e: unknown): boolean {
  return classify(e).code === 'cancelled';
}
