import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COSTS, getLanguage } from '@translator/shared';
import { TranslatorNative, textRecognitionAvailable } from 'translator-native';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { LanguageBar, displayName } from '@/components/LanguageBar';
import { TappableText } from '@/components/TappableText';
import { Text } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { useAppState } from '@/lib/store';
import { cloudOcr, planRoute, translateText } from '@/lib/translator';
import { radius, space, useColors } from '@/theme';

interface Result {
  text: string;
  translation: string | null;
  engine: 'offline' | 'cloud';
}

/** Whether the phone itself can read text written in this language. */
function onDeviceOcr(source: string): boolean {
  if (!textRecognitionAvailable) return false;
  if (Platform.OS === 'ios') {
    if (source === 'auto') return true;
    const supported = TranslatorNative.supportedRecognitionLanguages();
    return supported.some((l) => l === source || l.startsWith(`${source}-`));
  }
  return source === 'auto' || getLanguage(source)?.ocr !== undefined;
}

export default function CameraScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const source = useAppState((s) => s.source);
  const target = useAppState((s) => s.target);
  const { data: session } = authClient.useSession();

  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPhoto(null);
    setResult(null);
    setError(null);
  };

  async function process(uri: string, forceCloud = false) {
    setPhoto(uri);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (!forceCloud && onDeviceOcr(source)) {
        const recognized = await TranslatorNative.recognizeText(uri, source === 'auto' ? [] : [source]);
        if (recognized.text.trim()) {
          const route = planRoute(source, target, { signedIn: !!session, online: true });
          let translation: string | null = null;
          let engine: Result['engine'] = 'offline';
          if (route.kind === 'offline' || route.kind === 'cloud') {
            const r = await translateText(recognized.text, source, target, { engine: route.kind });
            translation = r.text;
            engine = r.engine;
          }
          setResult({ text: recognized.text, translation, engine });
          return;
        }
        if (!session) {
          setError(t('noTextFound'));
          return;
        }
      }
      if (!session) {
        setError(t('signInForCloud', { lang: displayName(source === 'auto' ? target : source) }));
        return;
      }
      // Cloud OCR: shrink the photo first (faster, cheaper, less data leaves the phone).
      const image = await ImageManipulator.manipulate(uri).resize({ width: 1600 }).renderAsync();
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
      const res = await cloudOcr(saved.base64 ?? '', target);
      if (!res.text.trim()) setError(t('noTextFound'));
      else setResult({ text: res.text, translation: res.translation, engine: 'cloud' });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'insufficient_credits') setError(t('notEnoughCredits'));
      else setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  }

  async function capture() {
    const pic = await camera.current?.takePictureAsync({ quality: 0.85, shutterSound: false });
    if (pic?.uri) void process(pic.uri);
  }

  async function pick() {
    const res = await DocumentPicker.getDocumentAsync({ type: ['image/*'], copyToCacheDirectory: true });
    if (!res.canceled && res.assets[0]) void process(res.assets[0].uri);
  }

  if (!permission) return <View style={{ flex: 1, backgroundColor: c.bg }} />;

  if (!photo && !permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg, paddingTop: insets.top }]}>
        <Text variant="title" align="center">
          {t('cameraTitle')}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {t('cameraPermission')}
        </Text>
        <Button
          title={permission.canAskAgain ? t('allow') : t('openSettings')}
          onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())}
        />
        <Button title={t('pickPhoto')} kind="ghost" icon="photo" onPress={() => void pick()} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      {!photo ? (
        <View style={styles.flex}>
          {focused && <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />}
          <View style={[styles.overlayTop, { paddingTop: insets.top + space.sm }]}>
            <LanguageBar />
            <Text variant="caption" style={styles.hint} align="center">
              {t('cameraHint')}
            </Text>
          </View>
          <View style={[styles.controls, { paddingBottom: insets.bottom + 90 }]}>
            <Button title={t('pickPhoto')} kind="secondary" icon="photo" compact onPress={() => void pick()} />
            <Pressable accessibilityRole="button" accessibilityLabel={t('capture')} onPress={() => void capture()} style={styles.shutterOuter}>
              <View style={styles.shutterInner} />
            </Pressable>
            <View style={styles.spacer} />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.review, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + 120 }]}>
          <LanguageBar />
          <Image source={{ uri: photo }} style={[styles.photo, { backgroundColor: c.surfaceAlt }]} contentFit="cover" />
          {busy && <Banner icon="waveform" message={t('readingText')} />}
          {error && (
            <Banner
              icon="warning"
              tone="danger"
              message={error}
              action={error === t('notEnoughCredits') ? t('getCredits') : !session ? t('signIn') : undefined}
              onAction={() => router.push(error === t('notEnoughCredits') ? '/plans' : '/sign-in')}
            />
          )}
          {result && (
            <>
              {result.translation && (
                <Card tone="accent" style={styles.card}>
                  <Text variant="micro" tone="accent">
                    {t('translation').toUpperCase()} · {displayName(target).toUpperCase()}
                  </Text>
                  <TappableText text={result.translation} lang={target} variant="heading" onWord={(word) => router.push({ pathname: '/word', params: { word, lang: target } })} />
                </Card>
              )}
              <Card style={styles.card}>
                <Text variant="micro" tone="muted">
                  {t('original').toUpperCase()}
                </Text>
                <Text variant="body" language={source === 'auto' ? null : source} selectable>
                  {result.text}
                </Text>
              </Card>
              {result.engine === 'offline' && session && (
                <Button
                  title={`${t('betterQuality')} · ${t('betterQualityHint', { credits: COSTS.ocrImage() })}`}
                  icon="sparkles"
                  kind="ghost"
                  onPress={() => void process(photo, true)}
                />
              )}
            </>
          )}
          <Button title={t('retake')} icon="camera" kind="secondary" onPress={reset} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xxl },
  overlayTop: { position: 'absolute', top: 0, start: 0, end: 0, paddingHorizontal: space.lg, gap: space.sm },
  hint: { color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  controls: { position: 'absolute', bottom: 0, start: 0, end: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl },
  shutterOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  spacer: { width: 110 },
  review: { paddingHorizontal: space.lg, gap: space.lg },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg },
  card: { gap: space.sm },
});
