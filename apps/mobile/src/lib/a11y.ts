import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Screen-reader helpers. VoiceOver and TalkBack only read what has focus, so anything that
 * appears on its own (a translation, an error, "Copied") is announced explicitly.
 */

// The same message twice in a row (a re-render, a banner that remounts) is read once.
const REPEAT_MS = 800;
let last = { text: '', at: 0 };

/** Speaks `text` with the active screen reader. Does nothing when none is running. */
export function announce(text: string | null | undefined, { interrupt = false }: { interrupt?: boolean } = {}): void {
  const msg = text?.trim();
  if (!msg) return;
  const now = Date.now();
  if (msg === last.text && now - last.at < REPEAT_MS) return;
  last = { text: msg, at: now };
  if (Platform.OS === 'ios') {
    // queue: true waits for the current utterance (e.g. the button label) instead of cutting it off.
    AccessibilityInfo.announceForAccessibilityWithOptions(msg, { queue: !interrupt });
  } else {
    AccessibilityInfo.announceForAccessibility(msg);
  }
}

/* ------------------------------------------------------------ screen reader state */

let screenReader = false;
const listeners = new Set<() => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  const update = (on: boolean) => {
    if (on === screenReader) return;
    screenReader = on;
    listeners.forEach((l) => l());
  };
  AccessibilityInfo.addEventListener('screenReaderChanged', update);
  AccessibilityInfo.isScreenReaderEnabled()
    .then(update)
    .catch(() => {});
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while VoiceOver or TalkBack is on (e.g. to offer a list instead of tap-a-word). */
export function useScreenReaderEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => screenReader,
    () => false,
  );
}
