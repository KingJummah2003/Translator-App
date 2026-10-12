import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform } from 'react-native';
import { iconNames } from '@/components/Icon';
import { t } from '@/lib/i18n';
import { useColors } from '@/theme';

const ANDROID = Platform.OS === 'android';

export default function TabsLayout() {
  const c = useColors();
  const tab = (name: string, label: string, icon: Parameters<typeof iconNames>[0]) => {
    const i = iconNames(icon);
    return (
      // A themed tab background, so a tab that is still mounting never flashes white or black.
      <NativeTabs.Trigger name={name} contentStyle={{ backgroundColor: c.bg }}>
        <NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={i.ios} md={i.android} />
      </NativeTabs.Trigger>
    );
  };
  return (
    <NativeTabs
      backgroundColor={c.bg}
      tintColor={c.accent}
      // Android: every tab keeps its label, as on iOS (Material shows only the selected one by
      // default), and items use the app's colours instead of Material You's wallpaper colours.
      // iOS keeps its system colour for unselected items, which adapts to the glass tab bar.
      labelVisibilityMode="labeled"
      iconColor={ANDROID ? { default: c.textMuted, selected: c.accent } : undefined}
      labelStyle={ANDROID ? { default: { color: c.textMuted }, selected: { color: c.accent } } : { selected: { color: c.accent } }}
      indicatorColor={c.accentSoft}
      rippleColor={c.pressed}>
      {tab('index', t('tabTranslate'), 'translate')}
      {tab('camera', t('tabCamera'), 'camera')}
      {tab('talk', t('tabTalk'), 'talk')}
      {tab('files', t('tabFiles'), 'file')}
      {tab('account', t('tabAccount'), 'account')}
    </NativeTabs>
  );
}
