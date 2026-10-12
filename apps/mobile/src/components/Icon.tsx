import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { I18nManager, Platform, StyleSheet, View, type ColorValue } from 'react-native';
import { iconSize, useColors } from '@/theme';

type Entry = {
  ios: SymbolViewProps['name'] & string;
  android: string;
  /**
   * Directional glyph that must point the other way in right-to-left layouts. iOS mirrors
   * `*.forward` / `*.backward` symbols itself; Android's Material Symbols font never does.
   */
  mirror?: true;
};

/**
 * One icon set for the whole app: SF Symbols on iOS, Material Symbols (outlined) on Android.
 * Outline everywhere so both platforms read the same; the only filled glyphs are ones whose
 * Material version is filled too (stop) and the selected check.
 */
const ICONS = {
  translate: { ios: 'character.bubble', android: 'translate' },
  camera: { ios: 'camera', android: 'photo_camera' },
  talk: { ios: 'bubble.left.and.text.bubble.right', android: 'forum' },
  file: { ios: 'doc.text', android: 'description' },
  account: { ios: 'person.crop.circle', android: 'person' },
  swap: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
  mic: { ios: 'mic', android: 'mic' },
  stop: { ios: 'stop.fill', android: 'stop' },
  speaker: { ios: 'speaker.wave.2', android: 'volume_up', mirror: true },
  copy: { ios: 'doc.on.doc', android: 'content_copy' },
  share: { ios: 'square.and.arrow.up', android: 'share' },
  close: { ios: 'xmark', android: 'close' },
  check: { ios: 'checkmark', android: 'check' },
  checkCircle: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  cloud: { ios: 'cloud', android: 'cloud' },
  cloudOff: { ios: 'icloud.slash', android: 'cloud_off' },
  /** Works on this phone (offline model). Deliberately not a bolt: that means credits. */
  device: { ios: 'iphone', android: 'smartphone' },
  download: { ios: 'arrow.down.circle', android: 'download' },
  downloaded: { ios: 'checkmark.circle', android: 'download_done' },
  trash: { ios: 'trash', android: 'delete' },
  search: { ios: 'magnifyingglass', android: 'search' },
  chevron: { ios: 'chevron.forward', android: 'chevron_right', mirror: true },
  back: { ios: 'chevron.backward', android: 'arrow_back', mirror: true },
  sparkles: { ios: 'sparkles', android: 'auto_awesome' },
  lock: { ios: 'lock', android: 'lock' },
  crown: { ios: 'crown', android: 'workspace_premium' },
  diamond: { ios: 'diamond', android: 'diamond' },
  timer: { ios: 'timer', android: 'timer' },
  bolt: { ios: 'bolt', android: 'bolt' },
  history: { ios: 'clock.arrow.circlepath', android: 'history' },
  restore: { ios: 'arrow.clockwise', android: 'restore' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh' },
  upload: { ios: 'doc.badge.plus', android: 'upload_file' },
  exportData: { ios: 'square.and.arrow.down', android: 'file_download' },
  photo: { ios: 'photo.on.rectangle', android: 'image' },
  globe: { ios: 'globe', android: 'language' },
  book: { ios: 'book.closed', android: 'menu_book' },
  logout: { ios: 'rectangle.portrait.and.arrow.forward', android: 'logout', mirror: true },
  deleteAccount: { ios: 'person.crop.circle.badge.minus', android: 'person_remove' },
  info: { ios: 'info.circle', android: 'info' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning' },
  error: { ios: 'exclamationmark.circle', android: 'error' },
  wifi: { ios: 'wifi', android: 'wifi' },
  waveform: { ios: 'waveform', android: 'graphic_eq' },
  mail: { ios: 'envelope', android: 'mail' },
  keyboardDown: { ios: 'keyboard.chevron.compact.down', android: 'keyboard_hide' },
  eye: { ios: 'eye', android: 'visibility' },
  eyeOff: { ios: 'eye.slash', android: 'visibility_off' },
} as const satisfies Record<string, Entry>;

export type IconName = keyof typeof ICONS;

const FLIP = I18nManager.isRTL && Platform.OS === 'android';

/**
 * Decorative glyph: hidden from screen readers (the control around it carries the label).
 * Sizes come from `iconSize` in the theme.
 */
export function Icon({ name, size = iconSize.md, color }: { name: IconName; size?: number; color?: ColorValue }) {
  const colors = useColors();
  const entry: Entry = ICONS[name];
  const symbol = (
    <SymbolView
      name={{ ios: entry.ios, android: entry.android } as SymbolViewProps['name']}
      size={size}
      tintColor={color ?? colors.text}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
  // On Android the glyph is a font character inside a Text, which TalkBack could focus and which
  // ignores RTL, so it gets a hidden wrapper that also mirrors directional icons.
  if (Platform.OS !== 'android') return symbol;
  return (
    <View
      style={[{ width: size, height: size }, FLIP && entry.mirror && styles.flip]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden>
      {symbol}
    </View>
  );
}

/** Platform symbol names, for native APIs that take them directly (tab bar items). */
export function iconNames<N extends IconName>(name: N): (typeof ICONS)[N] {
  return ICONS[name];
}

const styles = StyleSheet.create({
  flip: { transform: [{ scaleX: -1 }] },
});
