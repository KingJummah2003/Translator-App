import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, StyleSheet, View, type TextInput } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { layoutTransition, slideIn } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { announce } from '@/lib/a11y';
import { authClient } from '@/lib/auth';
import { APPLE_SIGN_IN_ENABLED, GOOGLE_SIGN_IN } from '@/lib/config';
import { errorMessage } from '@/lib/errors';
import { t, tn } from '@/lib/i18n';
import { useDismiss } from '@/lib/nav';
import { space, useColors, useIsDark } from '@/theme';

type Step = 'choose' | 'email' | 'code' | 'password' | 'signup' | 'verify' | 'reset' | 'reset-code';
type Busy = 'apple' | 'google' | 'send' | 'resend' | 'password' | 'verify';
/** better-auth calls resolve to { data, error } instead of throwing. */
type AuthResult = { error?: unknown } | null | undefined;

/** Where Back (the button and Android's back key) goes from each step. */
const PARENT: Record<Step, Step | null> = {
  choose: null,
  email: 'choose',
  password: 'email',
  code: 'email',
  signup: 'password',
  verify: 'signup',
  reset: 'password',
  'reset-code': 'reset',
};

const EMAIL = /^\S+@\S+\.\S+$/;
/** The server's minimum. */
const MIN_PASSWORD = 10;
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_MS = 30_000;
/** Same height as a regular Button, so the native Apple button lines up with the others. */
const AUTH_BUTTON_HEIGHT = 50;

/** Keeps the digits of a typed or pasted code ("123 456", Arabic-Indic or Persian digits). */
function codeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '')
    .slice(0, CODE_LENGTH);
}

/** errors.ts maps these: a cancellation shows nothing, a failure says "Couldn't sign in". */
function authError(code: 'SIGN_IN_CANCELLED' | 'FAILED_TO_GET_USER_INFO'): Error {
  return Object.assign(new Error(code), { code });
}

type GoogleModule = typeof import('@react-native-google-signin/google-signin');
let google: Promise<GoogleModule> | null = null;

/**
 * Loads and configures Google Sign-In once. Lazy so builds without Google (and Expo Go) never
 * touch the native module; a failed load is retried on the next tap.
 */
function loadGoogle(): Promise<GoogleModule> {
  google ??= import('@react-native-google-signin/google-signin').then(
    (m) => {
      m.GoogleSignin.configure({
        webClientId: GOOGLE_SIGN_IN.webClientId || undefined,
        iosClientId: GOOGLE_SIGN_IN.iosClientId || undefined,
      });
      return m;
    },
    (e: unknown) => {
      google = null;
      throw e;
    },
  );
  return google;
}

export default function SignInScreen() {
  const c = useColors();
  const dark = useIsDark();
  const close = useDismiss();
  const [step, setStep] = useState<Step>('choose');
  // Which way the step content slides in: forward from the end edge, back from the start.
  const [forward, setForward] = useState(true);
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  // State updates are async, so a fast double tap (or VoiceOver activating the native Apple
  // button, which ignores pointerEvents) could start a second request before `busy` renders.
  const inFlight = useRef(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!APPLE_SIGN_IN_ENABLED) return;
    let live = true;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => {
        if (live) setAppleAvailable(ok);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Resend countdown: ticks once a second until the cooldown ends.
  useEffect(() => {
    if (!resendAt) return;
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= resendAt) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  const parent = PARENT[step];

  // Android's back key steps back through the flow; from the first step it closes the modal.
  useEffect(() => {
    if (Platform.OS !== 'android' || !parent || busy) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setStep(parent);
      setForward(false);
      setError(null);
      setNotice(null);
      return true;
    });
    return () => sub.remove();
  }, [parent, busy]);

  const trimmedEmail = email.trim();
  const validEmail = EMAIL.test(trimmedEmail);
  const passwordOk = password.length >= MIN_PASSWORD;
  const codeOk = code.length === CODE_LENGTH;
  const resendWait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  // Shown once the user has left the field, not while they are still typing.
  const emailError = emailTouched && trimmedEmail.length > 0 && !validEmail ? t('invalidEmail') : null;
  // Read by screen readers on a disabled button, so it says why it can't be pressed.
  const emailHint = validEmail ? undefined : t('invalidEmail');
  const credentialsHint = !validEmail ? t('invalidEmail') : !passwordOk ? t('passwordHint') : undefined;

  function go(next: Step, isForward = true) {
    if (inFlight.current) return;
    setStep(next);
    setForward(isForward);
    setError(null);
    setNotice(null);
  }

  /**
   * Runs one auth request at a time. Success closes the sheet unless `then` says what comes
   * next; failures become a localized banner (cancellations show nothing).
   */
  async function attempt(kind: Busy, fn: () => Promise<AuthResult>, then?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      if (res?.error) throw res.error;
      if (then) then();
      else close();
    } catch (e) {
      setError(errorMessage(e) || null);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  /** A code went out: start the resend cooldown and move to (or stay on) the code step. */
  function codeSent(next: Step) {
    const n = Date.now();
    setNow(n);
    setResendAt(n + RESEND_COOLDOWN_MS);
    setCode('');
    if (next === step) {
      setNotice(t('codeSent'));
    } else {
      setStep(next);
      setForward(true);
      announce(t('codeSent'));
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
      if (!cred.identityToken) throw authError('FAILED_TO_GET_USER_INFO');
      return authClient.signIn.social({ provider: 'apple', idToken: { token: cred.identityToken, nonce } });
    });

  const signInWithGoogle = () =>
    attempt('google', async () => {
      const { GoogleSignin, isSuccessResponse } = await loadGoogle();
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const res = await GoogleSignin.signIn();
      if (!isSuccessResponse(res)) throw authError('SIGN_IN_CANCELLED');
      if (!res.data.idToken) throw authError('FAILED_TO_GET_USER_INFO');
      return authClient.signIn.social({ provider: 'google', idToken: { token: res.data.idToken } });
    });

  const sendCode = (kind: Busy = 'send') =>
    attempt(
      kind,
      () => authClient.emailOtp.sendVerificationOtp({ email: trimmedEmail, type: 'sign-in' }),
      () => codeSent('code'),
    );

  const signInWithPassword = () => attempt('password', () => authClient.signIn.email({ email: trimmedEmail, password }));

  // Password accounts must confirm their email with a code before the first sign-in.
  const signUp = () =>
    attempt(
      'send',
      () => authClient.signUp.email({ email: trimmedEmail, password, name: name.trim() || trimmedEmail.split('@')[0]! }),
      () => codeSent('verify'),
    );

  const resendVerification = () =>
    attempt(
      'resend',
      () => authClient.emailOtp.sendVerificationOtp({ email: trimmedEmail, type: 'email-verification' }),
      () => codeSent('verify'),
    );

  const requestReset = (kind: Busy = 'send') =>
    attempt(
      kind,
      () => authClient.emailOtp.requestPasswordReset({ email: trimmedEmail }),
      () => {
        if (step === 'reset') setPassword('');
        codeSent('reset-code');
      },
    );

  const submitCode = (otp: string) => {
    if (step === 'code') return attempt('verify', () => authClient.signIn.emailOtp({ email: trimmedEmail, otp }));
    if (step === 'verify') {
      return attempt('verify', async () => {
        const res = await authClient.emailOtp.verifyEmail({ email: trimmedEmail, otp });
        if (res.error) return res;
        return authClient.signIn.email({ email: trimmedEmail, password });
      });
    }
    return attempt('verify', async () => {
      const res = await authClient.emailOtp.resetPassword({ email: trimmedEmail, otp, password });
      if (res.error) return res;
      return authClient.signIn.email({ email: trimmedEmail, password });
    });
  };

  const resend = () => {
    if (step === 'code') void sendCode('resend');
    else if (step === 'verify') void resendVerification();
    else void requestReset('resend');
  };

  const onCodeChange = (value: string) => {
    const digits = codeDigits(value);
    setCode(digits);
    // A complete code (typed, pasted or autofilled) submits by itself: the number pad has no
    // return key. A password reset still needs the new password, so focus moves there instead.
    if (digits.length === CODE_LENGTH && digits !== code) {
      if (step === 'reset-code') passwordRef.current?.focus();
      else void submitCode(digits);
    }
  };

  const onEmailSubmit = () => {
    setEmailTouched(true);
    if (!validEmail) return;
    if (step === 'email') void sendCode();
    else if (step === 'reset') void requestReset();
    else passwordRef.current?.focus();
  };

  const onPasswordSubmit = () => {
    if (!validEmail || !passwordOk) return;
    if (step === 'signup') void signUp();
    else if (step === 'password') void signInWithPassword();
    else if (codeOk) void submitCode(code);
  };

  const emailSteps = step === 'email' || step === 'password' || step === 'signup' || step === 'reset';
  const codeSteps = step === 'code' || step === 'verify' || step === 'reset-code';
  // Focus the first field that still needs something; autoFocus only applies when a step mounts.
  const firstField = step === 'signup' && !name ? 'name' : !validEmail || step === 'email' || step === 'reset' ? 'email' : 'password';

  return (
    <Screen sheet edges={['top', 'bottom']}>
      <ModalHeader title={t('signInTitle')} subtitle={t('signInSubtitle')} />

      {error ? <Banner tone="danger" message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? <Banner tone="success" message={notice} /> : null}

      {/* Each step slides in from the side it comes from (mirrored in RTL); the first one doesn't. */}
      <LayoutAnimationConfig skipEntering>
        <Animated.View key={step} entering={slideIn(forward)} layout={layoutTransition} style={styles.step}>
          {parent ? (
            <Button title={t('back')} kind="ghost" icon="back" compact haptic={false} onPress={() => go(parent, false)} style={styles.back} />
          ) : null}

          {step === 'choose' && (
            <>
              {appleAvailable && (
                <View pointerEvents={busy ? 'none' : 'auto'} style={[styles.apple, busy === 'apple' && styles.waiting]}>
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={AUTH_BUTTON_HEIGHT / 2}
                    style={styles.appleButton}
                    onPress={() => void signInWithApple()}
                  />
                  {busy === 'apple' ? <ActivityIndicator color={dark ? c.bg : c.onMedia} style={styles.appleSpinner} /> : null}
                </View>
              )}
              {GOOGLE_SIGN_IN.available ? (
                <Button title={t('continueWithGoogle')} kind="secondary" loading={busy === 'google'} onPress={() => void signInWithGoogle()} />
              ) : null}
              <Button title={t('continueWithEmail')} kind="secondary" icon="mail" onPress={() => go('email')} />
            </>
          )}

          {emailSteps && (
            <>
              {step === 'signup' && (
                <TextField
                  label={t('name')}
                  value={name}
                  onChangeText={setName}
                  autoComplete="name"
                  textContentType="name"
                  autoCapitalize="words"
                  autoFocus={firstField === 'name'}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => emailRef.current?.focus()}
                />
              )}
              <TextField
                ref={emailRef}
                kind="email"
                label={t('email')}
                value={email}
                onChangeText={setEmail}
                onBlur={() => setEmailTouched(true)}
                error={emailError}
                autoFocus={firstField === 'email'}
                returnKeyType={step === 'email' || step === 'reset' ? 'send' : 'next'}
                submitBehavior={step === 'email' || step === 'reset' ? 'blurAndSubmit' : 'submit'}
                onSubmitEditing={onEmailSubmit}
              />
              {(step === 'password' || step === 'signup') && (
                <TextField
                  ref={passwordRef}
                  kind={step === 'signup' ? 'newPassword' : 'password'}
                  label={t('password')}
                  hint={step === 'signup' ? t('passwordHint') : undefined}
                  value={password}
                  onChangeText={setPassword}
                  autoFocus={firstField === 'password'}
                  returnKeyType="go"
                  onSubmitEditing={onPasswordSubmit}
                />
              )}

              {step === 'email' && (
                <>
                  <Button
                    title={t('emailCode')}
                    disabled={!validEmail}
                    accessibilityHint={emailHint}
                    loading={busy === 'send'}
                    onPress={() => void sendCode()}
                  />
                  <Button title={t('usePassword')} kind="ghost" onPress={() => go('password')} />
                </>
              )}
              {step === 'password' && (
                <>
                  <Button
                    title={t('signIn')}
                    disabled={!validEmail || !passwordOk}
                    accessibilityHint={credentialsHint}
                    loading={busy === 'password'}
                    onPress={() => void signInWithPassword()}
                  />
                  <View>
                    <Button title={t('forgotPassword')} kind="ghost" onPress={() => go('reset')} />
                    <Button title={t('noAccount')} kind="ghost" onPress={() => go('signup')} />
                    <Button title={t('useCode')} kind="ghost" onPress={() => go('email')} />
                  </View>
                </>
              )}
              {step === 'signup' && (
                <>
                  <Button
                    title={t('createAccount')}
                    disabled={!validEmail || !passwordOk}
                    accessibilityHint={credentialsHint}
                    loading={busy === 'send'}
                    onPress={() => void signUp()}
                  />
                  <Button title={t('haveAccount')} kind="ghost" onPress={() => go('password', false)} />
                </>
              )}
              {step === 'reset' && (
                <>
                  <Button
                    title={t('emailCode')}
                    disabled={!validEmail}
                    accessibilityHint={emailHint}
                    loading={busy === 'send'}
                    onPress={() => void requestReset()}
                  />
                  <Button title={t('haveAccount')} kind="ghost" onPress={() => go('password', false)} />
                </>
              )}
            </>
          )}

          {codeSteps && (
            <>
              <Text variant="body">{t('enterCode', { email: trimmedEmail })}</Text>
              <TextField
                kind="code"
                label={t('verificationCode')}
                value={code}
                onChangeText={onCodeChange}
                // Room for a pasted "123 456"; the value is cleaned to six digits.
                maxLength={CODE_LENGTH * 2}
                autoFocus
              />
              {step === 'reset-code' && (
                <TextField
                  ref={passwordRef}
                  kind="newPassword"
                  label={t('newPassword')}
                  hint={t('passwordHint')}
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="go"
                  onSubmitEditing={onPasswordSubmit}
                />
              )}
              <Button
                title={step === 'reset-code' ? t('resetPassword') : t('verify')}
                disabled={!codeOk || (step === 'reset-code' && !passwordOk)}
                accessibilityHint={!codeOk ? t('enterCode', { email: trimmedEmail }) : step === 'reset-code' && !passwordOk ? t('passwordHint') : undefined}
                loading={busy === 'verify'}
                onPress={() => void submitCode(code)}
              />
              <Button
                title={resendWait > 0 ? tn('resendIn', resendWait) : t('resendCode')}
                kind="ghost"
                disabled={resendWait > 0}
                loading={busy === 'resend'}
                onPress={resend}
              />
            </>
          )}
        </Animated.View>
      </LayoutAnimationConfig>
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: { gap: space.md },
  // Pulls the ghost button's padding back so its arrow lines up with the fields' edge.
  back: { alignSelf: 'flex-start', marginStart: -space.md },
  apple: { height: AUTH_BUTTON_HEIGHT, justifyContent: 'center' },
  appleButton: { height: AUTH_BUTTON_HEIGHT, width: '100%' },
  waiting: { opacity: 0.7 },
  appleSpinner: { position: 'absolute', end: space.lg },
});
