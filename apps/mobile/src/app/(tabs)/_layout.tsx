import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { iconNames } from '@/components/Icon';
import { t } from '@/lib/i18n';
import { useColors } from '@/theme';

export default function TabsLayout() {
  const c = useColors();
  const tab = (name: string, label: string, icon: Parameters<typeof iconNames>[0]) => {
    const i = iconNames(icon);
    return (
      <NativeTabs.Trigger name={name}>
        <NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={i.ios} md={i.android} />
      </NativeTabs.Trigger>
    );
  };
  return (
    <NativeTabs backgroundColor={c.bg} indicatorColor={c.accentSoft} tintColor={c.accent} labelStyle={{ selected: { color: c.accent } }}>
      {tab('index', t('tabTranslate'), 'translate')}
      {tab('camera', t('tabCamera'), 'camera')}
      {tab('talk', t('tabTalk'), 'talk')}
      {tab('files', t('tabFiles'), 'file')}
      {tab('account', t('tabAccount'), 'account')}
    </NativeTabs>
  );
}
