import { StyleSheet, View } from 'react-native';
import { radius, space, useColors } from '@/theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export function Banner({
  icon = 'info',
  message,
  action,
  onAction,
  loading,
  tone = 'info',
}: {
  icon?: IconName;
  message: string;
  action?: string;
  onAction?: () => void;
  loading?: boolean;
  tone?: 'info' | 'warning' | 'danger';
}) {
  const c = useColors();
  const bg = tone === 'danger' ? c.dangerSoft : tone === 'warning' ? c.surfaceAlt : c.accentSoft;
  const fg = tone === 'danger' ? c.danger : tone === 'warning' ? c.warning : c.accent;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityRole="summary">
      <Icon name={icon} size={18} color={fg} />
      <Text variant="caption" style={styles.message}>
        {message}
      </Text>
      {action && onAction && <Button title={action} onPress={onAction} kind="ghost" compact loading={loading} />}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingStart: space.lg, paddingEnd: space.xs, paddingVertical: space.xs, borderRadius: radius.md, minHeight: 48 },
  message: { flex: 1 },
});
