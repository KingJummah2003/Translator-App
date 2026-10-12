import type { TextStyle, ViewStyle } from 'react-native';

/**
 * Design tokens. "Ink on paper": warm neutral surfaces, one confident indigo accent,
 * large readable type for translations. Every colour has a light and dark value.
 *
 * Contrast (WCAG): text, textMuted, accent, success, warning and danger are >= 4.5:1 on bg,
 * surface and every *Soft tint. textFaint is >= 3:1 and is for icons, chevrons and disabled
 * labels only, never for information the user has to read.
 */
const light = {
  bg: '#F7F6F3',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEDE8',
  /** A thumb or chip that sits on a surfaceAlt track (segmented controls). */
  surfaceRaised: '#FFFFFF',
  /** Form sheets and modals, so they separate from the page behind them. */
  sheet: '#F7F6F3',
  border: '#E3E0D9',
  /** Boundaries that must stay visible: pills, text fields, switch tracks. */
  borderStrong: '#CFCBC2',
  text: '#16171A',
  textMuted: '#62666E',
  textFaint: '#767A81',
  accent: '#3346D3',
  accentSoft: '#E6E9FB',
  onAccent: '#FFFFFF',
  success: '#17784B',
  successSoft: '#E3F4EB',
  warning: '#8F5A0F',
  warningSoft: '#FBF1DE',
  danger: '#C2362F',
  dangerSoft: '#FBE9E7',
  /** Pressed-state wash laid over any surface. */
  pressed: 'rgba(22,23,26,0.08)',
  overlay: 'rgba(15,16,18,0.45)',
  /** Text and controls drawn over the camera feed or photos. */
  onMedia: '#FFFFFF',
  mediaScrim: 'rgba(0,0,0,0.6)',
};

const dark: typeof light = {
  bg: '#0F1012',
  surface: '#18191C',
  surfaceAlt: '#212327',
  surfaceRaised: '#2C2E33',
  sheet: '#18191C',
  border: '#2C2E33',
  borderStrong: '#3D4048',
  text: '#F3F2EF',
  textMuted: '#9A9EA6',
  textFaint: '#858990',
  accent: '#8C9BFF',
  accentSoft: '#262B4D',
  onAccent: '#0F1012',
  success: '#4CC38A',
  successSoft: '#17301F',
  warning: '#E0A43A',
  warningSoft: '#3A2E17',
  danger: '#FF7A70',
  dangerSoft: '#3A1E1C',
  pressed: 'rgba(243,242,239,0.10)',
  overlay: 'rgba(0,0,0,0.6)',
  onMedia: '#FFFFFF',
  mediaScrim: 'rgba(0,0,0,0.6)',
};

export const palette = { light, dark } as const;

export type Colors = { [K in keyof typeof light]: string };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** One radius per role: lg for every card, group, sheet block and plan option. */
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** The only icon sizes in the app. */
export const iconSize = { xs: 12, sm: 16, md: 20, lg: 24, xl: 40 } as const;

/** Square icon tiles (plans, files, empty states). */
export const tile = { size: 48, radius: radius.md } as const;

/** Minimum touch target (iOS 44 pt; Android reaches 48 dp through hitSlop). */
export const touch = { min: 44, android: 48 } as const;

/**
 * System fonts on purpose: they cover every script (Arabic, Devanagari, CJK, Ethiopic...).
 * letterSpacing here is for Latin interface text only; <Text> drops it for Arabic and for
 * content in another language, because tracking breaks cursive joining.
 */
export const type = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  result: { fontSize: 26, lineHeight: 36, fontWeight: '500' },
  input: { fontSize: 22, lineHeight: 30, fontWeight: '400' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  /** Regular and large buttons. */
  button: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  /** Every text field except the big translate input. */
  field: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.4 },
  /** Small section label; uppercase in Latin interfaces (see Text `caps`). */
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.6 },
} satisfies Record<string, TextStyle>;

/**
 * Arabic has no capitals and is hard to read at 11-12 px, so the small label styles step up to
 * caption size in the Arabic interface.
 */
export const arabicSmallType = { fontSize: 13, lineHeight: 18 } as const;

/**
 * Card elevation. A soft cross-platform boxShadow in light mode; dark mode separates surfaces by
 * tone and hairline border instead (shadows are invisible on near-black).
 */
export const elevation = {
  light: { boxShadow: '0px 6px 16px rgba(0, 0, 0, 0.06)' },
  dark: {},
} satisfies Record<'light' | 'dark', ViewStyle>;

/** @deprecated Use `elevation` (Card applies it). Kept for older imports. */
export const shadow: ViewStyle = elevation.light;

export const MAX_WIDTH = 720;
