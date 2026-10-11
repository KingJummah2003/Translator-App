import { useColorScheme } from 'react-native';
import { palette, type Colors } from './tokens';

export * from './tokens';

export function useColors(): Colors {
  return palette[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}
