import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { space, useColors } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** A settings-style list row: icon, title, optional detail, chevron / switch / custom end. */
export function Row({
  icon,
  title,
  detail,
  onPress,
  end,
  destructive,
  value,
  onValueChange,
}: {
  icon?: IconName;
  title: string;
  detail?: string;
  onPress?: () => void;
  end?: ReactNode;
  destructive?: boolean;
  value?: boolean;
  onValueChange?: (v: boolean) => void;
}) {
  const c = useColors();
  const isSwitch = onValueChange !== undefined;
  return (
    <Pressable
      accessibilityRole={isSwitch ? 'switch' : onPress ? 'button' : undefined}
      accessibilityState={isSwitch ? { checked: value } : undefined}
      disabled={!onPress && !isSwitch}
      onPress={isSwitch ? () => onValueChange(!value) : onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.surfaceAlt : 'transparent' }]}>
      {icon && <Icon name={icon} size={20} color={destructive ? c.danger : c.textMuted} />}
      <View style={styles.texts}>
        <Text variant="body" tone={destructive ? 'danger' : 'default'}>
          {title}
        </Text>
        {detail ? (
          <Text variant="caption" tone="muted">
            {detail}
          </Text>
        ) : null}
      </View>
      {end}
      {isSwitch ? (
        <Switch value={value} onValueChange={onValueChange} trackColor={{ true: c.accent }} />
      ) : onPress && !end ? (
        <Icon name="chevron" size={14} color={c.textFaint} />
      ) : null}
    </Pressable>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.section}>
      {title && (
        <Text variant="micro" tone="muted" style={styles.sectionTitle}>
          {title.toUpperCase()}
        </Text>
      )}
      <View style={[styles.group, { backgroundColor: c.surface, borderColor: c.border }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 52, paddingVertical: space.sm },
  texts: { flex: 1, gap: 2 },
  section: { gap: space.sm },
  sectionTitle: { paddingHorizontal: space.lg },
  group: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
