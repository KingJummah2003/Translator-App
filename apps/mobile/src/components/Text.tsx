import type { ReactNode } from 'react';
import { I18nManager, Platform, StyleSheet, Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { getLanguage, isRtl } from '@translator/shared';
import { uiLanguage } from '@/lib/i18n';
import { arabicSmallType, type as typeScale, useColors } from '@/theme';

type Variant = keyof typeof typeScale;
type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'danger' | 'success' | 'warning' | 'onAccent';

export interface Props extends TextProps {
  variant?: Variant;
  tone?: Tone;
  /** Language of the content, so right-to-left scripts align and flow correctly. */
  language?: string | null;
  align?: TextStyle['textAlign'];
  /** Uppercase for Latin interface labels. Ignored for Arabic and for content. Default on for `eyebrow`. */
  caps?: boolean;
  /** Announce as a heading (screen-reader heading navigation). `display` text is a heading by default. */
  heading?: boolean;
  /**
   * With `language`: 'content' (default) aligns to the script's own side, like a paragraph;
   * 'ui' keeps the script's direction but sits on the interface's start edge (names in lists,
   * a dictionary headword next to an English label).
   */
  flow?: 'content' | 'ui';
}

// React Native mirrors 'left'/'right' when the interface itself is right-to-left, so the
// absolute side for content alignment has to be flipped back in that case.
const SWAPPED = I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL;
export function contentAlign(rtl: boolean): TextStyle['textAlign'] {
  return rtl !== SWAPPED ? 'right' : 'left';
}

const ARABIC_UI = uiLanguage === 'ar';
const ANDROID = Platform.OS === 'android';
const RLM = '\u200F';
// Right-to-left letters (Hebrew, Arabic and their presentation forms) and the first letter of a string.
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const FIRST_LETTER = /\p{L}/u;

/**
 * Paragraph direction comes from the first strong letter, so in the Arabic interface a string that
 * starts with Latin but contains Arabic ("VIP · شهري", "PDF ملف") would lay out left to right.
 * Such strings get a leading right-to-left mark. Pure Latin strings (emails, numbers) are untouched.
 */
function anchorRtl(children: ReactNode): ReactNode {
  const parts = Array.isArray(children) ? children : [children];
  if (!parts.every((p) => typeof p === 'string' || typeof p === 'number')) return children;
  const text = parts.join('');
  const first = text.match(FIRST_LETTER)?.[0];
  return first && !RTL_LETTER.test(first) && RTL_LETTER.test(text) ? RLM + text : children;
}

/** Cap Dynamic Type / font scale per style so large text grows without breaking layouts. */
const MAX_SCALE: Record<Variant, number> = {
  display: 1.4,
  title: 1.5,
  heading: 1.8,
  result: 2,
  input: 2,
  body: 2,
  button: 1.6,
  field: 1.8,
  label: 1.6,
  caption: 1.8,
  micro: 1.4,
  eyebrow: 1.4,
};

export function Text({
  variant = 'body',
  tone = 'default',
  language,
  align,
  caps,
  heading,
  flow = 'content',
  style,
  children,
  accessibilityRole,
  maxFontSizeMultiplier,
  textBreakStrategy,
  android_hyphenationFrequency,
  ...rest
}: Props) {
  const c = useColors();
  const color = {
    default: c.text,
    muted: c.textMuted,
    faint: c.textFaint,
    accent: c.accent,
    danger: c.danger,
    success: c.success,
    warning: c.warning,
    onAccent: c.onAccent,
  }[tone];

  // `language` undefined: interface text. null: content in an unknown language (left alone).
  const content = language !== undefined;
  const lang = language || null;
  const rtl = lang ? isRtl(lang) : undefined;
  // Latin tracking and capitals only make sense for Latin interface text.
  const latinUi = !ARABIC_UI && !content;
  const upper = (caps ?? variant === 'eyebrow') && latinUi;
  const smallArabic = ARABIC_UI && !content && (variant === 'micro' || variant === 'eyebrow');

  let direction: TextStyle | undefined;
  if (rtl !== undefined) {
    direction = {
      writingDirection: rtl ? 'rtl' : 'ltr',
      textAlign: align ?? contentAlign(flow === 'ui' ? I18nManager.isRTL : rtl),
    };
  } else if (align) {
    direction = { textAlign: align };
  }

  // A mark rather than writingDirection, which Android ignores.
  const body = ARABIC_UI && !content ? anchorRtl(children) : children;

  return (
    <RNText
      {...rest}
      accessibilityRole={accessibilityRole ?? (heading || variant === 'display' ? 'header' : undefined)}
      accessibilityLanguage={rest.accessibilityLanguage ?? (lang && lang !== 'auto' ? (getLanguage(lang)?.speech ?? lang) : undefined)}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? MAX_SCALE[variant]}
      textBreakStrategy={textBreakStrategy ?? (ANDROID ? 'simple' : undefined)}
      android_hyphenationFrequency={android_hyphenationFrequency ?? (ANDROID ? 'none' : undefined)}
      style={[
        typeScale[variant],
        { color },
        !latinUi && styles.noTracking,
        smallArabic && arabicSmallType,
        upper && styles.caps,
        direction,
        style,
      ]}>
      {ANDROID && !rest.selectable ? withSlack(body) : body}
    </RNText>
  );
}

/**
 * Android sizes a shrink-wrapped label to its exact text width, then the view snaps a fraction
 * of a pixel narrower, so the last word wraps onto a clipped second line ("Tap and speak" ->
 * "Tap and", "VIP · Monthly" -> "VIP ·"). A trailing hair space adds a few pixels to the
 * measured width; at the end of a line it is allowed to hang, so it never wraps itself.
 */
const HAIR_SPACE = '\u200A';
function withSlack(children: ReactNode): ReactNode {
  if (typeof children === 'string') return children ? children + HAIR_SPACE : children;
  if (Array.isArray(children) && children.length && children.every((c) => typeof c === 'string' || typeof c === 'number')) {
    return [...children, HAIR_SPACE];
  }
  return children;
}

const styles = StyleSheet.create({
  noTracking: { letterSpacing: 0 },
  caps: { textTransform: 'uppercase' },
});
