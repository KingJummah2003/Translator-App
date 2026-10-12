import type { ReactNode, Ref } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { MAX_WIDTH, space, useColors, useTabBarInset } from '@/theme';
import { useTabFade } from './motion';

const IOS = Platform.OS === 'ios';

/**
 * Page wrapper: background, safe areas, readable max width on tablets, optional scroll, keyboard
 * avoidance, and one vertical rhythm: children are spaced by `gap` (no ad-hoc margins).
 * Start the page with <ScreenHeader> (tab pages) or <ModalHeader> (modals and sheets).
 *
 * Bottom clearance: a screen without the 'bottom' edge (every tab root) is padded with
 * useTabBarInset(), so the last item clears the tab bar on both platforms.
 */
export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  padded = true,
  gap = space.lg,
  tab = false,
  sheet = false,
  scrollRef,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  padded?: boolean;
  /** Space between the page's direct children. */
  gap?: number;
  /** Tab root: content fades through when the user switches tabs. */
  tab?: boolean;
  /** Modal or form sheet: uses the sheet background so it separates from the page behind. */
  sheet?: boolean;
  /** The page ScrollView, e.g. to scroll a new result into view above the keyboard. */
  scrollRef?: Ref<ScrollView>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const tabInset = useTabBarInset({ scroll });
  const paddingBottom = edges.includes('bottom') ? space.xl : tabInset;
  const column = [styles.inner, padded && styles.padded, { gap, paddingBottom }, contentStyle];
  const inner = tab ? <TabFade style={column}>{children}</TabFade> : <View style={column}>{children}</View>;

  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: sheet ? c.sheet : c.bg }]}>
      {/* iOS scroll views move above the keyboard natively (automaticallyAdjustKeyboardInsets),
          which also works inside modal sheets where KeyboardAvoidingView mis-measures. Android
          is edge-to-edge, so the window no longer resizes and the padding has to be added. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding" enabled={!(IOS && scroll)}>
        {scroll ? (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={IOS ? 'interactive' : 'on-drag'}
            contentInsetAdjustmentBehavior="automatic"
            automaticallyAdjustKeyboardInsets>
            {inner}
          </ScrollView>
        ) : (
          inner
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TabFade({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  const fade = useTabFade();
  return <Animated.View style={[style, fade]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center' },
  inner: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  padded: { paddingHorizontal: space.lg },
});
