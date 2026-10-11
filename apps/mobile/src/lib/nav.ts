import { router } from 'expo-router';

/** Closes a modal, or goes home when it was opened from a link with nothing behind it. */
export function dismiss(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
