import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';
import { useColors } from '@/theme';

/** One icon set for the whole app: SF Symbols on iOS, Material Symbols on Android. */
const ICONS = {
  translate: { ios: 'character.bubble', android: 'translate' },
  camera: { ios: 'camera', android: 'photo_camera' },
  talk: { ios: 'bubble.left.and.text.bubble.right', android: 'forum' },
  file: { ios: 'doc.text', android: 'description' },
  account: { ios: 'person.crop.circle', android: 'person' },
  swap: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
  mic: { ios: 'mic.fill', android: 'mic' },
  stop: { ios: 'stop.fill', android: 'stop' },
  speaker: { ios: 'speaker.wave.2.fill', android: 'volume_up' },
  copy: { ios: 'doc.on.doc', android: 'content_copy' },
  share: { ios: 'square.and.arrow.up', android: 'share' },
  close: { ios: 'xmark', android: 'close' },
  check: { ios: 'checkmark', android: 'check' },
  checkCircle: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  cloud: { ios: 'cloud', android: 'cloud' },
  device: { ios: 'iphone', android: 'offline_bolt' },
  download: { ios: 'arrow.down.circle', android: 'download' },
  downloaded: { ios: 'checkmark.circle', android: 'download_done' },
  trash: { ios: 'trash', android: 'delete' },
  search: { ios: 'magnifyingglass', android: 'search' },
  chevron: { ios: 'chevron.forward', android: 'chevron_right' },
  sparkles: { ios: 'sparkles', android: 'auto_awesome' },
  lock: { ios: 'lock.fill', android: 'lock' },
  crown: { ios: 'crown.fill', android: 'workspace_premium' },
  diamond: { ios: 'diamond.fill', android: 'diamond' },
  timer: { ios: 'timer', android: 'timer' },
  bolt: { ios: 'bolt.fill', android: 'bolt' },
  history: { ios: 'clock.arrow.circlepath', android: 'history' },
  upload: { ios: 'doc.badge.plus', android: 'upload_file' },
  photo: { ios: 'photo.on.rectangle', android: 'image' },
  globe: { ios: 'globe', android: 'language' },
  book: { ios: 'book.closed', android: 'menu_book' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' },
  info: { ios: 'info.circle', android: 'info' },
  warning: { ios: 'exclamationmark.triangle.fill', android: 'warning' },
  wifi: { ios: 'wifi', android: 'wifi' },
  waveform: { ios: 'waveform', android: 'graphic_eq' },
} as const satisfies Record<string, { ios: SymbolViewProps['name'] & string; android: string }>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: ColorValue }) {
  const colors = useColors();
  return <SymbolView name={ICONS[name] as SymbolViewProps['name']} size={size} tintColor={color ?? colors.text} />;
}

export function iconNames(name: IconName) {
  return ICONS[name];
}
