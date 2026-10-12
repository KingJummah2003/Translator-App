import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { announce } from '@/lib/a11y';
import { t } from '@/lib/i18n';
import { useAppState } from '@/lib/store';
import { iconSize, space, useColors } from '@/theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

/** Locks the app behind Face ID / fingerprint / passcode when it opens or comes back after 30 seconds. */
const RELOCK_AFTER_MS = 30_000;
// iOS cannot present the lock while a sheet is still on screen, so open sheets are closed first
// and the lock is presented once they have slid away.
const SHEET_DISMISS_MS = 450;
const CANCELLED = new Set(['user_cancel', 'system_cancel', 'app_cancel', 'user_fallback']);

/**
 * The lock is drawn twice on purpose:
 * - in a Modal, which sits above every native modal and sheet on Android and keeps TalkBack from
 *   reaching the app underneath (on iOS, above everything once sheets are closed);
 * - in the app's own tree as a fallback that covers the screens straight away (while sheets
 *   close, or if iOS refuses to present the Modal).
 */
export function AppLock() {
  const enabled = useAppState((s) => s.settings.appLock);
  const reduced = useReducedMotion();
  const [locked, setLocked] = useState(enabled);
  const [presentable, setPresentable] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const authenticating = useRef(false);

  async function unlock() {
    if (authenticating.current) return;
    authenticating.current = true;
    try {
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: t('unlockPrompt'), cancelLabel: t('cancel') });
      if (res.success) {
        setFailed(null);
        setLocked(false);
        return;
      }
      // Passcode and biometrics were removed after the lock was turned on: there is nothing left
      // to check, and the owner must not be locked out of their own history.
      if (
        (res.error === 'passcode_not_set' || res.error === 'not_enrolled' || res.error === 'not_available') &&
        (await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE
      ) {
        setLocked(false);
        return;
      }
      if (!CANCELLED.has(res.error)) {
        const message = res.error === 'lockout' ? t('biometricLockout') : t('unlockFailed');
        setFailed(message);
        announce(message, { interrupt: true });
      }
    } catch {
      setFailed(t('unlockFailed'));
    } finally {
      authenticating.current = false;
    }
  }

  useEffect(() => {
    if (!enabled) return;
    let backgroundedAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt = Date.now();
      if (state !== 'active' || backgroundedAt === null) return;
      const away = Date.now() - backgroundedAt;
      backgroundedAt = null;
      if (away <= RELOCK_AFTER_MS) return;
      setFailed(null);
      if (Platform.OS === 'ios' && router.canDismiss()) {
        setPresentable(false);
        router.dismissAll();
        timer = setTimeout(() => setPresentable(true), SHEET_DISMISS_MS);
      }
      setLocked(true);
    });
    return () => {
      sub.remove();
      clearTimeout(timer);
    };
  }, [enabled]);

  if (!enabled) return null;
  const screen = <LockScreen failed={failed} onUnlock={() => void unlock()} />;
  return (
    <>
      {locked ? <View style={StyleSheet.absoluteFill}>{screen}</View> : null}
      <Modal
        visible={locked && presentable}
        animationType={reduced ? 'none' : 'fade'}
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        // Android back must not dismiss the lock.
        onRequestClose={() => {}}
        onShow={() => void unlock()}>
        {screen}
      </Modal>
    </>
  );
}

function LockScreen({ failed, onUnlock }: { failed: string | null; onUnlock: () => void }) {
  const c = useColors();
  return (
    <View style={[styles.wrap, { backgroundColor: c.bg }]} accessibilityViewIsModal>
      <View style={[styles.badge, { backgroundColor: c.accentSoft }]}>
        <Icon name="lock" size={iconSize.xl} color={c.accent} />
      </View>
      <Text variant="title" align="center" heading>
        {t('appName')}
      </Text>
      {failed ? (
        <Text variant="body" tone="danger" align="center" accessibilityLiveRegion="assertive" style={styles.error}>
          {failed}
        </Text>
      ) : null}
      <Button title={t('unlock')} icon="lock" onPress={onUnlock} style={styles.button} />
    </View>
  );
}

export async function canUseBiometrics(): Promise<boolean> {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  badge: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  error: { maxWidth: 360 },
  button: { width: '100%', maxWidth: 360 },
});
