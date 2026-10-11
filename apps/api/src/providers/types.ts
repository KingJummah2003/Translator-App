export interface TranslateResult {
  translations: string[];
  /** Detected source language (our code), when the source was 'auto'. */
  detectedSource: string | null;
}

export interface OcrResult {
  text: string;
  detectedSource: string | null;
}

/** A cloud translation backend. Implementations must never log the text they receive. */
export interface TranslationProvider {
  readonly name: string;
  /** Largest batch (in characters and segments) the provider accepts per call. */
  readonly maxBatchChars: number;
  readonly maxBatchSegments: number;
  translate(texts: string[], source: string, target: string): Promise<TranslateResult>;
  ocr(imageBase64: string): Promise<OcrResult>;
}
