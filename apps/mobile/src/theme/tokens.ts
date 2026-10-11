import { Platform } from 'react-native';

/**
 * Design tokens. "Ink on paper": warm neutral surfaces, one confident indigo accent,
 * large readable type for translations. Every colour has a light and dark value.
 */
export const palette = {
  light: {
    bg: '#F7F6F3',
    surface: '#FFFFFF',
    surfaceAlt: '#EFEDE8',
    border: '#E3E0D9',
    text: '#16171A',
    textMuted: '#6A6E76',
    textFaint: '#9A9DA3',
    accent: '#3346D3',
    accentSoft: '#E6E9FB',
    onAccent: '#FFFFFF',
    success: '#1E8E5A',
    warning: '#A86A12',
    danger: '#C2362F',
    dangerSoft: '#FBE9E7',
    overlay: 'rgba(15,16,18,0.45)',
  },
  dark: {
    bg: '#0F1012',
    surface: '#18191C',
    surfaceAlt: '#212327',
    border: '#2C2E33',
    text: '#F3F2EF',
    textMuted: '#9A9EA6',
    textFaint: '#6B6F76',
    accent: '#8C9BFF',
    accentSoft: '#262B4D',
    onAccent: '#0F1012',
    success: '#4CC38A',
    warning: '#E0A43A',
    danger: '#FF7A70',
    dangerSoft: '#3A1E1C',
    overlay: 'rgba(0,0,0,0.6)',
  },
} as const;

export type Colors = { [K in keyof (typeof palette)['light']]: string };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** System fonts on purpose: they cover every script (Arabic, Devanagari, CJK, Ethiopic...). */
export const type = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.2 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  result: { fontSize: 26, lineHeight: 36, fontWeight: '500' as const },
  input: { fontSize: 22, lineHeight: 30, fontWeight: '400' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 17, fontWeight: '400' as const },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.4 },
};

export const shadow = Platform.select({
  ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  default: { elevation: 2 },
});

export const MAX_WIDTH = 720;
