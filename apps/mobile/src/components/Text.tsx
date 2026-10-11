import { I18nManager, Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { isRtl } from '@translator/shared';
import { type as typeScale, useColors } from '@/theme';

type Variant = keyof typeof typeScale;
type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'danger' | 'success' | 'onAccent';

export interface Props extends TextProps {
  variant?: Variant;
  tone?: Tone;
  /** Language of the content, so right-to-left scripts align and flow correctly. */
  language?: string | null;
  align?: TextStyle['textAlign'];
}

// React Native mirrors 'left'/'right' when the interface itself is right-to-left, so the
// absolute side for content alignment has to be flipped back in that case.
const SWAPPED = I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL;
export function contentAlign(rtl: boolean): TextStyle['textAlign'] {
  return rtl !== SWAPPED ? 'right' : 'left';
}

export function Text({ variant = 'body', tone = 'default', language, align, style, ...rest }: Props) {
  const c = useColors();
  const color = {
    default: c.text,
    muted: c.textMuted,
    faint: c.textFaint,
    accent: c.accent,
    danger: c.danger,
    success: c.success,
    onAccent: c.onAccent,
  }[tone];
  const rtl = language ? isRtl(language) : undefined;
  return (
    <RNText
      {...rest}
      style={[
        typeScale[variant],
        { color },
        rtl !== undefined && { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: align ?? contentAlign(rtl) },
        rtl === undefined && align && { textAlign: align },
        style,
      ]}
    />
  );
}
