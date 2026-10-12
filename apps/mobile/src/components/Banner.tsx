import { useEffect } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { announce } from '@/lib/a11y';
import { t } from '@/lib/i18n';
import { iconSize, radius, space, useColors } from '@/theme';
import { Button, IconButton } from './Button';
import { Icon, type IconName } from './Icon';
import { enterDown, exitUp, layoutTransition } from './motion';
import { Text } from './Text';

type Tone = 'info' | 'warning' | 'danger' | 'success';

const DEFAULT_ICON: Record<Tone, IconName> = { info: 'info', warning: 'warning', danger: 'error', success: 'checkCircle' };

/**
 * Inline notice. Drops in, fades out, and glides when something above it changes. Screen readers
 * hear it when it appears: danger interrupts, the other tones wait their turn. Stack several in a
 * column with gap space.sm (Screen's gap already spaces them from other content).
 */
export function Banner({
  icon,
  message,
  action,
  onAction,
  loading,
  tone = 'info',
  onDismiss,
  silent,
}: {
  icon?: IconName;
  message: string;
  action?: string;
  onAction?: () => void;
  loading?: boolean;
  tone?: Tone;
  /** Shows a close button (e.g. for an error the user has read). */
  onDismiss?: () => void;
  /** Do not announce (for a banner that is always there, such as a static hint). */
  silent?: boolean;
}) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const bg = { info: c.accentSoft, warning: c.warningSoft, danger: c.dangerSoft, success: c.successSoft }[tone];
  const fg = { info: c.accent, warning: c.warning, danger: c.danger, success: c.success }[tone];
  const hasAction = !!action && !!onAction;
  // At large text sizes the action moves under the message instead of squeezing it.
  const stacked = hasAction && fontScale > 1.3;

  // Android reads the live region below by itself; iOS has no live regions.
  useEffect(() => {
    if (Platform.OS === 'ios' && !silent) announce(message, { interrupt: tone === 'danger' });
  }, [message, silent, tone]);

  return (
    <Animated.View
      entering={enterDown}
      exiting={exitUp}
      layout={layoutTransition}
      accessibilityRole={tone === 'danger' ? 'alert' : 'summary'}
      accessibilityLiveRegion={silent ? 'none' : tone === 'danger' ? 'assertive' : 'polite'}
      style={[styles.banner, stacked && styles.stacked, { backgroundColor: bg, paddingEnd: hasAction && !stacked ? space.xs : space.lg }]}>
      <View style={styles.main}>
        <View style={styles.icon}>
          <Icon name={icon ?? DEFAULT_ICON[tone]} size={iconSize.md} color={fg} />
        </View>
        <Text variant="caption" style={styles.message}>
          {message}
        </Text>
        {onDismiss && !hasAction ? <IconButton icon="close" label={t('close')} size={32} onPress={onDismiss} tint={c.textMuted} /> : null}
      </View>
      {action && onAction ? (
        <Button
          title={action}
          onPress={onAction}
          kind="ghost"
          compact
          loading={loading}
          style={stacked ? styles.actionStacked : styles.action}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingStart: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    minHeight: 48,
  },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  // Caption line height is 18, the icon 20: nudged so it centres on the first line.
  icon: { marginTop: -1 },
  message: { flex: 1, minWidth: 0 },
  action: { alignSelf: 'center' },
  actionStacked: { alignSelf: 'flex-end' },
});
