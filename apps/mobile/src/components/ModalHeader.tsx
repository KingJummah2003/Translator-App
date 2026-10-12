import { Platform, StyleSheet, View } from 'react-native';
import { t } from '@/lib/i18n';
import { dismiss } from '@/lib/nav';
import { space, touch, useColors } from '@/theme';
import { IconButton } from './Button';
import { Text } from './Text';

/**
 * The top of every modal and form sheet: title (a screen-reader heading) on the start side and
 * a 44 pt close button on the end side. Sheets also get a grabber on Android, where the native
 * sheet has none (iOS draws its own via sheetGrabberVisible).
 */
export function ModalHeader({
  title,
  subtitle,
  onClose = dismiss,
  sheet = false,
}: {
  /** May be empty when the page opens with its own hero (plans). */
  title?: string;
  subtitle?: string;
  /** Defaults to closing the modal (nav.dismiss). */
  onClose?: () => void;
  sheet?: boolean;
}) {
  const c = useColors();
  return (
    <View style={[styles.wrap, sheet && Platform.OS !== 'android' && styles.sheetTop]}>
      {sheet && Platform.OS === 'android' ? <View style={[styles.grabber, { backgroundColor: c.borderStrong }]} /> : null}
      <View style={styles.row}>
        <View style={styles.texts}>
          {title ? (
            <Text variant="title" heading>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text variant="body" tone="muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        <IconButton icon="close" label={t('close')} onPress={onClose} size={touch.min} haptic={false} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, paddingTop: space.sm },
  sheetTop: { paddingTop: space.lg },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  texts: { flex: 1, minWidth: 0, gap: space.xs, justifyContent: 'center', minHeight: touch.min },
});
