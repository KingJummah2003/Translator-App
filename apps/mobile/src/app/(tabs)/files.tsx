import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { useNetworkState } from 'expo-network';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { COSTS, REQUEST_LIMITS, buildDocx, extractDocument, extractText, isRtl, pdfTextToParagraphs, totalChars, type ExtractedDocument } from '@translator/shared';
import { TranslatorNative, textRecognitionAvailable } from 'translator-native';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { LanguageBar, displayName } from '@/components/LanguageBar';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ApiError, api } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { getState, useAppState } from '@/lib/store';
import { detectLanguage, downloadModels, planRoute, refreshEntitlements, translateOffline } from '@/lib/translator';
import { radius, space, useColors } from '@/theme';

interface Picked {
  uri: string;
  name: string;
  size: number;
  type: 'txt' | 'docx' | 'pdf';
  doc: ExtractedDocument | null;
  chars: number;
  /** PDFs are delivered as Word files: the original layout can't be rewritten. */
  outputType: 'txt' | 'docx';
}

const MIME = {
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const;

export default function FilesScreen() {
  const c = useColors();
  const source = useAppState((s) => s.source);
  const target = useAppState((s) => s.target);
  useAppState((s) => s.downloadedModels);
  const { data: session } = authClient.useSession();
  const network = useNetworkState();
  const [file, setFile] = useState<Picked | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [output, setOutput] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);

  const from = source === 'auto' ? detected : source;
  const route = from ? planRoute(from, target, { signedIn: !!session, online: network.isInternetReachable !== false }) : null;
  const cloudRoute = planRoute(source, target, { signedIn: !!session, online: network.isInternetReachable !== false, preferCloud: true });

  async function pick() {
    setError(null);
    setOutput(null);
    const res = await DocumentPicker.getDocumentAsync({ type: Object.values(MIME), copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    const ext = a.name.toLowerCase().split('.').pop();
    if (ext !== 'txt' && ext !== 'docx' && ext !== 'pdf') return setError(t('filesHint'));
    if ((a.size ?? 0) > REQUEST_LIMITS.maxDocumentBytes) return setError(t('fileTooBig'));
    try {
      let doc: ExtractedDocument;
      if (ext === 'pdf') {
        if (!textRecognitionAvailable) return setError(t('pdfUnavailable'));
        // Read on the phone: the PDF itself is never uploaded.
        setProgress(0);
        const pdf = await TranslatorNative.extractPdfText(a.uri, source === 'auto' ? [] : [source], 50);
        setProgress(null);
        const paragraphs = pdfTextToParagraphs(pdf.pages);
        if (!paragraphs.length) return setError(t('pdfNoText'));
        doc = {
          segments: paragraphs.map((p) => p.text),
          rebuild: (translations, options) =>
            buildDocx(
              paragraphs.map((p, i) => ({ ...p, text: translations[i] ?? '' })),
              { rtl: options?.rtl, title: a.name },
            ),
        };
      } else {
        doc = extractDocument(ext, await new File(a.uri).bytes());
      }
      setFile({ uri: a.uri, name: a.name, size: a.size ?? 0, type: ext, doc, chars: totalChars(doc.segments), outputType: ext === 'txt' ? 'txt' : 'docx' });
      if (source === 'auto') setDetected(await detectLanguage(doc.segments.slice(0, 5).join('\n')));
    } catch (e) {
      setProgress(null);
      const code = (e as Error).message;
      setError(code.includes('LOCKED_PDF') ? t('pdfLocked') : code.includes('too large or complex') ? t('fileTooBig') : t('error'));
    }
  }

  async function translateOnDevice() {
    if (!file?.doc || !from) return;
    setError(null);
    setProgress(0);
    try {
      const out: string[] = [];
      for (let i = 0; i < file.doc.segments.length; i++) {
        out.push(await translateOffline(file.doc.segments[i]!, from, target));
        if (i % 5 === 0) setProgress(i / file.doc.segments.length);
      }
      save(file.doc.rebuild(out, { rtl: isRtl(target) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setProgress(null);
    }
  }

  async function translateInCloud() {
    if (!file?.doc) return;
    setError(null);
    setProgress(0.5);
    try {
      const form = new FormData();
      if (file.type === 'pdf') {
        // Only the extracted text is sent, as a plain-text file; the PDF stays on the phone.
        const textFile = new File(Paths.cache, 'pdf-text.txt');
        textFile.create({ overwrite: true });
        textFile.write(file.doc.segments.join('\n\n'));
        form.append('file', { uri: textFile.uri, name: 'document.txt', type: MIME.txt } as unknown as Blob);
      } else {
        form.append('file', { uri: file.uri, name: file.name, type: MIME[file.type] } as unknown as Blob);
      }
      form.append('source', source);
      form.append('target', target);
      const res = await api('/v1/documents', { method: 'POST', body: form });
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (file.type === 'pdf') {
        const translated = extractText(bytes).segments;
        save(file.doc.rebuild(translated, { rtl: isRtl(target) }));
      } else {
        save(bytes);
      }
      void refreshEntitlements();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'insufficient_credits' ? t('notEnoughCredits') : e instanceof Error ? e.message : t('error'));
    } finally {
      setProgress(null);
    }
  }

  function save(bytes: Uint8Array) {
    if (!file) return;
    const name = `${file.name.replace(/\.[^.]+$/, '')}.${target}.${file.outputType}`;
    const out = new File(Paths.cache, name);
    out.create({ overwrite: true });
    out.write(bytes);
    setOutput(out);
  }

  const busy = progress !== null;
  const cost = file ? COSTS.translateDocument(file.chars) : 0;
  const balance = getState().entitlements?.balance ?? 0;

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="display">{t('filesTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('filesHint')}
        </Text>
      </View>

      <LanguageBar detected={detected} />

      <Card style={styles.drop}>
        <View style={[styles.fileIcon, { backgroundColor: c.accentSoft }]}>
          <Icon name={file ? 'file' : 'upload'} size={28} color={c.accent} />
        </View>
        {file ? (
          <View style={styles.center}>
            <Text variant="heading" align="center" numberOfLines={2}>
              {file.name}
            </Text>
            <Text variant="caption" tone="muted">
              {(file.size / 1024).toFixed(0)} KB{file.chars ? ` · ${file.chars.toLocaleString()} characters` : ''}
            </Text>
          </View>
        ) : null}
        <Button title={t('chooseFile')} kind={file ? 'secondary' : 'primary'} icon="upload" onPress={() => void pick()} disabled={busy} />
      </Card>

      {error && <Banner icon="warning" tone="danger" message={error} action={error === t('notEnoughCredits') ? t('getCredits') : undefined} onAction={() => router.push('/plans')} />}

      {file?.doc && !output && (
        <View style={styles.actions}>
          {route?.kind === 'offline' && (
            <Button title={t('translateOnDevice')} icon="device" onPress={() => void translateOnDevice()} loading={busy && progress !== 0.5} />
          )}
          {route?.kind === 'download' && (
            <Banner
              icon="download"
              message={t('downloadToUseOffline', { lang: route.missing.map(displayName).join(', ') })}
              action={t('download')}
              onAction={() => void downloadModels(route.missing).catch((e: Error) => setError(e.message))}
            />
          )}
          {cloudRoute.kind === 'cloud' ? (
            <Button
              title={`${t('translateInCloud')} · ${t('fileCost', { credits: cost })}`}
              icon="cloud"
              kind={route?.kind === 'offline' ? 'secondary' : 'primary'}
              disabled={busy || cost > balance}
              onPress={() => void translateInCloud()}
            />
          ) : cloudRoute.kind === 'sign-in' ? (
            <Banner icon="cloud" message={t('signInForCloud', { lang: displayName(target) })} action={t('signIn')} onAction={() => router.push('/sign-in')} />
          ) : null}
          {cloudRoute.kind === 'cloud' && cost > balance && (
            <Banner icon="bolt" tone="warning" message={t('notEnoughCredits')} action={t('getCredits')} onAction={() => router.push('/plans')} />
          )}
          {busy && progress !== null && progress !== 0.5 && (
            <View style={[styles.track, { backgroundColor: c.surfaceAlt }]}>
              <View style={[styles.bar, { width: `${Math.round(progress * 100)}%`, backgroundColor: c.accent }]} />
            </View>
          )}
        </View>
      )}

      {output && (
        <Card tone="accent" style={styles.done}>
          <Icon name="checkCircle" size={32} color={c.success} />
          <Text variant="heading" align="center">
            {t('fileTranslated')}
          </Text>
          <Text variant="caption" tone="muted" align="center">
            {output.name}
          </Text>
          <Button
            title={t('saveOrShare')}
            icon="share"
            onPress={() => void Sharing.shareAsync(output.uri, { mimeType: MIME[file!.outputType], dialogTitle: output.name })}
          />
          <Button title={t('chooseFile')} kind="ghost" onPress={() => void pick()} />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: space.md, paddingBottom: space.lg, gap: space.sm },
  drop: { marginTop: space.lg, alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  fileIcon: { width: 64, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', gap: 2 },
  actions: { gap: space.md, marginTop: space.lg },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6 },
  done: { marginTop: space.lg, alignItems: 'center', gap: space.md },
});
