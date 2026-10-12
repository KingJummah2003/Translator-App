import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';
import { iconSize, radius, space, touch, useColors } from '@/theme';
import { Icon, type IconName } from './Icon';
import { PressableScale, enterPop } from './motion';
import { Text } from './Text';

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'compact' | 'regular' | 'large';

const HEIGHT: Record<Size, number> = { compact: touch.min, regular: 50, large: 56 };

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  loading,
  disabled,
  style,
  compact,
  size,
  accessibilityLabel,
  accessibilityHint,
  haptic,
  testID,
}: {
  title: string;
  onPress: () => void;
  kind?: Kind;
  icon?: IconName;
  /** Busy: shows a spinner in place of the label (the button keeps its size) and ignores taps. */
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Shorthand for size="compact". */
  compact?: boolean;
  size?: Size;
  /** Use when the title alone is ambiguous, e.g. "Download" in a list of languages. */
  accessibilityLabel?: string;
  /** E.g. why the button is disabled. */
  accessibilityHint?: string;
  haptic?: boolean;
  testID?: string;
}) {
  const c = useColors();
  const s: Size = size ?? (compact ? 'compact' : 'regular');
  const inactive = !!disabled || !!loading;
  // Disabled uses explicit colours, not opacity: a faded accent with dark text reads as broken.
  const bg = disabled
    ? kind === 'ghost'
      ? 'transparent'
      : c.surfaceAlt
    : { primary: c.accent, secondary: c.surfaceAlt, ghost: 'transparent', danger: c.dangerSoft }[kind];
  const fg = disabled ? c.textFaint : { primary: c.onAccent, secondary: c.text, ghost: c.accent, danger: c.danger }[kind];

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      disabled={inactive}
      haptic={haptic}
      hitSlop={s === 'compact' ? 4 : undefined}
      scaleTo={s === 'compact' ? 0.95 : 0.97}
      highlight={c.pressed}
      onPress={onPress}
      style={[styles.base, s === 'compact' && styles.compact, { minHeight: HEIGHT[s], backgroundColor: bg }, style]}>
      <View style={[styles.row, loading && styles.hidden]}>
        {icon && <Icon name={icon} size={s === 'compact' ? iconSize.sm : iconSize.md} color={fg} />}
        <Text variant={s === 'compact' ? 'label' : 'button'} numberOfLines={2} style={[styles.label, { color: fg }]}>
          {title}
        </Text>
      </View>
      {loading && <ActivityIndicator color={fg} style={StyleSheet.absoluteFill} />}
    </PressableScale>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  active,
  size = touch.min,
  disabled,
  loading,
  tint,
  toggle,
  variant = 'plain',
  accessibilityHint,
  haptic,
  testID,
}: {
  icon: IconName;
  /** Screen-reader name; required because the button has no visible text. */
  label: string;
  onPress: () => void;
  /** Accent fill (listening, playing, a toggle that is on). */
  active?: boolean;
  /** Visual size in pt. Taps reach at least 48 through hitSlop. */
  size?: number;
  disabled?: boolean;
  loading?: boolean;
  tint?: string;
  /** An on/off control (auto-speak): announced as a switch with its state. */
  toggle?: boolean;
  /** 'tonal' sits on a soft circle (sheet and modal close buttons). */
  variant?: 'plain' | 'tonal';
  accessibilityHint?: string;
  haptic?: boolean;
  testID?: string;
}) {
  const c = useColors();
  const inactive = !!disabled || !!loading;
  const glyph = size >= 48 ? iconSize.lg : size < 36 ? iconSize.sm : iconSize.md;
  const fg = disabled ? c.textFaint : active ? c.onAccent : (tint ?? c.textMuted);
  const bg = active ? c.accent : variant === 'tonal' ? c.surfaceAlt : 'transparent';
  return (
    <PressableScale
      testID={testID}
      accessibilityRole={toggle ? 'switch' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: !!loading, ...(toggle ? { checked: !!active } : null) }}
      hitSlop={Math.max(0, (touch.android - size) / 2)}
      disabled={inactive}
      haptic={haptic}
      scaleTo={0.9}
      highlight={c.pressed}
      onPress={onPress}
      style={[styles.icon, { width: size, height: size, backgroundColor: bg }]}>
      {loading ? (
        <ActivityIndicator size="small" color={tint ?? c.accent} />
      ) : (
        // The glyph pops when it changes (copy -> check, mic -> stop), never on first render.
        <LayoutAnimationConfig skipEntering>
          <Animated.View key={icon} entering={enterPop}>
            <Icon name={icon} size={glyph} color={fg} />
          </Animated.View>
        </LayoutAnimationConfig>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { paddingHorizontal: space.xl, paddingVertical: space.sm, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  compact: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  label: { flexShrink: 1, textAlign: 'center' },
  hidden: { opacity: 0 },
  icon: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
