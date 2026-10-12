import { Platform, useColorScheme, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevation, palette, space, type Colors } from './tokens';

export * from './tokens';

export function useColors(): Colors {
  return palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}

/** Card elevation for the current colour scheme (a soft shadow in light mode, none in dark). */
export function useElevation(): ViewStyle {
  return elevation[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

/**
 * Bottom clearance for content on a tab screen, so nothing sits under the tab bar. The only
 * source of that number in the app.
 *
 * - Android: NativeTabs already ends the tab content above the bar (it wraps every tab in a
 *   bottom-edge SafeAreaView), so only breathing room is added.
 * - iOS: the bar floats over the content. Each tab gets its own SafeAreaProvider whose bottom
 *   inset includes the bar, so a plain view adds that inset. A scroll view whose
 *   contentInsetAdjustmentBehavior is 'automatic' (Screen's, and the first scroll view of every
 *   tab) is already inset by UIKit: pass `{ scroll: true }` so it is not counted twice.
 */
export function useTabBarInset({ scroll = false }: { scroll?: boolean } = {}): number {
  const { bottom } = useSafeAreaInsets();
  if (Platform.OS === 'ios' && !scroll) return bottom + space.lg;
  return space.xl;
}
