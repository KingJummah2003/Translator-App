import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { Banner } from '@/components/Banner';
import { Button, IconButton } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { authClient } from '@/lib/auth';
import { GOOGLE_SIGN_IN } from '@/lib/config';
import { dismiss } from '@/lib/nav';
import { t } from '@/lib/i18n';
import { radius, space, useColors } from '@/theme';

type Step = 'choose' | 'email' | 'code' | 'password';

export default function SignInScreen() {
  const c = useColors();
  const [step, setStep] = useState<Step>('choose');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, []);

  async function attempt(kind: string, fn: () => Promise<{ error?: { message?: string } | null } | void>) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fn();
      if (res && res.error) throw new Error(res.error.message ?? t('error'));
      if (kind !== 'send') dismiss();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code !== 'ERR_REQUEST_CANCELED' && err.code !== 'SIGN_IN_CANCELLED') setError(err.message ?? t('error'));
    } finally {
      setBusy(null);
    }
  }

  const signInWithApple = () =>
    attempt('apple', async () => {
      // Apple embeds the SHA-256 of our nonce in the token; the server checks it, which
      // stops a stolen token from being replayed.
      const nonce = Crypto.randomUUID();
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashed,
      });
      if (!cred.identityToken) throw new Error(t('error'));
      return authClient.signIn.social({ provider: 'apple', idToken: { token: cred.identityToken, nonce } });
    });

  const signInWithGoogle = () =>
    attempt('google', async () => {
      const { GoogleSignin, isSuccessResponse } = await import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({ webClientId: GOOGLE_SIGN_IN.webClientId, iosClientId: GOOGLE_SIGN_IN.iosClientId || undefined });
      await GoogleSignin.hasPlayServices();
      const res = await GoogleSignin.signIn();
      if (!isSuccessResponse(res) || !res.data.idToken) {
        const cancelled = new Error('cancelled') as Error & { code: string };
        cancelled.code = 'SIGN_IN_CANCELLED';
        throw cancelled;
      }
      return authClient.signIn.social({ provider: 'google', idToken: { token: res.data.idToken } });
    });

  const sendCode = () =>
    attempt('send', async () => {
      const res = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' });
      if (!res.error) setStep('code');
      return res;
    });

  const verifyCode = () => attempt('verify', () => authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() }));

  const signInWithPassword = () => attempt('password', () => authClient.signIn.email({ email: email.trim(), password }));

  const input = (props: React.ComponentProps<typeof TextInput>) => (
    <TextInput
      placeholderTextColor={c.textFaint}
      {...props}
      style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }, props.style]}
    />
  );

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.close}>
        <IconButton icon="close" label={t('close')} onPress={() => dismiss()} />
      </View>
      <View style={styles.body}>
        <Text variant="display">{t('signInTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('signInSubtitle')}
        </Text>

        {error && <Banner icon="warning" tone="danger" message={error} />}

        {step === 'choose' && (
          <View style={styles.stack}>
            {appleAvailable && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={c.bg === '#0F1012' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={radius.pill}
                style={styles.apple}
                onPress={() => void signInWithApple()}
              />
            )}
            {GOOGLE_SIGN_IN.webClientId ? (
              <Button title={t('continueWithGoogle')} kind="secondary" icon="globe" loading={busy === 'google'} onPress={() => void signInWithGoogle()} />
            ) : null}
            <Button title={t('continueWithEmail')} kind="secondary" icon="mail" onPress={() => setStep('email')} />
          </View>
        )}

        {(step === 'email' || step === 'password') && (
          <View style={styles.stack}>
            {input({
              value: email,
              onChangeText: setEmail,
              placeholder: t('email'),
              keyboardType: 'email-address',
              autoCapitalize: 'none',
              autoComplete: 'email',
              textContentType: 'emailAddress',
              autoFocus: true,
              accessibilityLabel: t('email'),
            })}
            {step === 'password' &&
              input({
                value: password,
                onChangeText: setPassword,
                placeholder: t('password'),
                secureTextEntry: true,
                autoComplete: 'current-password',
                textContentType: 'password',
                accessibilityLabel: t('password'),
              })}
            {step === 'email' ? (
              <>
                <Button title={t('emailCode')} disabled={!validEmail} loading={busy === 'send'} onPress={() => void sendCode()} />
                <Button title={t('usePassword')} kind="ghost" onPress={() => setStep('password')} />
              </>
            ) : (
              <>
                <Button title={t('signIn')} disabled={!validEmail || password.length < 10} loading={busy === 'password'} onPress={() => void signInWithPassword()} />
                <Button title={t('useCode')} kind="ghost" onPress={() => setStep('email')} />
              </>
            )}
          </View>
        )}

        {step === 'code' && (
          <View style={styles.stack}>
            <Text variant="body">{t('enterCode', { email: email.trim() })}</Text>
            {input({
              value: code,
              onChangeText: (v) => setCode(v.replace(/\D/g, '').slice(0, 6)),
              placeholder: '••••••',
              keyboardType: 'number-pad',
              autoComplete: 'one-time-code',
              textContentType: 'oneTimeCode',
              autoFocus: true,
              style: styles.code,
              accessibilityLabel: t('verify'),
            })}
            <Button title={t('verify')} disabled={code.length !== 6} loading={busy === 'verify'} onPress={() => void verifyCode()} />
            <Button title={t('retry')} kind="ghost" onPress={() => void sendCode()} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: { alignItems: 'flex-end', paddingTop: space.sm },
  body: { gap: space.lg, paddingTop: space.lg },
  stack: { gap: space.md, marginTop: space.md },
  apple: { height: 50, width: '100%' },
  input: { height: 52, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, fontSize: 17 },
  code: { fontSize: 28, letterSpacing: 12, textAlign: 'center', height: 64 },
});
