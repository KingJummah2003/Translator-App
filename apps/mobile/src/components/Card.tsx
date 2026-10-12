import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { radius, space, useColors, useElevation } from '@/theme';

const HAIRLINE = StyleSheet.hairlineWidth;
const SELECTED_BORDER = 2;

export type CardProps = ComponentProps<typeof Animated.View> & {
  tone?: 'surface' | 'alt' | 'accent';
  /** Inner padding; 0 for grouped lists whose rows bring their own. */
  padding?: number;
  /** Selected option (plans, pickers): 2 pt accent border, without shifting the content. */
  selected?: boolean;
  /** No shadow, e.g. a card inside another card or on a sheet. */
  flat?: boolean;
};

/**
 * The one surface spec: radius.lg, hairline border, soft shadow in light mode (surface tone only).
 * An Animated.View, so it takes Reanimated `entering` / `exiting` / `layout` props. Do not give
 * it an opacity or transform style together with those.
 */
export function Card({ style, tone = 'surface', padding = space.lg, selected, flat, ...rest }: CardProps) {
  const c = useColors();
  const lift = useElevation();
  const backgroundColor = tone === 'alt' ? c.surfaceAlt : tone === 'accent' ? c.accentSoft : c.surface;
  const border = selected ? SELECTED_BORDER : HAIRLINE;
  return (
    <Animated.View
      {...rest}
      style={[
        styles.card,
        {
          backgroundColor,
          borderColor: selected ? c.accent : c.border,
          borderWidth: border,
          padding: Math.max(0, padding - (border - HAIRLINE)),
        },
        tone === 'surface' && !flat && lift,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg },
});
