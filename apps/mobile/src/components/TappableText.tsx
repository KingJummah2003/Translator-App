import { Fragment, useState } from 'react';
import { Platform, StyleSheet, Text as RNText, View, type AccessibilityActionEvent } from 'react-native';
import { isRtl } from '@translator/shared';
import { t } from '@/lib/i18n';
import { useColors } from '@/theme';
import { Text, type Props as TextProps } from './Text';

/** A word: a letter followed by letters, marks, apostrophes or hyphens. Also used by History. */
export const WORD = /(\p{L}[\p{L}\p{M}'’\-]*)/u;

// Scripts whose letters carry dots and marks below the baseline (or have no word spaces):
// an underline would cut through them, so tappability is shown on press only.
const NO_UNDERLINE = new Set(['zh', 'zh-TW', 'ja', 'ko', 'th', 'lo', 'km', 'my', 'hi', 'bn', 'mr', 'ne', 'gu', 'pa', 'ta', 'te', 'kn', 'ml', 'si', 'am', 'bo']);
// Android draws the dotted underline as alternating faint/clear letter spans (see below). Very
// long texts would need thousands of spans, so they get a plain faint underline instead.
const DOTTED_MAX_CHARS = 1500;
// Screen-reader fallback: one "Look up" action per distinct word, capped so the menu stays usable.
const MAX_ACTIONS = 20;
// A cluster: a base character with its combining marks.
const CLUSTER = /\P{M}\p{M}*/gu;

/**
 * Text where every word can be tapped (opens the dictionary). Words carry a faint dotted underline
 * in scripts where that is legible, and highlight while pressed. Screen readers get each word as a
 * link (TalkBack's Links menu, VoiceOver's Links rotor) plus "Look up …" actions on the paragraph.
 */
export function TappableText({
  text,
  lang,
  variant,
  onWord,
}: {
  text: string;
  lang: string;
  variant?: TextProps['variant'];
  onWord: (word: string) => void;
}) {
  const c = useColors();
  const [pressed, setPressed] = useState<number | null>(null);
  const parts = text.split(WORD);
  const underline = !isRtl(lang) && !NO_UNDERLINE.has(lang);
  const words = [...new Set(parts.filter((_, i) => i % 2 === 1))].slice(0, MAX_ACTIONS);

  const visible = (
    <Text
      variant={variant}
      language={lang}
      selectable
      accessibilityActions={words.map((w, i) => ({ name: `word-${i}`, label: t('lookUpWord', { word: w }) }))}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        const word = words[Number(e.nativeEvent.actionName.slice('word-'.length))];
        if (word) onWord(word);
      }}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <RNText
            key={i}
            accessibilityRole="link"
            accessibilityHint={t('tapWordHint')}
            onPress={() => onWord(part)}
            onPressIn={() => setPressed(i)}
            onPressOut={() => setPressed(null)}
            suppressHighlighting
            style={[
              underline && Platform.OS === 'ios' && { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: c.textFaint },
              pressed === i && { backgroundColor: c.pressed },
            ]}>
            {part}
          </RNText>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </Text>
  );

  if (!underline || Platform.OS !== 'android') return visible;

  // Android ignores textDecorationStyle and textDecorationColor: an underline is always solid
  // and in the text colour. So an identical copy of the paragraph is laid out underneath, where
  // only the words are underlined and coloured faint / transparent letter by letter, giving a
  // faint dotted line. Colour and underline do not affect measurement, so both copies break
  // lines identically and the visible copy's glyphs cover the copy's.
  const dotted = text.length <= DOTTED_MAX_CHARS;
  return (
    <View>
      <Text variant={variant} language={lang} style={styles.under} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <RNText key={i} style={[styles.underline, !dotted && { color: c.textFaint }]}>
              {dotted
                ? (part.match(CLUSTER) ?? [part]).map((g, j) => (
                    <RNText key={j} style={{ color: j % 2 === 0 ? c.textFaint : 'transparent' }}>
                      {g}
                    </RNText>
                  ))
                : part}
            </RNText>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        )}
      </Text>
      <View style={StyleSheet.absoluteFill}>{visible}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  under: { color: 'transparent' },
  underline: { textDecorationLine: 'underline' },
});
