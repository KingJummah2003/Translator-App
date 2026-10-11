import { getLocales } from 'expo-localization';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useRef, useState } from 'react';
import { getLanguage } from '@translator/shared';

/**
 * Speech to text and text to speech. Recognition runs on the device whenever the phone
 * supports it for that language (private and offline); otherwise the phone's own speech
 * service (Apple or Google) is used. We never record or upload audio ourselves.
 */

export function speechLocale(code: string): string {
  if (code === 'auto') return getLocales()[0]?.languageTag ?? 'en-US';
  return getLanguage(code)?.speech ?? code;
}

// Several screens stay mounted under the tab bar; only the one that started listening
// should receive recognition events.
let activeOwner: symbol | null = null;

export function useDictation(onFinal: (text: string, owner: string) => void) {
  const me = useRef(Symbol('dictation')).current;
  const tag = useRef('');
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const triedOnDevice = useRef(false);
  const lastLang = useRef('');

  useSpeechRecognitionEvent('start', () => {
    if (activeOwner === me) setListening(true);
  });
  useSpeechRecognitionEvent('end', () => {
    if (activeOwner !== me) return;
    setListening(false);
    setPartial('');
    activeOwner = null;
  });
  useSpeechRecognitionEvent('result', (e) => {
    if (activeOwner !== me) return;
    const text = e.results[0]?.transcript ?? '';
    if (e.isFinal) {
      setPartial('');
      if (text.trim()) onFinal(text, tag.current);
    } else {
      setPartial(text);
    }
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (activeOwner !== me) return;
    // On-device recognition doesn't cover every language: retry with the phone's online service.
    if (triedOnDevice.current && (e.error === 'language-not-supported' || e.error === 'service-not-allowed')) {
      triedOnDevice.current = false;
      startRecognition(lastLang.current, false);
      return;
    }
    if (e.error !== 'aborted' && e.error !== 'no-speech') setError(e.message || e.error);
    setListening(false);
    activeOwner = null;
  });

  const startRecognition = (lang: string, onDevice: boolean) => {
    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
      requiresOnDeviceRecognition: onDevice,
      iosTaskHint: 'dictation',
    });
  };

  const start = useCallback(
    async (languageCode: string, ownerTag = '') => {
      setError(null);
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setError('permission');
        return;
      }
      if (activeOwner) ExpoSpeechRecognitionModule.abort();
      activeOwner = me;
      tag.current = ownerTag;
      Speech.stop();
      lastLang.current = speechLocale(languageCode);
      const onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
      triedOnDevice.current = onDevice;
      startRecognition(lastLang.current, onDevice);
    },
    [me],
  );

  const stop = useCallback(() => {
    if (activeOwner === me) ExpoSpeechRecognitionModule.stop();
  }, [me]);

  return { listening, partial, error, start, stop, available: ExpoSpeechRecognitionModule.isRecognitionAvailable() };
}

export function speak(text: string, languageCode: string, onDone?: () => void): void {
  Speech.stop();
  Speech.speak(text, { language: speechLocale(languageCode), onDone, onStopped: onDone, onError: onDone });
}

export function stopSpeaking(): void {
  Speech.stop();
}
