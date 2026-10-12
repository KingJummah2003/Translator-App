import { router, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

/** A second tap on "close" while the sheet animates away must not pop the screen below too. */
const REPEAT_GUARD_MS = 400;
let lastDismiss = 0;

/** Closes a modal, or goes home when it was opened from a link with nothing behind it. */
export function dismiss(): void {
  const now = Date.now();
  if (now - lastDismiss < REPEAT_GUARD_MS) return;
  lastDismiss = now;
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * dismiss() for code that runs after an await (a purchase, a sign-in). It does nothing once
 * the screen has unmounted or another screen is on top, so a late result can never close
 * whatever the user moved on to.
 */
export function useDismiss(): () => void {
  const navigation = useNavigation();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => {
    if (mounted.current && navigation.isFocused()) dismiss();
  }, [navigation]);
}
