import { Children, Fragment, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Switch, View } from 'react-native';
import { iconSize, radius, space, useColors } from '@/theme';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './motion';
import { Text } from './Text';

const ICON_SLOT = iconSize.lg;

/**
 * A list row: leading icon slot, title and optional detail, then a chevron, switch, spinner or a
 * custom `end`. The whole row is one screen-reader stop (a switch row is announced as a switch).
 */
export function Row({
  icon,
  title,
  detail,
  onPress,
  end,
  destructive,
  value,
  onValueChange,
  loading,
  disabled,
  chevron,
  accessibilityLabel,
  accessibilityHint,
}: {
  icon?: IconName;
  title: string;
  detail?: string;
  onPress?: () => void;
  end?: ReactNode;
  destructive?: boolean;
  value?: boolean;
  onValueChange?: (v: boolean) => void;
  /** Busy: spinner in place of the chevron, taps ignored. */
  loading?: boolean;
  disabled?: boolean;
  /** Show the chevron (default: when the row navigates and has no custom end). */
  chevron?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const c = useColors();
  const isSwitch = onValueChange !== undefined;
  const interactive = isSwitch || !!onPress;
  const inactive = !!disabled || !!loading;
  const showChevron = chevron ?? (!!onPress && !end && !isSwitch);
  const iconColor = disabled ? c.textFaint : destructive ? c.danger : c.textMuted;

  const content = (
    <>
      {icon ? (
        <View style={styles.iconSlot}>
          <Icon name={icon} size={iconSize.md} color={iconColor} />
        </View>
      ) : null}
      <View style={styles.texts}>
        <Text variant="body" tone={disabled ? 'faint' : destructive ? 'danger' : 'default'}>
          {title}
        </Text>
        {detail ? (
          <Text variant="caption" tone="muted">
            {detail}
          </Text>
        ) : null}
      </View>
      {end}
      {loading ? (
        <ActivityIndicator color={c.textMuted} />
      ) : isSwitch ? (
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={inactive}
          trackColor={{ false: c.borderStrong, true: c.accent }}
          thumbColor={Platform.OS === 'android' ? (value ? c.onAccent : c.surface) : undefined}
          ios_backgroundColor={c.borderStrong}
          // The row is the control for screen readers; the switch alone would be a second, unnamed stop.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : showChevron ? (
        <Icon name="chevron" size={iconSize.sm} color={c.textFaint} />
      ) : null}
    </>
  );

  // An informational row is plain text for screen readers (a disabled Pressable reads as "dimmed").
  // It is one stop unless its `end` holds its own control (a Download button), which must stay reachable.
  if (!interactive) {
    return (
      <View style={styles.row} accessible={!end} accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint}>
        {content}
      </View>
    );
  }

  return (
    <PressableScale
      accessibilityRole={isSwitch ? 'switch' : 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: !!loading, ...(isSwitch ? { checked: !!value } : null) }}
      disabled={inactive}
      haptic={!isSwitch}
      scaleTo={1}
      highlight={c.pressed}
      onPress={isSwitch ? () => onValueChange(!value) : onPress}
      style={styles.row}>
      {content}
    </PressableScale>
  );
}

/**
 * A titled group of rows on one card, with inset separators between rows. The title is a
 * screen-reader heading; an optional footer explains the group.
 */
export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const c = useColors();
  const rows = Children.toArray(children);
  return (
    <View style={styles.section}>
      {title ? (
        <Text variant="eyebrow" tone="muted" heading style={styles.sectionText}>
          {title}
        </Text>
      ) : null}
      <Card padding={0}>
        {/* Clips row highlights to the card's corners without clipping the card's shadow. */}
        <View style={styles.clip}>
          {rows.map((row, i) => (
            <Fragment key={i}>
              {i > 0 ? <View style={[styles.separator, { backgroundColor: c.border }]} /> : null}
              {row}
            </Fragment>
          ))}
        </View>
      </Card>
      {footer ? (
        <Text variant="caption" tone="muted" style={styles.sectionText}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 56 },
  iconSlot: { width: ICON_SLOT, alignItems: 'center' },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  section: { gap: space.sm },
  sectionText: { paddingHorizontal: space.lg },
  clip: { borderRadius: radius.lg, overflow: 'hidden' },
  // Starts under the title, past the icon slot (Material / iOS inset list style).
  separator: { height: StyleSheet.hairlineWidth, marginStart: space.lg + ICON_SLOT + space.md },
});
