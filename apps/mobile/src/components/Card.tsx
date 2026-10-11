import { StyleSheet, View, type ViewProps } from 'react-native';
import { radius, shadow, space, useColors } from '@/theme';

export function Card({ style, tone = 'surface', ...rest }: ViewProps & { tone?: 'surface' | 'alt' | 'accent' }) {
  const c = useColors();
  const backgroundColor = tone === 'alt' ? c.surfaceAlt : tone === 'accent' ? c.accentSoft : c.surface;
  return <View {...rest} style={[styles.card, tone === 'surface' && shadow, { backgroundColor, borderColor: c.border }, style]} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.lg, borderWidth: StyleSheet.hairlineWidth },
});
