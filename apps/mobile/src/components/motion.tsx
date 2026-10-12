import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  I18nManager,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInRight,
  FadeInUp,
  FadeOut,
  FadeOutUp,
  Keyframe,
  LayoutAnimationConfig,
  LinearTransition,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type LayoutAnimationFunction,
} from 'react-native-reanimated';
import { formatNumber } from '@/lib/i18n';
import { useColors } from '@/theme';
import { Text, type Props as TextProps } from './Text';

/**
 * One small motion system for the whole app. Rules:
 *  - Transitions last 150-260 ms; springs settle in under 280 ms (a Reanimated 4 spring with a
 *    `duration` runs for about 1.5x that value, so the spring numbers are 2/3 of the real time).
 *  - Things arriving decelerate (easeOut); things leaving accelerate (easeIn) and leave faster.
 *  - Only opacity and transforms animate, except `layout` (sibling reflow), which runs natively.
 *  - Everything keeps Reanimated's default ReduceMotion.System: with Reduce Motion / Remove
 *    animations on, entering/exiting/layout animations are skipped, timing and spring animations
 *    jump to their end, and repeating ones stay still.
 *  - Shared values are only touched in effects, event handlers and worklets (React Compiler safe).
 *
 * Presets are SHARED builder instances: never chain `.delay()` / `.duration()` on them (builder
 * methods mutate the instance). Use the factories (listItem, slideIn) for variants.
 * Never put `entering`/`exiting` on a view whose style animates opacity or transform (such as
 * PressableScale): wrap it in an Animated.View instead.
 */

export const duration = { fast: 150, base: 200, slow: 260 } as const;
/** Alias of `duration`. */
export const durations = duration;

export const easing = {
  /** Arriving, settling (Material "emphasized decelerate"-like). */
  out: Easing.bezier(0.2, 0, 0, 1),
  /** Leaving. */
  in: Easing.bezier(0.3, 0, 1, 1),
};

export const timing = {
  fast: { duration: duration.fast, easing: easing.out },
  base: { duration: duration.base, easing: easing.out },
  slow: { duration: duration.slow, easing: easing.out },
};

export const spring = {
  /** Finger down: fast, no overshoot (~150 ms). */
  press: { duration: 100, dampingRatio: 1 },
  /** Finger up: a hint of bounce, settled by ~240 ms. */
  release: { duration: 160, dampingRatio: 0.7 },
  /** Rotations and toggles (~270 ms). */
  snappy: { duration: 180, dampingRatio: 0.85 },
};

/* ───────────────────────── Presets ───────────────────────── */

/** Cards and results: rise 8 px while fading in. */
export const enterUp = FadeInDown.duration(duration.slow).easing(easing.out).withInitialValues({ translateY: 8 });
/** Banners and notices: drop 6 px from above. */
export const enterDown = FadeInUp.duration(duration.base).easing(easing.out).withInitialValues({ translateY: -6 });
/** Plain fade for content swaps (sheet bodies, segmented content, empty states). */
export const enterFade = FadeIn.duration(duration.base).easing(easing.out);
/** Skeletons wait 120 ms so a fast on-device result never flashes a placeholder. */
export const enterDelayed = FadeIn.duration(duration.base).delay(120).easing(easing.out);
/** Conversation bubbles: rise and grow slightly from 96 %. */
export const enterBubble = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 10 }, { scale: 0.96 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }], easing: easing.out },
}).duration(duration.slow - 40);
/** Glyph swaps (copy -> check, mic -> stop) and small badges. */
export const enterPop = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.6 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: easing.out },
}).duration(duration.fast + 30);

export const exitFade = FadeOut.duration(duration.fast).easing(easing.in);
/** Banners leave the way they came. */
export const exitUp = FadeOutUp.duration(duration.fast).easing(easing.in).withTargetValues({ translateY: -6 });

/** Grouped presets (same instances as above). */
export const enter = { card: enterUp, banner: enterDown, fade: enterFade, skeleton: enterDelayed, bubble: enterBubble, pop: enterPop };
export const exit = { fade: exitFade, banner: exitUp };

/**
 * Sibling reflow (`layout={layoutTransition}`): when something above appears or disappears, the
 * view glides to its new place. Only the position animates; size snaps, so a card whose text
 * grows while typing never shows content spilling past its background. A module constant on
 * purpose: a new `layout` object every render would re-register the transition natively.
 */
export const layoutTransition: LayoutAnimationFunction = (values) => {
  'worklet';
  return {
    initialValues: {
      originX: values.currentOriginX,
      originY: values.currentOriginY,
      width: values.targetWidth,
      height: values.targetHeight,
    },
    animations: {
      originX: withTiming(values.targetOriginX, timing.base),
      originY: withTiming(values.targetOriginY, timing.base),
    },
  };
};
/** Alias of `layoutTransition`. */
export const move = layoutTransition;

/** Reordering rows of equal height (Animated.FlatList `itemLayoutAnimation`). */
export const reorder = LinearTransition.duration(duration.base).easing(easing.out);

const STAGGER_MS = 30;
const STAGGER_MAX = 10;
const listItems = Array.from({ length: STAGGER_MAX }, (_, i) =>
  FadeInDown.duration(duration.base)
    .delay(i * STAGGER_MS)
    .easing(easing.out)
    .withInitialValues({ translateY: 6 }),
);

/** Staggered list entrance: only the first 10 rows animate, so long lists never feel slow. */
export function listItem(index: number) {
  return listItems[index];
}

// translateX is not mirrored in right-to-left layouts, so the sign is flipped by hand.
const slideFromEnd = FadeInRight.duration(duration.base)
  .easing(easing.out)
  .withInitialValues({ translateX: I18nManager.isRTL ? -10 : 10 });
const slideFromStart = FadeInRight.duration(duration.base)
  .easing(easing.out)
  .withInitialValues({ translateX: I18nManager.isRTL ? 10 : -10 });

/** A label that slides in from the inline end (true) or start (false); mirrors itself in RTL. */
export function slideIn(fromEnd: boolean) {
  return fromEnd ? slideFromEnd : slideFromStart;
}

/* ───────────────────────── PressableScale ───────────────────────── */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Scale at full press: 0.97 buttons and pills, 0.9 icon buttons, 1 (none) for list rows. */
  scaleTo?: number;
  /** Colour that fades in over the background while pressed (theme `pressed` for most). */
  highlight?: string;
  /** Selection haptic on press. Default on. */
  haptic?: boolean;
};

function tick() {
  Haptics.selectionAsync().catch(() => {});
}

/**
 * The app's one press feedback: a quick spring scale plus an optional pressed wash, on the UI
 * thread. With Reduce Motion it keeps the wash and drops the scale. It owns `transform`, so do
 * not give it a transform style or `entering`/`exiting` (wrap it in an Animated.View instead).
 */
export function PressableScale({
  scaleTo = 0.97,
  highlight,
  haptic = true,
  style,
  children,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const to = reduced ? 1 : scaleTo;
  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.get(), [0, 1], [1, to]) }],
  }));
  const highlightStyle = useAnimatedStyle(() => ({ opacity: pressed.get() }));
  const corner = StyleSheet.flatten(style)?.borderRadius;

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e: GestureResponderEvent) => {
        pressed.set(withSpring(1, spring.press));
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        pressed.set(withSpring(0, spring.release));
        onPressOut?.(e);
      }}
      onPress={
        onPress
          ? (e: GestureResponderEvent) => {
              if (haptic) tick();
              onPress(e);
            }
          : undefined
      }
      style={[style, scaleStyle]}>
      {highlight ? (
        <Animated.View style={[StyleSheet.absoluteFill, styles.noTouch, { backgroundColor: highlight, borderRadius: corner }, highlightStyle]} />
      ) : null}
      {children}
    </AnimatedPressable>
  );
}

/* ───────────────────────── Swap rotation ───────────────────────── */

/** Wraps the swap button: each press spins it half a turn (the ⇄ glyph looks the same after 180°). */
export function SpinOnPress({ children }: { children: (spin: () => void) => ReactNode }) {
  const [turns, setTurns] = useState(0);
  // Half a turn in the reading direction: clockwise in LTR, counter-clockwise in RTL.
  const half = I18nManager.isRTL ? -180 : 180;
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: withSpring(`${turns * half}deg`, spring.snappy) }] }));
  return <Animated.View style={style}>{children(() => setTurns((n) => n + 1))}</Animated.View>;
}

/* ───────────────────────── Listening halo ───────────────────────── */

/**
 * A soft ring that breathes out from behind the mic while listening. Render it as the first child
 * of a wrapper the same size as the button. One wave a second on purpose: faster repeating
 * pulses read as flashing (WCAG 2.3.1). With Reduce Motion it is a static ring.
 */
export function ListenHalo({
  active,
  color,
  radius,
  scale = 1.5,
}: {
  active: boolean;
  color: string;
  radius: number;
  scale?: number | { x: number; y: number };
}) {
  const reduced = useReducedMotion();
  const visible = useSharedValue(0);
  const wave = useSharedValue(0);
  const sx = typeof scale === 'number' ? scale : scale.x;
  const sy = typeof scale === 'number' ? scale : scale.y;

  useEffect(() => {
    visible.set(withTiming(active ? 1 : 0, timing.fast));
    if (active && !reduced) {
      wave.set(0);
      wave.set(withRepeat(withTiming(1, { duration: 1000, easing: Easing.out(Easing.quad) }), -1, false));
    } else {
      cancelAnimation(wave);
      wave.set(reduced ? 0.35 : 0);
    }
    return () => cancelAnimation(wave);
  }, [active, reduced, visible, wave]);

  const style = useAnimatedStyle(() => ({
    opacity: visible.get() * interpolate(wave.get(), [0, 1], [0.35, 0]),
    transform: [{ scaleX: interpolate(wave.get(), [0, 1], [1, sx]) }, { scaleY: interpolate(wave.get(), [0, 1], [1, sy]) }],
  }));

  return <Animated.View style={[StyleSheet.absoluteFill, styles.noTouch, { backgroundColor: color, borderRadius: radius }, style]} />;
}
/** Alias of ListenHalo. */
export const ListeningHalo = ListenHalo;

/* ───────────────────────── Skeleton ───────────────────────── */

function SkeletonLine({ width, height, color, index }: { width: DimensionValue; height: number; color: string; index: number }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    // A wave runs down the lines: each one starts 120 ms after the one above.
    pulse.set(withDelay(index * 120, withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true)));
    return () => cancelAnimation(pulse);
  }, [pulse, index]);
  const style = useAnimatedStyle(() => ({ opacity: interpolate(pulse.get(), [0, 1], [0.12, 0.26]) }));
  return <Animated.View style={[{ width, height, borderRadius: height / 2, backgroundColor: color }, style]} />;
}

const LINE_WIDTHS: DimensionValue[] = ['92%', '74%', '58%'];

/** Placeholder lines while something loads. Appears after 120 ms so quick loads never flash. */
export function Skeleton({
  lines = 2,
  height = 18,
  color,
  label,
  style,
}: {
  lines?: number;
  height?: number;
  color?: string;
  /** Read by screen readers, e.g. t('translating'). */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <Animated.View
      entering={enterDelayed}
      exiting={exitFade}
      style={[styles.skeleton, style]}
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}>
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} index={i} width={LINE_WIDTHS[i % LINE_WIDTHS.length] ?? '80%'} height={height} color={color ?? c.accent} />
      ))}
    </Animated.View>
  );
}

/* ───────────────────────── Progress bar ───────────────────────── */

const SEGMENT = 0.4;

/**
 * Progress from 0 to 1. Determinate progress animates scaleX from the inline start edge (no
 * layout pass per update, correct in RTL). `null`/`undefined` shows an indeterminate segment that
 * sweeps toward the inline end (a still segment with Reduce Motion).
 */
export function ProgressBar({
  progress,
  label,
  style,
}: {
  progress?: number | null;
  /** Read by screen readers with the percentage, e.g. the file or language name. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const reduced = useReducedMotion();
  const indeterminate = progress == null || Number.isNaN(progress);
  const p = indeterminate ? 0 : Math.min(Math.max(progress, 0), 1);
  const [width, setWidth] = useState(0);
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (indeterminate && !reduced) {
      sweep.set(0);
      sweep.set(withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false));
    } else {
      cancelAnimation(sweep);
      sweep.set(0);
    }
    return () => cancelAnimation(sweep);
  }, [indeterminate, reduced, sweep]);

  const dir = I18nManager.isRTL ? -1 : 1;
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: withTiming(p, timing.slow) }] }));
  const segment = useAnimatedStyle(() => ({
    transform: [{ translateX: dir * interpolate(sweep.get(), [0, 1], [-SEGMENT * width, width]) }],
  }));

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: c.surfaceAlt }, style]}
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      accessibilityValue={indeterminate ? undefined : { min: 0, max: 100, now: Math.round(p * 100) }}>
      {indeterminate ? (
        <Animated.View style={[styles.segment, { backgroundColor: c.accent }, segment]} />
      ) : (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.accent, transformOrigin: I18nManager.isRTL ? 'right' : 'left' }, fill]} />
      )}
    </View>
  );
}

/* ───────────────────────── Animated number ───────────────────────── */

const numberUp = FadeInDown.duration(duration.base).easing(easing.out).withInitialValues({ translateY: 10 });
const numberDown = FadeInUp.duration(duration.base).easing(easing.out).withInitialValues({ translateY: -10 });

/**
 * A number that rolls when it changes: the new value rises in from below when it grows and drops
 * in from above when it shrinks, while the old one fades out. Nothing moves on first render.
 * Takes the same props as <Text>.
 */
export function AnimatedNumber({ value, format, style, ...textProps }: TextProps & { value: number; format?: (n: number) => string }) {
  const [prev, setPrev] = useState(value);
  const [rising, setRising] = useState(true);
  if (value !== prev) {
    setPrev(value);
    setRising(value > prev);
  }
  return (
    <LayoutAnimationConfig skipEntering>
      <Animated.View key={value} entering={rising ? numberUp : numberDown} exiting={exitFade}>
        <Text {...textProps} style={[styles.tabular, style]}>
          {(format ?? formatNumber)(value)}
        </Text>
      </Animated.View>
    </LayoutAnimationConfig>
  );
}
/** Alias of AnimatedNumber. */
export const RollingNumber = AnimatedNumber;

/* ───────────────────────── Tab content fade ───────────────────────── */

/**
 * Material "fade through" for tab switches. The screen is only hidden when the user switched to
 * another tab; when a sheet or a pushed screen covers it, it stays visible underneath.
 * Screen applies it with `<Screen tab>`; screens that don't use Screen can call it directly.
 */
export function useTabFade() {
  const navigation = useNavigation();
  const opacity = useSharedValue(1);
  useFocusEffect(
    useCallback(() => {
      opacity.set(withTiming(1, timing.base));
      return () => {
        if (navigation.getParent()?.isFocused()) opacity.set(0);
      };
    }, [navigation, opacity]),
  );
  return useAnimatedStyle(() => ({ opacity: opacity.get() }));
}

export { LayoutAnimationConfig, useReducedMotion };

const styles = StyleSheet.create({
  noTouch: { pointerEvents: 'none' },
  skeleton: { gap: 10, paddingVertical: 4 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  segment: { position: 'absolute', top: 0, bottom: 0, start: 0, width: `${SEGMENT * 100}%` },
  tabular: { fontVariant: ['tabular-nums'] } as TextStyle,
});
