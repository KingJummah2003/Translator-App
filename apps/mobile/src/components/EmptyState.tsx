import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { iconSize, radius, space, useColors } from '@/theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { enterFade } from './motion';
import { Text } from './Text';

/**
 * What a list or page shows when there is nothing to show (no history, no search results, a
 * word with no entry) or when it cannot load. Centred icon tile, title, optional message and one
 * optional action. Fades in.
 */
export function EmptyState({
  icon,
  title,
  message,
  action,
  onAction,
  actionIcon,
  tone = 'default',
  style,
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: string;
  onAction?: () => void;
  actionIcon?: IconName;
  /** 'danger' for a failure state (the action is usually Retry). */
  tone?: 'default' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const danger = tone === 'danger';
  return (
    <Animated.View entering={enterFade} style={[styles.wrap, style]}>
      <View style={[styles.tile, { backgroundColor: danger ? c.dangerSoft : c.accentSoft }]}>
        <Icon name={icon} size={iconSize.lg} color={danger ? c.danger : c.accent} />
      </View>
      <View style={styles.texts} accessibilityLiveRegion="polite">
        <Text variant="heading" align="center" heading>
          {title}
        </Text>
        {message ? (
          <Text variant="body" tone="muted" align="center">
            {message}
          </Text>
        ) : null}
      </View>
      {action && onAction ? <Button title={action} icon={actionIcon} kind="secondary" compact onPress={onAction} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  tile: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  texts: { gap: space.xs, alignItems: 'center', maxWidth: 360 },
});
