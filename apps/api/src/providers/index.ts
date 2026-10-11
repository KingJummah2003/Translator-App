import type { Env } from '../env';
import { googleProvider } from './google';
import { mockProvider } from './mock';
import type { TranslationProvider } from './types';

export type { TranslationProvider } from './types';

export function getProvider(env: Env): TranslationProvider {
  if (env.TRANSLATION_PROVIDER === 'google') {
    if (!env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set');
    return googleProvider(env.GOOGLE_API_KEY);
  }
  if (env.ENVIRONMENT === 'production') throw new Error('The mock provider cannot run in production');
  return mockProvider;
}
