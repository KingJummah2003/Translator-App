import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '@/theme';
import { Text } from './Text';

/**
 * The top of every tab page: large title (a screen-reader heading), optional subtitle, and
 * optional leading / trailing controls (e.g. an IconButton for History). Screen's `gap` spaces it
 * from the content below, so it has no bottom margin of its own.
 */
export function ScreenHeader({
  title,
  subtitle,
  leading,
  trailing,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      {leading ? <View style={styles.side}>{leading}</View> : null}
      <View style={styles.texts}>
        <Text variant="display" heading>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={[styles.side, styles.trailing]}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingTop: space.md },
  // Keeps the title readable at large text sizes: it wraps instead of pushing buttons off-screen.
  texts: { flex: 1, minWidth: 0, gap: space.xs },
  // Display line height is 38; a 44 pt control is centred on the first title line.
  side: { minHeight: 38, justifyContent: 'center', marginTop: -3 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
