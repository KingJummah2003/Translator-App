import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useNetworkState } from 'expo-network';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  COSTS,
  REQUEST_LIMITS,
  buildDocx,
  extractDocument,
  extractText,
  isRtl,
  pdfTextToParagraphs,
  totalChars,
  type ExtractedDocument,
} from '@translator/shared';
import { TranslatorNative, textRecognitionAvailable } from 'translator-native';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { LanguageBar, displayName } from '@/components/LanguageBar';
import { ProgressBar, enterFade, enterUp, exitFade, layoutTransition } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { announce } from '@/lib/a11y';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { errorActionLabel, errorCode, toAppError, type AppError, type ErrorAction, type ErrorCode } from '@/lib/errors';
import { formatFileSize, formatList, formatPercent, t, tn, type StringKey } from '@/lib/i18n';
import { useAppState } from '@/lib/store';
import {
  detectLanguage,
  downloadModels,
  needsCareWarning,
  offlineCapable,
  planRoute,
  refreshEntitlements,
  translateSegmentsOffline,
  type Engine,
} from '@/lib/translator';
import { iconSize, space, tile, useColors } from '@/theme';

type DocType = 'txt' | 'docx' | 'pdf';
type OutputType = 'txt' | 'docx';
/** What the screen is busy with; one thing at a time (pick, read, translate). */
type Phase = 'picking' | 'reading' | 'device' | 'cloud';

interface Picked {
  uri: string;
  name: string;
  size: number;
  type: DocType;
  /** Null while the file is being read. */
  doc: ExtractedDocument | null;
  chars: number;
  /** Language found on the phone (used when the source is "Detect language"). */
  detected: string | null;
  /** Medical, legal or safety wording: machine translation needs a human check. */
  care: boolean;
  /** A PDF longer than MAX_PDF_PAGES: only the first pages were read. */
  pagesLimited: boolean;
  /** PDFs are delivered as Word files: the original layout can't be rewritten. */
  outputType: OutputType;
}

interface Output {
  uri: string;
  name: string;
  type: OutputType;
  engine: Engine;
  /** The languages it was translated with; a different pair shows the translate options again. */
  source: string;
  target: string;
}

const MIME = {
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const;

const UTI: Record<OutputType, string> = {
  txt: 'public.plain-text',
  docx: 'org.openxmlformats.wordprocessingml.document',
};

const MAX_PDF_PAGES = 50;
/** The care scan reads up to 10,000 characters per call, so long documents are scanned in chunks. */
const CARE_CHUNK_CHARS = 8000;
const CARE_MAX_CHARS = 120_000;
const DETECT_SAMPLE_CHARS = 1000;

/** Error actions this screen can carry out (others are not offered). */
const HANDLED_ACTIONS: ReadonlySet<ErrorAction> = new Set<ErrorAction>(['getCredits', 'signIn', 'download', 'chooseLanguage']);

/** A problem found by this screen itself, shown with its own string. */
class FileNotice extends Error {
  constructor(
    readonly key: StringKey,
    readonly code: ErrorCode = 'bad_document',
  ) {
    super(key);
    this.name = 'FileNotice';
  }
}

function noticeFor(e: unknown): AppError | null {
  if (e instanceof FileNotice) return { code: e.code, message: t(e.key) };
  const err = toAppError(e);
  // Cancellations (an aborted translation) have no message: show nothing.
  return err.message ? err : null;
}

function docType(name: string): DocType | null {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'txt' || ext === 'docx' || ext === 'pdf' ? ext : null;
}

async function readDocument(uri: string, name: string, type: DocType, source: string): Promise<{ doc: ExtractedDocument; pagesLimited: boolean }> {
  if (type !== 'pdf') {
    let doc: ExtractedDocument;
    try {
      doc = extractDocument(type, await new File(uri).bytes());
    } catch (e) {
      // Unzip and XML failures have no code of their own: they mean the file is not readable.
      throw errorCode(e) === 'unknown' ? new FileNotice('errorBadDocument') : e;
    }
    if (!doc.segments.length) throw new FileNotice('documentEmpty');
    return { doc, pagesLimited: false };
  }

  // Read on the phone: the PDF itself is never uploaded.
  let pdf;
  try {
    pdf = await TranslatorNative.extractPdfText(uri, source === 'auto' ? [] : [source], MAX_PDF_PAGES);
  } catch (e) {
    throw errorCode(e) === 'unknown' ? new FileNotice('errorBadPdf', 'bad_pdf') : e;
  }
  const paragraphs = pdfTextToParagraphs(pdf.pages);
  if (!paragraphs.length) throw new FileNotice('pdfNoText', 'bad_pdf');
  return {
    doc: {
      segments: paragraphs.map((p) => p.text),
      rebuild: (translations, options) =>
        buildDocx(
          paragraphs.map((p, i) => ({ ...p, text: translations[i] ?? '' })),
          { rtl: options?.rtl, title: name },
        ),
    },
    pagesLimited: pdf.pageCount > MAX_PDF_PAGES,
  };
}

function sampleOf(segments: readonly string[]): string {
  let text = '';
  for (const s of segments) {
    if (text.length >= DETECT_SAMPLE_CHARS) break;
    text += `${s}\n`;
  }
  return text.slice(0, DETECT_SAMPLE_CHARS);
}

function documentNeedsCare(segments: readonly string[]): boolean {
  let chunk = '';
  let scanned = 0;
  for (const s of segments) {
    chunk += `${s}\n`;
    if (chunk.length < CARE_CHUNK_CHARS) continue;
    if (needsCareWarning(chunk)) return true;
    scanned += chunk.length;
    chunk = '';
    if (scanned >= CARE_MAX_CHARS) return false;
  }
  return chunk ? needsCareWarning(chunk) : false;
}

function fileMeta(f: Picked): string {
  return [f.size > 0 ? formatFileSize(f.size) : null, f.doc ? tn('characterCount', f.chars) : null].filter(Boolean).join(' · ');
}

export default function FilesScreen() {
  const source = useAppState((s) => s.source);
  const target = useAppState((s) => s.target);
  const downloaded = useAppState((s) => s.downloadedModels);
  const downloading = useAppState((s) => s.downloading);
  const entitlements = useAppState((s) => s.entitlements);
  const { data: session } = authClient.useSession();
  const network = useNetworkState();
  const [file, setFile] = useState<Picked | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  // State updates land a frame later, so a quick second tap is stopped here (credits are at stake).
  const running = useRef(false);
  const sharing = useRef(false);
  const abort = useRef<AbortController | null>(null);

  const busy = phase !== null;
  const doc = file?.doc ?? null;
  // downloadedModels rides along in ctx so the routes are recomputed after a download:
  // planRoute reads the models from the store, not from its arguments.
  const ctx = { signedIn: !!session, online: network.isInternetReachable !== false, models: downloaded };
  const from = source === 'auto' ? (file?.detected ?? null) : source;
  const route = doc && from ? planRoute(from, target, ctx) : null;
  const cloudRoute = planRoute(source, target, { ...ctx, preferCloud: true });
  const cost = file ? COSTS.translateDocument(file.chars) : 0;
  const costText = t('fileCost', { credits: cost });
  const cloudOffered = cloudRoute.kind === 'cloud';
  const planMax = entitlements ? REQUEST_LIMITS.maxDocumentChars[entitlements.tier] : null;
  const tooLong = cloudOffered && !!file && planMax !== null && file.chars > planMax;
  const short = cloudOffered && !tooLong && !!entitlements && cost > entitlements.balance;
  const cloudReady = cloudOffered && !tooLong && !short;
  const deviceReady = route?.kind === 'offline';
  const result = output && output.source === source && output.target === target ? output : null;
  const missing = route?.kind === 'download' ? route.missing : [];

  async function run(next: Phase, work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setPhase(next);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(noticeFor(e));
    }
    running.current = false;
    abort.current = null;
    setPhase(null);
    setProgress(null);
  }

  function pick() {
    void run('picking', async () => {
      const res = await DocumentPicker.getDocumentAsync({ type: Object.values(MIME), copyToCacheDirectory: true, multiple: false });
      const asset = res.canceled ? undefined : res.assets[0];
      if (!asset) return;
      const type = docType(asset.name);
      if (!type) throw new FileNotice('unsupportedFileType');
      if ((asset.size ?? 0) > REQUEST_LIMITS.maxDocumentBytes) throw new FileNotice('fileTooBig', 'too_large');
      if (type === 'pdf' && !textRecognitionAvailable) throw new FileNotice('pdfUnavailable', 'ocr_unavailable');

      const base = { uri: asset.uri, name: asset.name, size: asset.size ?? 0, type, outputType: type === 'txt' ? 'txt' : 'docx' } as const;
      setOutput(null);
      setFile({ ...base, doc: null, chars: 0, detected: null, care: false, pagesLimited: false });
      setPhase('reading');
      try {
        const read = await readDocument(base.uri, base.name, type, source);
        const picked: Picked = {
          ...base,
          doc: read.doc,
          chars: totalChars(read.doc.segments),
          // Always detected (it is quick), so switching the source to "Detect language" later just works.
          detected: await detectLanguage(sampleOf(read.doc.segments)),
          care: documentNeedsCare(read.doc.segments),
          pagesLimited: read.pagesLimited,
        };
        setFile(picked);
        announce(`${picked.name}, ${fileMeta(picked)}`);
      } catch (e) {
        setFile(null);
        throw e;
      }
    });
  }

  function save(picked: Picked, bytes: Uint8Array, engine: Engine, langs: { source: string; target: string }) {
    const name = `${picked.name.replace(/\.[^.]+$/, '')}.${langs.target}.${picked.outputType}`;
    const out = new File(Paths.cache, name);
    out.create({ overwrite: true });
    out.write(bytes);
    setOutput({ uri: out.uri, name, type: picked.outputType, engine, source: langs.source, target: langs.target });
    announce(t('fileTranslated'));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  function translateOnDevice() {
    if (!file?.doc || !from) return;
    const picked = file;
    const extracted = file.doc;
    const langs = { source, target, from };
    void run('device', async () => {
      const controller = new AbortController();
      abort.current = controller;
      setProgress(0);
      announce(t('translating'));
      const out = await translateSegmentsOffline(extracted.segments, langs.from, langs.target, {
        onProgress: setProgress,
        signal: controller.signal,
      });
      save(picked, extracted.rebuild(out, { rtl: isRtl(langs.target) }), 'offline', langs);
    });
  }

  function translateInCloud() {
    if (!file?.doc || !cloudReady) return;
    const picked = file;
    const extracted = file.doc;
    const langs = { source, target };
    void run('cloud', async () => {
      announce(t('translating'));
      const form = new FormData();
      if (picked.type === 'pdf') {
        // Only the extracted text is sent, as a plain-text file; the PDF stays on the phone.
        const textFile = new File(Paths.cache, 'pdf-text.txt');
        textFile.create({ overwrite: true });
        textFile.write(extracted.segments.join('\n\n'));
        form.append('file', { uri: textFile.uri, name: 'document.txt', type: MIME.txt } as unknown as Blob);
      } else {
        form.append('file', { uri: picked.uri, name: picked.name, type: MIME[picked.type] } as unknown as Blob);
      }
      form.append('source', langs.source);
      form.append('target', langs.target);
      const res = await api('/v1/documents', { method: 'POST', body: form });
      const bytes = new Uint8Array(await res.arrayBuffer());
      const translated = picked.type === 'pdf' ? extracted.rebuild(extractText(bytes).segments, { rtl: isRtl(langs.target) }) : bytes;
      save(picked, translated, 'cloud', langs);
      void refreshEntitlements();
    });
  }

  function cancel() {
    abort.current?.abort();
  }

  function share(out: Output) {
    if (sharing.current) return;
    sharing.current = true;
    Sharing.shareAsync(out.uri, { mimeType: MIME[out.type], UTI: UTI[out.type], dialogTitle: out.name })
      .catch((e: unknown) => setError(noticeFor(e)))
      .then(() => {
        sharing.current = false;
      });
  }

  function download(languages: string[]) {
    setError(null);
    downloadModels(languages).catch((e: unknown) => setError(noticeFor(e)));
  }

  function chooseSource() {
    router.push({ pathname: '/languages', params: { side: 'source', allowAuto: '0' } });
  }

  function onErrorAction(err: AppError) {
    if (err.action === 'getCredits') router.push('/plans');
    else if (err.action === 'signIn') router.push('/sign-in');
    else if (err.action === 'chooseLanguage') chooseSource();
    else if (err.action === 'download') download(err.languages?.length ? err.languages : missing);
  }

  const errorAction = error?.action && HANDLED_ACTIONS.has(error.action) ? error.action : undefined;
  const pending = !!doc && !result;

  const notices = [
    error ? (
      <Banner
        key="error"
        tone="danger"
        message={error.message}
        action={errorAction ? errorActionLabel(errorAction) : undefined}
        onAction={errorAction ? () => onErrorAction(error) : undefined}
        loading={errorAction === 'download' && missing.some((l) => l in downloading)}
        onDismiss={() => setError(null)}
      />
    ) : null,
    file?.care ? <Banner key="care" tone="warning" icon="warning" message={t('medicalWarning')} /> : null,
    file?.pagesLimited ? <Banner key="pages" tone="info" icon="file" message={t('pdfPagesLimited', { count: MAX_PDF_PAGES })} /> : null,
    // Choosing the language by hand only helps when the target can be translated on the phone.
    pending && source === 'auto' && !file?.detected && !cloudReady && offlineCapable(target) ? (
      <Banner key="detect" tone="info" message={t('detectFailed')} action={t('chooseLanguage')} onAction={chooseSource} />
    ) : null,
    pending && missing.length ? (
      <Banner
        key="download"
        icon="download"
        message={t('downloadToUseOffline', { lang: formatList(missing.map(displayName)) })}
        action={t('download')}
        onAction={() => download(missing)}
        loading={missing.some((l) => l in downloading)}
      />
    ) : null,
    pending && route?.kind === 'no-connection' ? (
      <Banner
        key="offline"
        tone="warning"
        icon="cloudOff"
        message={t('needsInternet', { lang: displayName(offlineCapable(target) ? from : target) })}
      />
    ) : null,
    pending && cloudRoute.kind === 'sign-in' ? (
      <Banner
        key="sign-in"
        icon="cloud"
        message={t('signInForCloud', { lang: displayName(target) })}
        action={t('signIn')}
        onAction={() => router.push('/sign-in')}
      />
    ) : null,
    pending && tooLong && planMax !== null ? (
      <Banner
        key="too-long"
        tone="warning"
        message={t('documentTooLongForPlan', { max: planMax })}
        action={entitlements?.tier === 'vip' ? undefined : t('upgrade')}
        onAction={() => router.push('/plans')}
      />
    ) : null,
    pending && short ? (
      <Banner key="credits" tone="warning" icon="bolt" message={t('notEnoughCredits')} action={t('getCredits')} onAction={() => router.push('/plans')} />
    ) : null,
  ].filter(Boolean);

  // The recommended option comes first: cloud when it can run (on-device document quality is basic).
  const cloudFirst = cloudReady || !deviceReady;
  const cloudOption = cloudOffered ? (
    <View key="cloud" style={styles.option}>
      <Button
        title={t('translateInCloud')}
        icon="cloud"
        kind={cloudFirst ? 'primary' : 'secondary'}
        size={cloudFirst ? 'large' : 'regular'}
        onPress={translateInCloud}
        loading={phase === 'cloud'}
        disabled={!cloudReady || (busy && phase !== 'cloud')}
        accessibilityHint={short ? t('notEnoughCredits') : costText}
      />
      {phase === 'cloud' ? (
        <CloudProgress />
      ) : (
        <Text variant="caption" tone="muted" align="center">
          {deviceReady && cloudReady ? `${t('recommended')} · ${costText}` : costText}
        </Text>
      )}
    </View>
  ) : null;
  const deviceOption = deviceReady ? (
    <View key="device" style={styles.option}>
      <Button
        title={t('translateOnDevice')}
        icon="device"
        kind={cloudFirst && cloudOffered ? 'secondary' : 'primary'}
        size={cloudFirst && cloudOffered ? 'regular' : 'large'}
        onPress={translateOnDevice}
        loading={phase === 'device'}
        disabled={busy && phase !== 'device'}
      />
      {phase === 'device' ? (
        <DeviceProgress progress={progress ?? 0} onCancel={cancel} />
      ) : (
        <Text variant="caption" tone="muted" align="center">
          {t('fileOfflineQualityNote')}
        </Text>
      )}
    </View>
  ) : null;

  return (
    <Screen tab>
      <ScreenHeader title={t('tabFiles')} subtitle={t('filesHint')} />

      <LanguageBar detected={file?.detected ?? null} />

      {file ? <FileCard file={file} disabled={busy} onPick={pick} /> : <EmptyFileCard disabled={busy} onPick={pick} />}

      {notices.length > 0 && <View style={styles.notices}>{notices}</View>}

      {pending && (cloudOption || deviceOption) && (
        <Card entering={enterUp} exiting={exitFade} layout={layoutTransition} style={styles.options}>
          {cloudFirst ? [cloudOption, deviceOption] : [deviceOption, cloudOption]}
        </Card>
      )}

      {result && (
        <DoneCard
          output={result}
          onShare={() => share(result)}
          upgrade={
            result.engine === 'offline' && cloudReady ? (
              <View style={styles.option}>
                <Button
                  title={t('betterQuality')}
                  icon="sparkles"
                  kind="secondary"
                  onPress={translateInCloud}
                  loading={phase === 'cloud'}
                  disabled={busy && phase !== 'cloud'}
                  accessibilityHint={t('betterQualityHint', { credits: cost })}
                />
                {phase === 'cloud' ? (
                  <CloudProgress />
                ) : (
                  <Text variant="caption" tone="muted" align="center">
                    {t('betterQualityHint', { credits: cost })}
                  </Text>
                )}
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

function EmptyFileCard({ disabled, onPick }: { disabled: boolean; onPick: () => void }) {
  return (
    <Card layout={layoutTransition} style={styles.pickCard}>
      <EmptyState
        icon="upload"
        title={t('chooseFileTitle')}
        message={t('fileSizeLimit', { size: formatFileSize(REQUEST_LIMITS.maxDocumentBytes) })}
        style={styles.emptyState}
      />
      <Button title={t('chooseFile')} size="large" onPress={onPick} disabled={disabled} />
    </Card>
  );
}

function FileCard({ file, disabled, onPick }: { file: Picked; disabled: boolean; onPick: () => void }) {
  const c = useColors();
  const reading = !file.doc;
  return (
    <Card entering={enterFade} layout={layoutTransition} style={styles.fileCard}>
      <View style={styles.fileRow}>
        <View style={[styles.fileTile, { backgroundColor: c.accentSoft }]}>
          <Icon name="file" size={iconSize.lg} color={c.accent} />
        </View>
        <View style={styles.fileText}>
          {/* A file name is content in an unknown language, not interface text. */}
          <Text variant="heading" language={null} numberOfLines={2}>
            {file.name}
          </Text>
          <Text variant="caption" tone="muted">
            {reading ? t('readingDocument') : fileMeta(file)}
          </Text>
        </View>
      </View>
      {reading && <ProgressBar progress={null} label={t('readingDocument')} />}
      <Button title={t('chooseAnotherFile')} kind="secondary" icon="upload" onPress={onPick} disabled={disabled} />
    </Card>
  );
}

function DeviceProgress({ progress, onCancel }: { progress: number; onCancel: () => void }) {
  return (
    <Animated.View entering={enterFade} exiting={exitFade} style={styles.progress}>
      <ProgressBar progress={progress} label={t('translating')} />
      <View style={styles.progressRow}>
        <Text variant="caption" tone="muted" style={styles.progressText}>
          {t('translatingProgress', { percent: formatPercent(progress) })}
        </Text>
        <Button title={t('cancel')} kind="ghost" compact onPress={onCancel} />
      </View>
    </Animated.View>
  );
}

function CloudProgress() {
  return (
    <Animated.View entering={enterFade} exiting={exitFade} style={styles.progress}>
      <ProgressBar progress={null} label={t('translating')} />
      <Text variant="caption" tone="muted" align="center">
        {t('translatingInCloud')}
      </Text>
    </Animated.View>
  );
}

function DoneCard({ output, onShare, upgrade }: { output: Output; onShare: () => void; upgrade: ReactNode }) {
  const c = useColors();
  const cloud = output.engine === 'cloud';
  return (
    <Card tone="accent" entering={enterUp} exiting={exitFade} layout={layoutTransition} style={styles.done}>
      <View style={styles.doneHead}>
        <Icon name="checkCircle" size={iconSize.xl} color={c.success} />
        <Text variant="heading" align="center" heading>
          {t('fileTranslated')}
        </Text>
        <Text variant="caption" tone="muted" align="center" language={null} numberOfLines={2}>
          {output.name}
        </Text>
        <View style={styles.engine}>
          <Icon name={cloud ? 'cloud' : 'device'} size={iconSize.sm} color={c.textMuted} />
          <Text variant="caption" tone="muted">
            {cloud ? t('cloudBadge') : t('offlineBadge')}
          </Text>
        </View>
      </View>
      <Button title={t('saveOrShare')} icon="share" size="large" onPress={onShare} />
      {upgrade}
    </Card>
  );
}

const styles = StyleSheet.create({
  pickCard: { gap: space.lg },
  emptyState: { paddingVertical: 0, paddingHorizontal: 0 },
  fileCard: { gap: space.md },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  fileTile: { width: tile.size, height: tile.size, borderRadius: tile.radius, alignItems: 'center', justifyContent: 'center' },
  fileText: { flex: 1, minWidth: 0, gap: 2 },
  notices: { gap: space.sm },
  options: { gap: space.lg },
  option: { gap: space.sm },
  progress: { gap: space.sm },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  progressText: { flex: 1, minWidth: 0 },
  done: { gap: space.md },
  doneHead: { alignItems: 'center', gap: space.xs },
  engine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
