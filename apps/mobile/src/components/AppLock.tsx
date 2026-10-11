import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { t } from '@/lib/i18n';
import { useAppState } from '@/lib/store';
import { space, useColors } from '@/theme';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

/** Locks the app behind Face ID / fingerprint when it opens or comes back after 30 seconds. */
const RELOCK_AFTER_MS = 30_000;

export function AppLock() {
  const c = useColors();
  const enabled = useAppState((s) => s.settings.appLock);
  const [locked, setLocked] = useState(enabled);
  const backgroundedAt = useRef<number | null>(null);

  async function unlock() {
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: t('appName'), cancelLabel: t('cancel') });
    if (res.success) setLocked(false);
  }

  useEffect(() => {
    if (!enabled) return setLocked(false);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current && Date.now() - backgroundedAt.current > RELOCK_AFTER_MS) setLocked(true);
    });
    return () => sub.remove();
  }, [enabled]);

  useEffect(() => {
    if (enabled && locked) void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, locked]);

  if (!enabled || !locked) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: c.bg }]} accessibilityViewIsModal>
      <Icon name="lock" size={40} color={c.accent} />
      <Text variant="title">{t('appName')}</Text>
      <Button title={t('continue')} icon="lock" onPress={() => void unlock()} />
    </View>
  );
}

export async function canUseBiometrics(): Promise<boolean> {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: space.lg, zIndex: 100 },
});
