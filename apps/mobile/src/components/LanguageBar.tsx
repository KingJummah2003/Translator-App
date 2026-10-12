import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';
import { getLanguage } from '@translator/shared';
import { languageName, t } from '@/lib/i18n';
import { swapLanguages, useAppState } from '@/lib/store';
import { iconSize, radius, space, useColors } from '@/theme';
import { IconButton } from './Button';
import { Icon } from './Icon';
import { PressableScale, SpinOnPress, enterFade, slideIn } from './motion';
import { Text } from './Text';

/** Language name in the interface language; '' for a missing code, so callers never crash. */
export function displayName(code?: string | null): string {
  if (!code) return '';
  if (code === 'auto') return t('detect');
  const l = getLanguage(code);
  return l ? languageName(code, l.name) : code;
}

/** The ⇄ button: spins half a turn on every press. Shared by the language bar and Talk. */
export function SwapButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <SpinOnPress>
      {(spin) => (
        <IconButton
          icon="swap"
          label={t('swap')}
          disabled={disabled}
          onPress={() => {
            spin();
            onPress();
          }}
        />
      )}
    </SpinOnPress>
  );
}

type Side = 'source' | 'target';
/** How a pill's label arrived: from the other pill (swap), or picked from the list. */
type Change = 'swap' | 'pick';

/**
 * One language chip. Opens the language sheet for its side. Also used on its own by Talk, so
 * both screens have the same chip.
 */
export function LanguagePill({
  side,
  code,
  detected,
  allowAuto = true,
  change = 'pick',
  onPress,
  label: shownLabel,
  labelLanguage,
  style,
}: {
  side: Side;
  /** 'auto' or a language code. */
  code: string;
  /** The detected language while `code` is 'auto'. */
  detected?: string | null;
  allowAuto?: boolean;
  change?: Change;
  /** Defaults to opening the language sheet. */
  onPress?: () => void;
  /**
   * Visible text in place of the interface-language name, e.g. the language's own name for the
   * other person in Talk. The screen-reader label stays in the interface language.
   */
  label?: string;
  /** Language of `label`, so its script lays out correctly. */
  labelLanguage?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const downloaded = useAppState((s) => s.downloadedModels);
  const isDetected = code === 'auto' && !!detected;
  const label = isDetected ? displayName(detected) : displayName(code);
  const onDevice = code !== 'auto' && downloaded.includes(code);
  const spoken = [
    `${side === 'source' ? t('translateFrom') : t('translateTo')}: ${isDetected ? t('detected', { lang: label }) : label}`,
    onDevice ? t('offlineBadge') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={t('chooseLanguage')}
      onPress={onPress ?? (() => router.push({ pathname: '/languages', params: { side, allowAuto: allowAuto ? '1' : '0' } }))}
      highlight={c.pressed}
      style={[styles.pill, { backgroundColor: c.surface, borderColor: c.borderStrong }, style]}>
      {/* A new label slides in from the side it came from (the other pill) on swap, or fades in. */}
      <Animated.View key={`${code}:${label}`} entering={change === 'swap' ? slideIn(side === 'source') : enterFade} style={styles.pillLabel}>
        <Text
          variant="label"
          language={shownLabel ? labelLanguage : undefined}
          flow="ui"
          numberOfLines={fontScale > 1.3 ? 2 : 1}
          style={styles.pillText}>
          {shownLabel || label}
        </Text>
        {isDetected ? <Icon name="sparkles" size={iconSize.xs} color={c.accent} /> : null}
        {onDevice ? <Icon name="device" size={iconSize.xs} color={c.textMuted} /> : null}
      </Animated.View>
    </PressableScale>
  );
}

/** Source ⇄ target selector shared by the translate, camera, talk and files screens. */
export function LanguageBar({ detected, allowAuto = true }: { detected?: string | null; allowAuto?: boolean }) {
  const source = useAppState((s) => s.source);
  const target = useAppState((s) => s.target);
  const shownSource = !allowAuto && source === 'auto' ? (detected ?? 'en') : source;
  // What each side actually is (auto counts as the detected language), to tell a swap from a pick.
  const effective = shownSource === 'auto' ? (detected ?? 'auto') : shownSource;

  // Derived during render (not in an effect): when both sides changed places, it was a swap.
  const [last, setLast] = useState({ source: effective, target, change: 'pick' as Change });
  if (last.source !== effective || last.target !== target) {
    setLast({ source: effective, target, change: effective === last.target && target === last.source ? 'swap' : 'pick' });
  }

  return (
    // Labels animate only when they change, never when the bar first appears.
    <LayoutAnimationConfig skipEntering>
      <View style={styles.bar}>
        <LanguagePill side="source" code={shownSource} detected={detected} allowAuto={allowAuto} change={last.change} />
        <SwapButton onPress={() => swapLanguages(detected)} disabled={source === 'auto' && !detected} />
        <LanguagePill side="target" code={target} allowAuto={allowAuto} change={last.change} />
      </View>
    </LayoutAnimationConfig>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  pill: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs, maxWidth: '100%' },
  pillText: { flexShrink: 1, textAlign: 'center' },
});
