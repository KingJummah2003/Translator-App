import { useState, type Ref } from 'react';
import { Platform, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { t } from '@/lib/i18n';
import { iconSize, radius, space, type as typeScale, useColors } from '@/theme';
import { IconButton } from './Button';
import { Icon, type IconName } from './Icon';
import { Text, contentAlign } from './Text';

type Kind = 'text' | 'email' | 'password' | 'newPassword' | 'code' | 'search';

/** Keyboard, autofill and direction presets. Email, passwords and codes are always left to right. */
const PRESETS: Record<Kind, TextInputProps & { ltr?: boolean }> = {
  text: {},
  email: {
    keyboardType: 'email-address',
    inputMode: 'email',
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'email',
    textContentType: 'emailAddress',
    ltr: true,
  },
  password: {
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'current-password',
    textContentType: 'password',
    ltr: true,
  },
  newPassword: {
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'new-password',
    textContentType: 'newPassword',
    ltr: true,
  },
  code: {
    keyboardType: 'number-pad',
    inputMode: 'numeric',
    autoComplete: Platform.OS === 'android' ? 'sms-otp' : 'one-time-code',
    textContentType: 'oneTimeCode',
    maxLength: 6,
    ltr: true,
  },
  search: {
    autoCapitalize: 'none',
    autoCorrect: false,
    returnKeyType: 'search',
    clearButtonMode: 'while-editing',
  },
};

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  /** Visible label above the field (placeholders vanish while typing, so don't rely on them). */
  label?: string;
  /** Help text under the field. */
  hint?: string;
  /** Error under the field; also turns the border red and is read by screen readers. */
  error?: string | null;
  kind?: Kind;
  /** Force left-to-right input regardless of the interface direction. On for email, password, code. */
  ltr?: boolean;
  /** Leading icon (search defaults to a magnifier). */
  icon?: IconName;
  /** Container style. */
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  ref?: Ref<TextInput>;
};

/**
 * Themed text field: accent caret and selection on both platforms (no Material teal), visible
 * label, hint and error, focus border, password reveal, and LTR input for emails and codes.
 */
export function TextField({
  label,
  hint,
  error,
  kind = 'text',
  ltr,
  icon,
  style,
  inputStyle,
  ref,
  onFocus,
  onBlur,
  secureTextEntry,
  accessibilityLabel,
  accessibilityHint,
  editable = true,
  ...rest
}: TextFieldProps) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const { ltr: presetLtr, ...preset } = PRESETS[kind];
  const forceLtr = ltr ?? presetLtr ?? false;
  const secret = kind === 'password' || kind === 'newPassword' ? !revealed : secureTextEntry;
  const leading = icon ?? (kind === 'search' ? 'search' : undefined);
  const search = kind === 'search';
  const borderColor = error ? c.danger : focused ? c.accent : search ? 'transparent' : c.borderStrong;

  return (
    <View style={[styles.wrap, style]}>
      {label ? (
        <Text variant="label" tone="muted">
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          search && styles.searchField,
          { backgroundColor: search ? c.surfaceAlt : c.surface, borderColor },
          !editable && styles.disabled,
        ]}>
        {leading ? <Icon name={leading} size={iconSize.sm} color={c.textMuted} /> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={c.textMuted}
          cursorColor={c.accent}
          selectionHandleColor={c.accent}
          // Android tints the whole selection with this colour, so it needs the soft variant.
          selectionColor={Platform.OS === 'ios' ? c.accent : c.accentSoft}
          editable={editable}
          maxFontSizeMultiplier={1.8}
          {...preset}
          {...rest}
          secureTextEntry={secret}
          accessibilityLabel={accessibilityLabel ?? label ?? rest.placeholder}
          accessibilityHint={error ?? accessibilityHint ?? hint}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.input,
            { color: c.text },
            forceLtr && styles.ltr,
            kind === 'code' && styles.code,
            inputStyle,
          ]}
        />
        {kind === 'password' || kind === 'newPassword' ? (
          <IconButton
            icon={revealed ? 'eyeOff' : 'eye'}
            label={revealed ? t('hidePassword') : t('showPassword')}
            size={36}
            haptic={false}
            onPress={() => setRevealed((v) => !v)}
          />
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingStart: space.lg,
    paddingEnd: space.xs,
  },
  searchField: { minHeight: 44, paddingStart: space.md },
  disabled: { opacity: 0.6 },
  // No lineHeight on inputs: iOS then misplaces the caret and placeholder vertically.
  input: { fontSize: typeScale.field.fontSize, fontWeight: typeScale.field.fontWeight, flex: 1, minWidth: 0, paddingVertical: space.sm, paddingEnd: space.sm },
  // Emails, passwords and codes are Latin: caret, text and placeholder on the left even in Arabic.
  ltr: { writingDirection: 'ltr', textAlign: contentAlign(false) },
  code: { fontSize: 24, fontWeight: '600', letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
