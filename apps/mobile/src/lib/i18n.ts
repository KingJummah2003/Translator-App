import { reloadAppAsync } from 'expo';
import { File, Paths } from 'expo-file-system';
import { getCalendars, getLocales, useLocales, type Locale } from 'expo-localization';
import { useEffect } from 'react';
import { I18nManager, Platform } from 'react-native';
import { DIALECT_NAMES_AR, getLanguage } from '@translator/shared';

/**
 * Interface text in English and Arabic, plus the formatting helpers that go with it (plurals,
 * numbers, dates, lists, language names, sorting and search).
 *
 * The app follows the phone's language: the first of English or Arabic in the phone's list,
 * which is the same rule iOS uses to pick the bundle localization and the Android config
 * plugin uses to pick the layout direction. Arabic also flips the layout right-to-left.
 */

/** English plural forms. `zero` is optional and only used for 0 ("No credits"). */
interface EnPlural {
  zero?: string;
  one: string;
  other: string;
}

/** Arabic has all six CLDR plural forms: 0, 1, 2, 3–10, 11–99 and the rest (100, 101, …). */
interface ArPlural {
  zero: string;
  one: string;
  two: string;
  few: string;
  many: string;
  other: string;
}

const en = {
  appName: 'Translator',
  // tabs
  tabTranslate: 'Translate',
  tabCamera: 'Camera',
  tabTalk: 'Talk',
  tabFiles: 'Files',
  tabAccount: 'Account',
  // translate
  detect: 'Detect language',
  detected: 'Detected: {lang}',
  typeHere: 'Type or paste text',
  listening: 'Listening…',
  listeningTapToStop: 'Listening… tap to stop',
  stopListening: 'Stop listening',
  tapToSpeak: 'Tap to speak',
  translating: 'Translating…',
  translationReady: 'Translation ready',
  translate: 'Translate',
  translateWithCloud: 'Translate with cloud',
  swap: 'Swap languages',
  copy: 'Copy',
  copied: 'Copied',
  share: 'Share',
  listen: 'Listen',
  stop: 'Stop',
  clear: 'Clear',
  betterQuality: 'Better quality',
  betterQualityHint: {
    zero: 'Cloud translation · free',
    one: 'Cloud translation · {credits} credit',
    other: 'Cloud translation · {credits} credits',
  },
  costCredits: { zero: 'Free', one: '{credits} credit', other: '{credits} credits' },
  creditCount: { zero: 'No credits', one: '{count} credit', other: '{count} credits' },
  plansLegal:
    'Subscriptions renew automatically until cancelled at least 24 hours before the end of the period. Payment is charged to your App Store or Google Play account. Pro includes {pro} credits a day and VIP {vip} credits a week; unused allowance does not roll over. Purchased credits never expire.',
  aboutChars: { one: '≈ {chars} character', other: '≈ {chars} characters' },
  characterCount: { one: '{count} character', other: '{count} characters' },
  charCount: '{count} / {max}',
  offlineBadge: 'On device',
  cloudBadge: 'Cloud',
  recommended: 'Recommended',
  offlineQualityNote: 'On-device translation is basic quality. For medical, legal or important text, use Better quality.',
  offlineNoteGood: 'Translated on your phone. For important text, use Better quality.',
  offlineNoteFair: 'On-device quality is fair for these languages. For important text, use Better quality.',
  offlineQuality: 'Offline quality: {quality}',
  qualityGood: 'Good',
  qualityFair: 'Fair',
  qualityBasic: 'Basic',
  medicalWarningTitle: 'Double-check important translations',
  medicalWarning:
    'Machine translation can make mistakes. For medical, legal or safety matters, confirm with a qualified professional or interpreter.',
  tapWordHint: 'Tap any word for its meanings',
  lookUpWord: 'Look up “{word}”',
  downloadToUseOffline: 'Download {lang} to translate offline',
  downloadLanguagesToUseOffline: 'Download the languages to translate offline',
  download: 'Download',
  downloading: 'Downloading…',
  downloadProgress: 'Downloading {percent}',
  waitingForWifi: 'Waiting for Wi-Fi',
  needsInternet: '{lang} needs an internet connection',
  signInForCloud: 'Sign in to use cloud translation for {lang}',
  detectFailed: "Couldn't detect the language. Choose it yourself.",
  // languages
  chooseLanguage: 'Choose language',
  translateFrom: 'Translate from',
  translateTo: 'Translate to',
  languagePair: '{from} to {to}',
  search: 'Search',
  noLanguagesFound: 'No languages match “{query}”',
  languageCount: { one: '{count} language', other: '{count} languages' },
  recent: 'Recent',
  allLanguages: 'All languages',
  availableOffline: 'Available offline',
  availableToDownload: 'Available to download',
  cloudOnly: 'Cloud only',
  downloaded: 'Downloaded',
  downloadedCount: { zero: 'None downloaded', one: '{count} downloaded', other: '{count} downloaded' },
  downloads: 'Downloads',
  offlineLanguages: 'Offline languages',
  offlineLanguagesHint: 'Downloaded languages translate on your phone: fast, free and private. About 30 MB each.',
  onDeviceNeedsDevBuild: 'On-device translation needs a development build on a real device.',
  wifiOnly: 'Download on Wi-Fi only',
  delete: 'Delete',
  downloadLanguage: 'Download {lang}',
  deleteLanguage: 'Delete {lang}',
  deleteLanguageConfirm: 'Delete {lang} from this phone? You can download it again at any time.',
  dialect: 'Dialect',
  speechDialectHint: 'Used when you speak and when translations are read aloud',
  automatic: 'Automatic',
  // camera
  dialectFor: 'Dialect: {lang}',
  englishRequired: 'Required for all offline translation',
  downloadingLanguage: 'Downloading {lang}',
  languageDownloaded: '{lang} downloaded',
  languageDeleted: '{lang} deleted',
  cameraTitle: 'Point at text',
  cameraHint: 'Take a photo of a sign, menu or page',
  capture: 'Capture',
  retake: 'Retake',
  pickPhoto: 'Choose photo',
  readingText: 'Reading text…',
  noTextFound: 'No text found. Try moving closer or improving the light.',
  cameraPermission: 'Allow camera access to translate text around you.',
  allow: 'Allow',
  openSettings: 'Open Settings',
  original: 'Original',
  translation: 'Translation',
  // talk
  captureFailed: "Couldn't take the photo. Try again.",
  cameraUnavailable: "The camera couldn't start. Close other apps that are using it, or choose a photo instead.",
  talkTitle: 'Conversation',
  talkHint: 'Each person taps their side and speaks. The translation appears and is read aloud for the other person.',
  holdToTalk: 'Tap and speak',
  autoSpeak: 'Read translations aloud',
  micPermission: 'Allow microphone and speech recognition to speak instead of typing.',
  // speech errors
  talkReplayHint: 'Reads the message aloud again.',
  talkStopReadingHint: 'Stops reading aloud.',
  micBlocked: 'Allow microphone and speech recognition in Settings.',
  speechUnavailable: 'Speech recognition is not available on this device.',
  speechNotAllowed: 'Speech recognition is turned off on this phone. Turn it on in Settings.',
  speechLanguageUnsupported: "This language isn't supported for speech on this device.",
  speechLanguageUnsupportedNamed: "Speech recognition isn't available for {lang} on this device. You can type instead.",
  speechNoSpeech: "Didn't catch that. Try again.",
  speechNetwork: 'Speech recognition needs an internet connection.',
  speechBusy: 'The microphone is busy. Try again in a moment.',
  speechInterrupted: 'Listening stopped because of a call or another app.',
  speechAudio: "Couldn't use the microphone. Try again.",
  speechTimeout: "Listening didn't start. Try again.",
  speechError: 'Speech recognition failed. Try again.',
  // files
  filesTitle: 'Translate a document',
  filesHint: 'Word, PDF and text files. Word files keep their formatting; PDFs are read on your phone and returned as Word files.',
  chooseFile: 'Choose file',
  chooseFileTitle: 'Choose a Word, PDF or text file',
  unsupportedFileType: "This file type isn't supported. Choose a Word, PDF or text file.",
  fileTranslated: 'Your translated file is ready',
  saveOrShare: 'Save or share',
  translateOnDevice: 'Translate on this phone',
  translateInCloud: 'Translate in the cloud',
  fileCost: { zero: 'Free', one: 'About {credits} credit', other: 'About {credits} credits' },
  fileTooBig: 'This file is too large (10 MB max).',
  kilobytes: '{size} KB',
  megabytes: '{size} MB',
  pdfUnavailable: 'Reading PDFs needs the full app build on this device.',
  pdfNoText: 'No text was found in this PDF.',
  pdfLocked: 'This PDF is password-protected. Remove the password and try again.',
  // dictionary
  readingDocument: 'Reading the document…',
  fileSizeLimit: 'Up to {size}',
  chooseAnotherFile: 'Choose another file',
  documentEmpty: 'This file has no text to translate.',
  fileOfflineQualityNote: 'On-device translation is basic quality. For important documents, translate in the cloud.',
  translatingProgress: 'Translating… {percent}',
  translatingInCloud: 'Translating in the cloud. Long documents can take a minute.',
  pdfPagesLimited: 'Only the first {count} pages of this PDF are translated.',
  documentTooLongForPlan: 'This document is longer than your plan allows ({max} characters max).',
  dictionary: 'Dictionary',
  meanings: 'Meanings',
  noDefinitions: 'No dictionary entry found.',
  dictionaryOffline: 'The dictionary needs an internet connection.',
  dictionaryFailed: "Couldn't load this dictionary entry.",
  alsoUsedIn: 'Also used in',
  savedForOffline: 'Saved for offline use',
  // history
  wordMissing: 'No word to look up',
  history: 'History',
  historyEmpty: 'No translations yet',
  historyEmptyHint: 'Translations you make appear here.',
  historyOff: 'History is turned off. Turn it on in Account to keep your translations.',
  historyLoadFailed: "Couldn't load your history.",
  historyOpenHint: 'Opens this translation again',
  historyCleared: 'History cleared',
  historyReset: 'History on this phone was reset.',
  clearHistoryConfirm: "Delete all saved translations from this phone? This can't be undone.",
  // account
  deleteTranslation: 'Delete this translation?',
  historyItemDeleted: 'Translation deleted',
  signIn: 'Sign in',
  signOut: 'Sign out',
  signedOut: 'Signed out',
  signInTitle: 'Sign in to Translator',
  signInSubtitle: 'An account keeps your purchases and credits safe across devices. Offline translation works without one.',
  continueWithApple: 'Continue with Apple',
  continueWithGoogle: 'Continue with Google',
  continueWithEmail: 'Continue with email',
  email: 'Email',
  invalidEmail: 'Enter a valid email address.',
  password: 'Password',
  emailCode: 'Email me a code',
  usePassword: 'Use a password instead',
  useCode: 'Use a one-time code instead',
  enterCode: 'Enter the 6-digit code we sent to {email}',
  verificationCode: 'Verification code',
  codeSent: 'Code sent. Check your email.',
  resendCode: 'Resend code',
  resendIn: { one: 'Resend in {count} second', other: 'Resend in {count} seconds' },
  verify: 'Verify',
  createAccount: 'Create account',
  name: 'Name',
  forgotPassword: 'Forgot password?',
  newPassword: 'New password',
  passwordHint: 'At least 10 characters',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  resetPassword: 'Reset password',
  haveAccount: 'I already have an account',
  noAccount: 'Create an account with a password',
  signInFailed: "Couldn't sign in. Try again.",
  credits: 'Credits',
  plan: 'Plan',
  freePlan: 'Free',
  creditsPlan: 'Credits',
  passPlan: '3-hour pass',
  proPlan: 'Pro',
  vipPlan: 'VIP',
  passActiveUntil: 'Pass active until {time}',
  passAlreadyActive: 'A pass is already active.',
  startPass: 'Start a 3-hour pass',
  passesAvailable: { one: '{count} unused pass', other: '{count} unused passes' },
  renewsOn: 'Renews {date}',
  endsOn: 'Ends {date}',
  vipResets: 'Resets every Monday',
  upgrade: 'Get more',
  purchases: 'Purchases',
  restorePurchases: 'Restore purchases',
  purchasesRestored: 'Purchases restored',
  nothingToRestore: 'No purchases to restore',
  updatingBalance: 'Updating balance…',
  manageSubscription: 'Manage subscription',
  manageInStore: 'Manage your subscription in the App Store or Google Play settings.',
  privacy: 'Privacy',
  privacyPolicy: 'Privacy policy',
  terms: 'Terms of use',
  saveHistory: 'Keep translation history on this phone',
  clearHistory: 'Clear history',
  exportData: 'Download my data',
  deleteAccount: 'Delete account',
  deleteAccountConfirm:
    'This permanently deletes your account, credits and passes. Active store subscriptions must be cancelled in your App Store or Google Play settings. Continue?',
  deleteAccountReauth: 'For your security, sign in again, then delete your account.',
  accountDeleted: 'Your account was deleted',
  appLock: 'Require Face ID / fingerprint',
  appLockOn: 'App lock is on',
  appLockOff: 'App lock is off',
  biometricsUnavailable: 'Set up Face ID, Touch ID or a fingerprint in your phone settings first.',
  unlock: 'Unlock',
  unlockPrompt: 'Unlock Translator',
  unlockFailed: "Couldn't confirm it's you. Try again.",
  biometricLockout: 'Too many attempts. Unlock your phone with its passcode, then try again.',
  version: 'Version {version}',
  // plans
  plansTitle: 'Do more with cloud translation',
  plansSubtitle: 'Best quality for every language, documents and camera text in any script.',
  subscriptions: 'Subscriptions',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
  creditPacks: 'Credit packs',
  sessionPass: '3-hour pass',
  sessionPassHint: 'Everything unlocked for 3 hours. Perfect for a trip or a meeting.',
  proFeatures: {
    one: '{credits} credit every day · documents · cloud camera',
    other: '{credits} credits every day · documents · cloud camera',
  },
  vipFeatures: {
    one: '{credits} credit every week · highest limits · priority',
    other: '{credits} credits every week · highest limits · priority',
  },
  buy: 'Buy',
  subscribe: 'Subscribe',
  bestValue: 'Best value',
  priceUnavailable: 'Price unavailable',
  purchasesUnavailable: 'Purchases are not available on this device.',
  // generic
  purchaseComplete: 'Purchase complete. Thank you!',
  cancel: 'Cancel',
  done: 'Done',
  ok: 'OK',
  retry: 'Try again',
  close: 'Close',
  continue: 'Continue',
  back: 'Back',
  next: 'Next',
  loading: 'Loading…',
  error: 'Something went wrong',
  offline: 'You are offline',
  notEnoughCredits: 'Not enough credits',
  getCredits: 'Get credits',
  // errors (see errors.ts)
  errorNetwork: "Can't connect. Check your internet connection and try again.",
  errorTimeout: 'This is taking too long. Try again.',
  errorBadRequest: "That request couldn't be processed. Check it and try again.",
  errorUnauthorized: 'Your session has ended. Sign in again to continue.',
  errorForbidden: "This account can't do that. Contact support if this seems wrong.",
  errorNotFound: "That's no longer available.",
  errorRateLimited: 'Too many requests. Wait a moment and try again.',
  errorTooLarge: 'This is too large to translate. Try a shorter text or a smaller file.',
  errorServicePaused: 'Cloud translation is paused right now. On-device translation still works.',
  errorUpstream: 'The translation service is having trouble. Try again in a moment.',
  errorInternal: 'Something went wrong on our side. Try again in a moment.',
  errorDownloadFailed: "Couldn't download {lang}. Check your connection and try again.",
  errorDeleteFailed: "Couldn't remove {lang}. Try again.",
  errorBadImage: "Couldn't open this image. Try another photo.",
  errorBadPdf: "Couldn't open this PDF. It may be damaged.",
  errorBadDocument: "Couldn't read this file. Make sure it's a Word, PDF or text file.",
  errorDocumentTooComplex: 'This document is too large or complex to translate.',
  errorOnDeviceUnavailable: "On-device translation isn't available here. Use cloud translation instead.",
  errorTranslateFailed: "Couldn't translate this. Try again.",
  errorOcrFailed: "Couldn't read the text in this image. Try again.",
  errorOcrUnavailable: 'Text recognition is still being set up on this phone. Try again in a minute.',
  errorUnsupportedLanguage: "{lang} can't be translated on this device.",
  errorInvalidCredentials: 'Incorrect email or password.',
  errorInvalidCode: "That code isn't right. Check it and try again.",
  errorCodeExpired: 'This code has expired. Request a new one.',
  errorTooManyAttempts: 'Too many attempts. Request a new code and try again.',
  errorUserExists: 'An account with this email already exists. Sign in instead.',
  errorPasswordTooShort: 'The password must be at least 10 characters.',
  errorPasswordTooLong: 'This password is too long.',
  errorEmailNotVerified: 'Confirm your email address first.',
  errorPlayServices: 'Google Play services are not available on this device.',
  errorPaymentPending: 'Your payment is pending. Credits are added once it goes through.',
  errorStoreProblem: 'The App Store or Google Play had a problem. Try again later.',
  errorPurchaseNotAllowed: 'Purchases are turned off on this device.',
  errorAlreadyOwned: 'You already own this. Tap Restore purchases.',
  errorReceiptInUse: 'This purchase is linked to another account. Sign in with that account to use it.',
  errorProductUnavailable: "This item isn't available right now.",
  errorPurchaseInProgress: 'A purchase is already in progress. Wait a moment.',
  purchaseSignInRequired: 'Sign in to buy or restore purchases, so they stay with your account.',
} satisfies Record<string, string | EnPlural>;

type Strings = typeof en;
export type StringKey = keyof Strings;
/** Keys whose text depends on a number (t() picks the form from the first numeric variable). */
export type PluralKey = { [K in StringKey]: Strings[K] extends string ? never : K }[StringKey];
/** Plural keys whose number is the {count} placeholder, for tn(). */
export type CountKey = 'creditCount' | 'characterCount' | 'languageCount' | 'downloadedCount' | 'passesAvailable' | 'resendIn';
type ArStrings = { [K in StringKey]: Strings[K] extends string ? string : ArPlural };

const ar: ArStrings = {
  appName: 'المترجم',
  tabTranslate: 'ترجمة',
  tabCamera: 'الكاميرا',
  tabTalk: 'محادثة',
  tabFiles: 'الملفات',
  tabAccount: 'الحساب',
  detect: 'اكتشاف اللغة',
  detected: 'اللغة المكتشفة: {lang}',
  typeHere: 'اكتب النص أو الصقه',
  listening: 'جارٍ الاستماع…',
  listeningTapToStop: 'جارٍ الاستماع… اضغط للإيقاف',
  stopListening: 'إيقاف الاستماع',
  tapToSpeak: 'اضغط للتحدث',
  translating: 'جارٍ الترجمة…',
  translationReady: 'الترجمة جاهزة',
  translate: 'ترجم',
  translateWithCloud: 'ترجم عبر السحابة',
  swap: 'تبديل اللغتين',
  copy: 'نسخ',
  copied: 'تم النسخ',
  share: 'مشاركة',
  listen: 'استماع',
  stop: 'إيقاف',
  clear: 'مسح',
  betterQuality: 'جودة أعلى',
  betterQualityHint: {
    zero: 'ترجمة سحابية · مجانًا',
    one: 'ترجمة سحابية · رصيد واحد',
    two: 'ترجمة سحابية · رصيدان',
    few: 'ترجمة سحابية · {credits} أرصدة',
    many: 'ترجمة سحابية · {credits} رصيدًا',
    other: 'ترجمة سحابية · {credits} رصيد',
  },
  costCredits: {
    zero: 'مجانًا',
    one: 'رصيد واحد',
    two: 'رصيدان',
    few: '{credits} أرصدة',
    many: '{credits} رصيدًا',
    other: '{credits} رصيد',
  },
  creditCount: {
    zero: 'لا يوجد رصيد',
    one: 'رصيد واحد',
    two: 'رصيدان',
    few: '{count} أرصدة',
    many: '{count} رصيدًا',
    other: '{count} رصيد',
  },
  // Phrased as "a daily credit of N" so it reads correctly for any number.
  plansLegal:
    'تتجدد الاشتراكات تلقائيًا ما لم تُلغَ قبل 24 ساعة على الأقل من نهاية الفترة. يُخصم المبلغ من حسابك في App Store أو Google Play. تتضمن خطة برو رصيدًا يوميًا قدره {pro}، وخطة VIP رصيدًا أسبوعيًا قدره {vip}، ولا يُرحَّل الرصيد غير المستخدم. الرصيد المشترى لا تنتهي صلاحيته.',
  aboutChars: {
    zero: '≈ {chars} حرف',
    one: '≈ حرف واحد',
    two: '≈ حرفان',
    few: '≈ {chars} أحرف',
    many: '≈ {chars} حرفًا',
    other: '≈ {chars} حرف',
  },
  characterCount: {
    zero: 'لا توجد أحرف',
    one: 'حرف واحد',
    two: 'حرفان',
    few: '{count} أحرف',
    many: '{count} حرفًا',
    other: '{count} حرف',
  },
  charCount: '{count} / {max}',
  offlineBadge: 'على الجهاز',
  cloudBadge: 'سحابية',
  recommended: 'موصى به',
  offlineQualityNote: 'الترجمة على الجهاز ذات جودة أساسية. للنصوص الطبية أو القانونية أو المهمة، استخدم «جودة أعلى».',
  offlineNoteGood: 'تُرجم النص على هاتفك. للنصوص المهمة، استخدم «جودة أعلى».',
  offlineNoteFair: 'جودة الترجمة على الجهاز مقبولة لهاتين اللغتين. للنصوص المهمة، استخدم «جودة أعلى».',
  offlineQuality: 'جودة الترجمة دون إنترنت: {quality}',
  qualityGood: 'جيدة',
  qualityFair: 'مقبولة',
  qualityBasic: 'أساسية',
  medicalWarningTitle: 'تحقّق من الترجمات المهمة',
  medicalWarning: 'قد تخطئ الترجمة الآلية. في الأمور الطبية أو القانونية أو المتعلقة بالسلامة، تأكّد من صحتها لدى مختص مؤهل أو مترجم.',
  tapWordHint: 'اضغط على أي كلمة لمعرفة معانيها',
  lookUpWord: 'ابحث عن «{word}» في القاموس',
  downloadToUseOffline: 'نزّل {lang} للترجمة دون إنترنت',
  downloadLanguagesToUseOffline: 'نزّل اللغات للترجمة دون إنترنت',
  download: 'تنزيل',
  downloading: 'جارٍ التنزيل…',
  downloadProgress: 'جارٍ التنزيل {percent}',
  waitingForWifi: 'بانتظار شبكة Wi-Fi',
  needsInternet: '{lang} تحتاج إلى اتصال بالإنترنت',
  signInForCloud: 'سجّل الدخول لاستخدام الترجمة السحابية لـ{lang}',
  detectFailed: 'تعذّر اكتشاف اللغة. اخترها بنفسك.',
  chooseLanguage: 'اختر اللغة',
  translateFrom: 'الترجمة من',
  translateTo: 'الترجمة إلى',
  languagePair: 'من {from} إلى {to}',
  search: 'بحث',
  noLanguagesFound: 'لا توجد لغات تطابق «{query}»',
  languageCount: {
    zero: 'لا توجد لغات',
    one: 'لغة واحدة',
    two: 'لغتان',
    few: '{count} لغات',
    many: '{count} لغةً',
    other: '{count} لغة',
  },
  recent: 'الأخيرة',
  allLanguages: 'كل اللغات',
  availableOffline: 'متاحة دون إنترنت',
  availableToDownload: 'متاحة للتنزيل',
  cloudOnly: 'سحابية فقط',
  downloaded: 'تم التنزيل',
  downloadedCount: {
    zero: 'لا توجد لغات منزّلة',
    one: 'لغة واحدة منزّلة',
    two: 'لغتان منزّلتان',
    few: '{count} لغات منزّلة',
    many: '{count} لغةً منزّلة',
    other: '{count} لغة منزّلة',
  },
  downloads: 'التنزيلات',
  offlineLanguages: 'لغات دون إنترنت',
  offlineLanguagesHint: 'اللغات المنزّلة تُترجم على هاتفك: سريعة ومجانية وخاصة. حوالي 30 ميغابايت لكل لغة.',
  onDeviceNeedsDevBuild: 'تتطلب الترجمة على الجهاز نسخة تطوير على جهاز حقيقي.',
  wifiOnly: 'التنزيل عبر Wi-Fi فقط',
  delete: 'حذف',
  downloadLanguage: 'تنزيل {lang}',
  deleteLanguage: 'حذف {lang}',
  deleteLanguageConfirm: 'هل تريد حذف {lang} من هذا الهاتف؟ يمكنك تنزيلها مجددًا في أي وقت.',
  dialect: 'اللهجة',
  speechDialectHint: 'تُستخدم عندما تتحدث وعند قراءة الترجمات بصوت عالٍ',
  automatic: 'تلقائي',
  dialectFor: 'اللهجة: {lang}',
  englishRequired: 'مطلوبة لكل ترجمة دون إنترنت',
  downloadingLanguage: 'جارٍ تنزيل {lang}',
  languageDownloaded: 'تم تنزيل {lang}',
  languageDeleted: 'تم حذف {lang}',
  cameraTitle: 'وجّه الكاميرا نحو النص',
  cameraHint: 'التقط صورة للافتة أو قائمة طعام أو صفحة',
  capture: 'التقاط',
  retake: 'إعادة الالتقاط',
  pickPhoto: 'اختيار صورة',
  readingText: 'جارٍ قراءة النص…',
  noTextFound: 'لم يُعثر على نص. اقترب أكثر أو حسّن الإضاءة.',
  cameraPermission: 'اسمح بالوصول إلى الكاميرا لترجمة النصوص من حولك.',
  allow: 'سماح',
  openSettings: 'فتح الإعدادات',
  original: 'الأصل',
  translation: 'الترجمة',
  captureFailed: 'تعذّر التقاط الصورة. حاول مرة أخرى.',
  cameraUnavailable: 'تعذّر تشغيل الكاميرا. أغلق التطبيقات الأخرى التي تستخدمها، أو اختر صورة بدلًا من ذلك.',
  talkTitle: 'محادثة',
  talkHint: 'يضغط كل شخص على جهته ويتحدث. تظهر الترجمة وتُقرأ بصوت عالٍ للطرف الآخر.',
  holdToTalk: 'اضغط وتحدث',
  autoSpeak: 'قراءة الترجمة بصوت عالٍ',
  micPermission: 'اسمح بالميكروفون والتعرّف على الكلام لتتحدث بدلًا من الكتابة.',
  talkReplayHint: 'يقرأ الرسالة بصوت عالٍ مرة أخرى.',
  talkStopReadingHint: 'يوقف القراءة بصوت عالٍ.',
  micBlocked: 'اسمح بالوصول إلى الميكروفون والتعرّف على الكلام من الإعدادات.',
  speechUnavailable: 'التعرّف على الكلام غير متاح على هذا الجهاز.',
  speechNotAllowed: 'التعرّف على الكلام معطّل على هذا الهاتف. فعّله من الإعدادات.',
  speechLanguageUnsupported: 'هذه اللغة غير مدعومة في التعرّف على الكلام على هذا الجهاز.',
  speechLanguageUnsupportedNamed: 'التعرّف على الكلام غير متاح للغة {lang} على هذا الجهاز. يمكنك الكتابة بدلًا من ذلك.',
  speechNoSpeech: 'لم نلتقط ما قلته. حاول مرة أخرى.',
  speechNetwork: 'يحتاج التعرّف على الكلام إلى اتصال بالإنترنت.',
  speechBusy: 'الميكروفون مشغول. حاول مرة أخرى بعد لحظات.',
  speechInterrupted: 'توقف الاستماع بسبب مكالمة أو تطبيق آخر.',
  speechAudio: 'تعذّر استخدام الميكروفون. حاول مرة أخرى.',
  speechTimeout: 'لم يبدأ الاستماع. حاول مرة أخرى.',
  speechError: 'تعذّر التعرّف على الكلام. حاول مرة أخرى.',
  filesTitle: 'ترجمة مستند',
  filesHint: 'ملفات Word وPDF والنصوص. تحتفظ ملفات Word بتنسيقها، وتُقرأ ملفات PDF على هاتفك وتُعاد كملفات Word.',
  chooseFile: 'اختيار ملف',
  chooseFileTitle: 'اختر ملف Word أو PDF أو ملفًا نصيًا',
  unsupportedFileType: 'نوع هذا الملف غير مدعوم. اختر ملف Word أو PDF أو ملفًا نصيًا.',
  fileTranslated: 'ملفك المترجم جاهز',
  saveOrShare: 'حفظ أو مشاركة',
  translateOnDevice: 'الترجمة على هذا الهاتف',
  translateInCloud: 'الترجمة السحابية',
  fileCost: {
    zero: 'مجانًا',
    one: 'حوالي رصيد واحد',
    two: 'حوالي رصيدين',
    few: 'حوالي {credits} أرصدة',
    many: 'حوالي {credits} رصيدًا',
    other: 'حوالي {credits} رصيد',
  },
  fileTooBig: 'هذا الملف كبير جدًا (الحد الأقصى 10 ميغابايت).',
  kilobytes: '{size} كيلوبايت',
  megabytes: '{size} ميغابايت',
  pdfUnavailable: 'قراءة ملفات PDF تتطلب النسخة الكاملة من التطبيق على هذا الجهاز.',
  pdfNoText: 'لم يُعثر على نص في ملف PDF هذا.',
  pdfLocked: 'ملف PDF هذا محمي بكلمة مرور. أزل كلمة المرور وحاول مرة أخرى.',
  readingDocument: 'جارٍ قراءة المستند…',
  fileSizeLimit: 'حتى {size}',
  chooseAnotherFile: 'اختيار ملف آخر',
  documentEmpty: 'لا يحتوي هذا الملف على نص لترجمته.',
  fileOfflineQualityNote: 'الترجمة على الجهاز ذات جودة أساسية. للمستندات المهمة، استخدم الترجمة السحابية.',
  translatingProgress: 'جارٍ الترجمة… {percent}',
  translatingInCloud: 'جارٍ الترجمة السحابية. قد تستغرق المستندات الطويلة دقيقة.',
  pdfPagesLimited: 'تُترجَم أول {count} صفحة فقط من ملف PDF هذا.',
  documentTooLongForPlan: 'هذا المستند أطول مما تسمح به خطتك (الحد الأقصى {max} حرف).',
  dictionary: 'القاموس',
  meanings: 'المعاني',
  noDefinitions: 'لا يوجد مدخل في القاموس.',
  dictionaryOffline: 'يحتاج القاموس إلى اتصال بالإنترنت.',
  dictionaryFailed: 'تعذّر تحميل مدخل القاموس هذا.',
  alsoUsedIn: 'تُستخدم أيضًا في',
  savedForOffline: 'محفوظ للاستخدام دون إنترنت',
  wordMissing: 'لا توجد كلمة للبحث عنها',
  history: 'السجل',
  historyEmpty: 'لا توجد ترجمات بعد',
  historyEmptyHint: 'ستظهر هنا الترجمات التي تجريها.',
  historyOff: 'حفظ السجل متوقف. فعّله من صفحة الحساب للاحتفاظ بترجماتك.',
  historyLoadFailed: 'تعذّر تحميل السجل.',
  historyOpenHint: 'يفتح هذه الترجمة مجددًا',
  historyCleared: 'تم مسح السجل',
  historyReset: 'تمت إعادة تعيين السجل على هذا الهاتف.',
  clearHistoryConfirm: 'هل تريد حذف كل الترجمات المحفوظة على هذا الهاتف؟ لا يمكن التراجع عن ذلك.',
  deleteTranslation: 'هل تريد حذف هذه الترجمة؟',
  historyItemDeleted: 'تم حذف الترجمة',
  signIn: 'تسجيل الدخول',
  signOut: 'تسجيل الخروج',
  signedOut: 'تم تسجيل الخروج',
  signInTitle: 'تسجيل الدخول إلى المترجم',
  signInSubtitle: 'يحفظ الحساب مشترياتك ورصيدك عبر أجهزتك. الترجمة دون إنترنت تعمل بدون حساب.',
  continueWithApple: 'المتابعة باستخدام Apple',
  continueWithGoogle: 'المتابعة باستخدام Google',
  continueWithEmail: 'المتابعة بالبريد الإلكتروني',
  email: 'البريد الإلكتروني',
  invalidEmail: 'أدخل عنوان بريد إلكتروني صالحًا.',
  password: 'كلمة المرور',
  emailCode: 'أرسل لي رمزًا',
  usePassword: 'استخدام كلمة مرور بدلًا من ذلك',
  useCode: 'استخدام رمز لمرة واحدة بدلًا من ذلك',
  enterCode: 'أدخل الرمز المكوّن من 6 أرقام المرسل إلى {email}',
  verificationCode: 'رمز التحقق',
  codeSent: 'تم إرسال الرمز. تحقّق من بريدك الإلكتروني.',
  resendCode: 'إعادة إرسال الرمز',
  resendIn: {
    zero: 'إعادة الإرسال الآن',
    one: 'إعادة الإرسال بعد ثانية واحدة',
    two: 'إعادة الإرسال بعد ثانيتين',
    few: 'إعادة الإرسال بعد {count} ثوانٍ',
    many: 'إعادة الإرسال بعد {count} ثانيةً',
    other: 'إعادة الإرسال بعد {count} ثانية',
  },
  verify: 'تحقق',
  createAccount: 'إنشاء حساب',
  name: 'الاسم',
  forgotPassword: 'نسيت كلمة المرور؟',
  newPassword: 'كلمة مرور جديدة',
  passwordHint: '10 أحرف على الأقل',
  showPassword: 'إظهار كلمة المرور',
  hidePassword: 'إخفاء كلمة المرور',
  resetPassword: 'إعادة تعيين كلمة المرور',
  haveAccount: 'لدي حساب بالفعل',
  noAccount: 'إنشاء حساب بكلمة مرور',
  signInFailed: 'تعذّر تسجيل الدخول. حاول مرة أخرى.',
  credits: 'الرصيد',
  plan: 'الخطة',
  freePlan: 'مجانية',
  creditsPlan: 'رصيد',
  passPlan: 'تصريح 3 ساعات',
  proPlan: 'برو',
  vipPlan: 'VIP',
  passActiveUntil: 'التصريح فعّال حتى {time}',
  passAlreadyActive: 'لديك تصريح فعّال بالفعل.',
  startPass: 'بدء تصريح 3 ساعات',
  passesAvailable: {
    zero: 'لا توجد تصاريح غير مستخدمة',
    one: 'تصريح واحد غير مستخدم',
    two: 'تصريحان غير مستخدمين',
    few: '{count} تصاريح غير مستخدمة',
    many: '{count} تصريحًا غير مستخدم',
    other: '{count} تصريح غير مستخدم',
  },
  renewsOn: 'يتجدد في {date}',
  endsOn: 'ينتهي في {date}',
  vipResets: 'يُعاد تعيينه كل يوم اثنين',
  upgrade: 'احصل على المزيد',
  purchases: 'المشتريات',
  restorePurchases: 'استعادة المشتريات',
  purchasesRestored: 'تمت استعادة المشتريات',
  nothingToRestore: 'لا توجد مشتريات لاستعادتها',
  updatingBalance: 'جارٍ تحديث الرصيد…',
  manageSubscription: 'إدارة الاشتراك',
  manageInStore: 'يمكنك إدارة اشتراكك من إعدادات App Store أو Google Play.',
  privacy: 'الخصوصية',
  privacyPolicy: 'سياسة الخصوصية',
  terms: 'شروط الاستخدام',
  saveHistory: 'الاحتفاظ بسجل الترجمة على هذا الهاتف',
  clearHistory: 'مسح السجل',
  exportData: 'تنزيل بياناتي',
  deleteAccount: 'حذف الحساب',
  deleteAccountConfirm:
    'سيؤدي هذا إلى حذف حسابك ورصيدك وتصاريحك نهائيًا. يجب إلغاء اشتراكات المتجر الفعّالة من إعدادات App Store أو Google Play. هل تريد المتابعة؟',
  deleteAccountReauth: 'لحماية حسابك، سجّل الدخول مرة أخرى ثم احذفه.',
  accountDeleted: 'تم حذف حسابك',
  appLock: 'طلب Face ID أو بصمة الإصبع',
  appLockOn: 'قفل التطبيق مفعّل',
  appLockOff: 'قفل التطبيق معطّل',
  biometricsUnavailable: 'فعّل Face ID أو Touch ID أو البصمة في إعدادات هاتفك أولًا.',
  unlock: 'فتح القفل',
  unlockPrompt: 'افتح قفل المترجم',
  unlockFailed: 'تعذّر التحقق من هويتك. حاول مرة أخرى.',
  biometricLockout: 'محاولات كثيرة جدًا. افتح قفل هاتفك برمز المرور ثم حاول مرة أخرى.',
  version: 'الإصدار {version}',
  plansTitle: 'أنجز المزيد بالترجمة السحابية',
  plansSubtitle: 'أفضل جودة لكل اللغات، والمستندات، ونصوص الكاميرا بأي خط.',
  subscriptions: 'الاشتراكات',
  weekly: 'أسبوعي',
  monthly: 'شهري',
  yearly: 'سنوي',
  creditPacks: 'باقات الرصيد',
  sessionPass: 'تصريح 3 ساعات',
  sessionPassHint: 'كل الميزات مفتوحة لمدة 3 ساعات. مثالي لرحلة أو اجتماع.',
  proFeatures: {
    zero: '{credits} رصيد يوميًا · المستندات · الكاميرا السحابية',
    one: 'رصيد واحد يوميًا · المستندات · الكاميرا السحابية',
    two: 'رصيدان يوميًا · المستندات · الكاميرا السحابية',
    few: '{credits} أرصدة يوميًا · المستندات · الكاميرا السحابية',
    many: '{credits} رصيدًا يوميًا · المستندات · الكاميرا السحابية',
    other: '{credits} رصيد يوميًا · المستندات · الكاميرا السحابية',
  },
  vipFeatures: {
    zero: '{credits} رصيد أسبوعيًا · أعلى الحدود · أولوية',
    one: 'رصيد واحد أسبوعيًا · أعلى الحدود · أولوية',
    two: 'رصيدان أسبوعيًا · أعلى الحدود · أولوية',
    few: '{credits} أرصدة أسبوعيًا · أعلى الحدود · أولوية',
    many: '{credits} رصيدًا أسبوعيًا · أعلى الحدود · أولوية',
    other: '{credits} رصيد أسبوعيًا · أعلى الحدود · أولوية',
  },
  buy: 'شراء',
  subscribe: 'اشترك',
  bestValue: 'أفضل قيمة',
  priceUnavailable: 'السعر غير متاح',
  purchasesUnavailable: 'المشتريات غير متاحة على هذا الجهاز.',
  purchaseComplete: 'تمت عملية الشراء. شكرًا لك!',
  cancel: 'إلغاء',
  done: 'تم',
  ok: 'حسنًا',
  retry: 'حاول مرة أخرى',
  close: 'إغلاق',
  continue: 'متابعة',
  back: 'رجوع',
  next: 'التالي',
  loading: 'جارٍ التحميل…',
  error: 'حدث خطأ ما',
  offline: 'أنت غير متصل بالإنترنت',
  notEnoughCredits: 'الرصيد غير كافٍ',
  getCredits: 'احصل على رصيد',
  errorNetwork: 'تعذّر الاتصال. تحقّق من اتصالك بالإنترنت وحاول مرة أخرى.',
  errorTimeout: 'استغرق الأمر وقتًا طويلًا. حاول مرة أخرى.',
  errorBadRequest: 'تعذّرت معالجة الطلب. تحقّق منه وحاول مرة أخرى.',
  errorUnauthorized: 'انتهت جلستك. سجّل الدخول مجددًا للمتابعة.',
  errorForbidden: 'لا يمكن لهذا الحساب تنفيذ ذلك. تواصل مع الدعم إذا بدا لك هذا خطأً.',
  errorNotFound: 'لم يعد هذا متاحًا.',
  errorRateLimited: 'طلبات كثيرة جدًا. انتظر قليلًا ثم حاول مرة أخرى.',
  errorTooLarge: 'هذا أكبر من أن يُترجم. جرّب نصًا أقصر أو ملفًا أصغر.',
  errorServicePaused: 'الترجمة السحابية متوقفة مؤقتًا. الترجمة على الجهاز ما زالت تعمل.',
  errorUpstream: 'تواجه خدمة الترجمة مشكلة. حاول مرة أخرى بعد قليل.',
  errorInternal: 'حدث خطأ من جهتنا. حاول مرة أخرى بعد قليل.',
  errorDownloadFailed: 'تعذّر تنزيل {lang}. تحقّق من اتصالك وحاول مرة أخرى.',
  errorDeleteFailed: 'تعذّرت إزالة {lang}. حاول مرة أخرى.',
  errorBadImage: 'تعذّر فتح هذه الصورة. جرّب صورة أخرى.',
  errorBadPdf: 'تعذّر فتح ملف PDF هذا. قد يكون تالفًا.',
  errorBadDocument: 'تعذّرت قراءة هذا الملف. تأكّد من أنه ملف Word أو PDF أو ملف نصي.',
  errorDocumentTooComplex: 'هذا المستند كبير أو معقّد جدًا ولا يمكن ترجمته.',
  errorOnDeviceUnavailable: 'الترجمة على الجهاز غير متاحة هنا. استخدم الترجمة السحابية بدلًا منها.',
  errorTranslateFailed: 'تعذّرت الترجمة. حاول مرة أخرى.',
  errorOcrFailed: 'تعذّرت قراءة النص في هذه الصورة. حاول مرة أخرى.',
  errorOcrUnavailable: 'لا تزال ميزة التعرّف على النص قيد الإعداد على هذا الهاتف. حاول مرة أخرى بعد دقيقة.',
  errorUnsupportedLanguage: 'لا يمكن ترجمة {lang} على هذا الجهاز.',
  errorInvalidCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  errorInvalidCode: 'الرمز غير صحيح. تحقّق منه وحاول مرة أخرى.',
  errorCodeExpired: 'انتهت صلاحية هذا الرمز. اطلب رمزًا جديدًا.',
  errorTooManyAttempts: 'محاولات كثيرة جدًا. اطلب رمزًا جديدًا وحاول مرة أخرى.',
  errorUserExists: 'يوجد حساب بهذا البريد الإلكتروني بالفعل. سجّل الدخول بدلًا من ذلك.',
  errorPasswordTooShort: 'يجب ألا تقل كلمة المرور عن 10 أحرف.',
  errorPasswordTooLong: 'كلمة المرور هذه طويلة جدًا.',
  errorEmailNotVerified: 'أكّد عنوان بريدك الإلكتروني أولًا.',
  errorPlayServices: 'خدمات Google Play غير متاحة على هذا الجهاز.',
  errorPaymentPending: 'دفعتك قيد المعالجة. سيُضاف الرصيد عند إتمامها.',
  errorStoreProblem: 'حدثت مشكلة في App Store أو Google Play. حاول مرة أخرى لاحقًا.',
  errorPurchaseNotAllowed: 'المشتريات معطّلة على هذا الجهاز.',
  errorAlreadyOwned: 'أنت تملك هذا بالفعل. اضغط «استعادة المشتريات».',
  errorReceiptInUse: 'هذا الشراء مرتبط بحساب آخر. سجّل الدخول بذلك الحساب لاستخدامه.',
  errorProductUnavailable: 'هذا العنصر غير متاح حاليًا.',
  errorPurchaseInProgress: 'هناك عملية شراء قيد التنفيذ. انتظر قليلًا.',
  purchaseSignInRequired: 'سجّل الدخول للشراء أو لاستعادة المشتريات، لتبقى مرتبطة بحسابك.',
};

/* ------------------------------------------------------------------ interface language */

export type UiLanguage = 'en' | 'ar';

/** First English or Arabic entry in the phone's language list; English when there is none. */
export function resolveUiLanguage(locales: readonly Pick<Locale, 'languageCode' | 'languageTag'>[]): UiLanguage {
  for (const l of locales) {
    const code = (l.languageCode ?? l.languageTag.split(/[-_]/)[0] ?? '').toLowerCase();
    if (code === 'ar' || code === 'en') return code;
  }
  return 'en';
}

function deviceLocales(): Locale[] {
  try {
    return getLocales();
  } catch {
    return [];
  }
}

const locales = deviceLocales();
export const uiLanguage: UiLanguage = resolveUiLanguage(locales);
export const uiDirection: 'rtl' | 'ltr' = uiLanguage === 'ar' ? 'rtl' : 'ltr';

/* ------------------------------------------------------------------ Android direction safety net */

const RELOAD_MARKER = 'layout-direction-reload.json';
const RELOAD_WINDOW_MS = 60_000;

/**
 * Records that we are about to reload for `rtl`. Refuses (so we never loop) when the previous
 * launch already reloaded for the same direction and it still did not take effect.
 */
function claimDirectionReload(rtl: boolean): boolean {
  try {
    const marker = new File(Paths.cache, RELOAD_MARKER);
    if (marker.exists) {
      let last: { rtl?: unknown; at?: unknown; gaveUp?: unknown } = {};
      try {
        last = JSON.parse(marker.textSync()) as typeof last;
      } catch {
        // Unreadable marker: treat it as absent.
      }
      const recent = typeof last.at === 'number' && Date.now() - last.at < RELOAD_WINDOW_MS;
      if (last.rtl === rtl && (last.gaveUp === true || recent)) {
        marker.write(JSON.stringify({ rtl, at: Date.now(), gaveUp: true }));
        return false;
      }
    } else {
      marker.create();
    }
    marker.write(JSON.stringify({ rtl, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/**
 * React Native on Android takes the layout direction from flags saved by I18nManager, not from
 * the app language (the with-android-rtl config plugin syncs them before React starts). If they
 * still disagree with the interface language, fix the flags and reload once.
 */
function syncAndroidDirection(): boolean {
  if (Platform.OS !== 'android') return false;
  const wantRtl = uiLanguage === 'ar';
  if (I18nManager.isRTL === wantRtl) return false;
  try {
    I18nManager.allowRTL(wantRtl);
    I18nManager.forceRTL(wantRtl);
  } catch {
    return false;
  }
  if (!claimDirectionReload(wantRtl)) return false;
  reloadAppAsync('Layout direction changed').catch(() => {});
  return true;
}

/** True while the app is about to reload to fix the layout direction: render nothing meanwhile. */
export const directionReloadPending = syncAndroidDirection();

if (__DEV__ && !directionReloadPending && I18nManager.isRTL !== (uiLanguage === 'ar')) {
  console.warn(`Layout direction (${I18nManager.isRTL ? 'rtl' : 'ltr'}) does not match the interface language (${uiLanguage}).`);
}

/**
 * Reloads the app when a change to the phone's languages changes the interface language.
 * Android keeps the activity alive on locale changes, so strings and layout direction would
 * otherwise stay stale until the next launch. Call once from the root layout.
 */
export function useReloadOnLanguageChange(): void {
  const next = resolveUiLanguage(useLocales());
  useEffect(() => {
    if (next !== uiLanguage) reloadAppAsync('Interface language changed').catch(() => {});
  }, [next]);
}

/* ------------------------------------------------------------------ strings */

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
type Vars = Record<string, string | number>;

/** CLDR plural category for a count (no Intl.PluralRules: Hermes doesn't guarantee it). */
export function pluralCategory(n: number, lang: UiLanguage = uiLanguage): PluralCategory {
  const abs = Math.abs(n);
  if (!Number.isFinite(abs) || !Number.isInteger(abs)) return 'other';
  if (lang === 'ar') {
    const m = abs % 100;
    if (abs === 0) return 'zero';
    if (abs === 1) return 'one';
    if (abs === 2) return 'two';
    if (m >= 3 && m <= 10) return 'few';
    if (m >= 11 && m <= 99) return 'many';
    return 'other';
  }
  return abs === 1 ? 'one' : 'other';
}

/** The count that picks the plural form: `count`, else the first numeric variable. */
function countOf(vars: Vars | undefined): number | undefined {
  if (!vars) return undefined;
  const values = 'count' in vars ? [vars.count] : Object.values(vars);
  for (const v of values) {
    if (typeof v === 'number') return v;
    // Callers that pre-formatted the number ("1,000").
    const digits = typeof v === 'string' ? toLatinDigits(v).replace(/[,\s\u00a0\u202f']/g, '') : '';
    if (/^\d+(\.\d+)?$/.test(digits)) return Number(digits);
  }
  return undefined;
}

function pick(entry: string | EnPlural | ArPlural, vars: Vars | undefined, lang: UiLanguage): string {
  if (typeof entry === 'string') return entry;
  const n = countOf(vars);
  if (n === undefined) return entry.other;
  if (lang === 'ar' && 'few' in entry) return entry[pluralCategory(n, 'ar')];
  if (n === 0 && entry.zero !== undefined) return entry.zero;
  return n === 1 ? entry.one : entry.other;
}

// Unicode isolates keep an interpolated value (an email, an English name, a number) from
// reordering the sentence around it; the leading RLM makes an Arabic string that starts with
// a Latin word ("VIP · شهري") lay out right to left on Android as well.
const FSI = '\u2068';
const PDI = '\u2069';
const RLM = '\u200f';

function fill(template: string, vars: Vars | undefined, lang: UiLanguage): string {
  let s = template;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      const value = typeof v === 'number' ? formatNumber(v) : v;
      s = s.split(`{${k}}`).join(FSI + value + PDI);
    }
  }
  return lang === 'ar' ? RLM + s : s;
}

function lookup(lang: UiLanguage, key: StringKey): string | EnPlural | ArPlural {
  return (lang === 'ar' ? ar[key] : undefined) ?? en[key];
}

/**
 * Interface string with {placeholders} filled in. Numbers are formatted for the interface
 * language. For plural keys the form follows `count` (or the first numeric variable).
 */
export function t(key: StringKey, vars?: Vars): string {
  return fill(pick(lookup(uiLanguage, key), vars, uiLanguage), vars, uiLanguage);
}

/** Counted string: tn('creditCount', 3) → "3 credits" / "3 أرصدة". */
export function tn(key: CountKey, count: number, vars?: Vars): string {
  return t(key, { count, ...vars });
}

/**
 * The same string in another interface language, for text shown to the other person in Talk.
 * Null when that language has no interface strings (anything but English and Arabic).
 */
export function tFor(language: string, key: StringKey, vars?: Vars): string | null {
  const lang = language === 'ar' || language === 'en' ? language : null;
  return lang ? fill(pick(lookup(lang, key), vars, lang), vars, lang) : null;
}

/* ------------------------------------------------------------------ numbers, dates and lists */

/** Western digits in both languages, so numbers look the same on iOS and Android. */
const NUMBER_LOCALE = uiLanguage === 'ar' ? 'ar-u-nu-latn' : 'en-US';

/** Arabic-Indic digits and separators to their Western forms (some engines ignore -u-nu-latn). */
function toLatinDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066c/g, ',')
    .replace(/\u066b/g, '.');
}

const numberFormats = new Map<number, Intl.NumberFormat | null>();

function numberFormat(maximumFractionDigits: number): Intl.NumberFormat | null {
  if (!numberFormats.has(maximumFractionDigits)) {
    let f: Intl.NumberFormat | null = null;
    try {
      f = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits });
    } catch {
      // No Intl: group by hand below.
    }
    numberFormats.set(maximumFractionDigits, f);
  }
  return numberFormats.get(maximumFractionDigits) ?? null;
}

/** 1234.5 → "1,234.5" in both interface languages, whatever the phone's region is. */
export function formatNumber(n: number, maximumFractionDigits = 2): string {
  if (!Number.isFinite(n)) return '';
  const f = numberFormat(maximumFractionDigits);
  if (f) return toLatinDigits(f.format(n));
  const [int = '0', frac] = (Math.round(n * 10 ** maximumFractionDigits) / 10 ** maximumFractionDigits).toString().split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
}

/** 0.42 → "42%". */
export function formatPercent(fraction: number): string {
  return `${formatNumber(Math.round(Math.min(1, Math.max(0, fraction)) * 100), 0)}%`;
}

/** File size: "840 KB" / "2.4 MB" (localized unit). */
export function formatFileSize(bytes: number): string {
  const kb = Math.max(0, bytes) / 1024;
  if (kb < 1024) return t('kilobytes', { size: formatNumber(Math.max(1, Math.round(kb)), 0) });
  return t('megabytes', { size: formatNumber(kb / 1024, 1) });
}

/** English dates follow the phone's English region (en-GB: "11 Oct 2026"); Arabic is fixed. */
function englishDateLocale(): string {
  const tag = locales.find((l) => l.languageCode === 'en')?.languageTag;
  try {
    return (tag && Intl.DateTimeFormat.supportedLocalesOf([tag])[0]) || 'en-US';
  } catch {
    return 'en-US';
  }
}

const DATE_LOCALE = uiLanguage === 'ar' ? 'ar-u-nu-latn' : englishDateLocale();

function uses24hourClock(): boolean | undefined {
  try {
    return getCalendars()[0]?.uses24hourClock ?? undefined;
  } catch {
    return undefined;
  }
}
const USES_24H = uses24hourClock();
const HOUR12 = USES_24H === undefined ? undefined : !USES_24H;

const dateFormats = new Map<string, Intl.DateTimeFormat | null>();

function dateFormat(kind: 'date' | 'dateTime' | 'time'): Intl.DateTimeFormat | null {
  if (!dateFormats.has(kind)) {
    const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', ...(HOUR12 === undefined ? {} : { hour12: HOUR12 }) };
    const options: Intl.DateTimeFormatOptions =
      kind === 'date'
        ? { day: 'numeric', month: 'short', year: 'numeric' }
        : kind === 'dateTime'
          ? { day: 'numeric', month: 'short', ...time }
          : time;
    let f: Intl.DateTimeFormat | null = null;
    try {
      f = new Intl.DateTimeFormat(DATE_LOCALE, options);
    } catch {
      // Handled by the caller.
    }
    dateFormats.set(kind, f);
  }
  return dateFormats.get(kind) ?? null;
}

function toDate(value: string | number | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatWith(kind: 'date' | 'dateTime' | 'time', value: string | number | Date): string {
  const d = toDate(value);
  if (!d) return '';
  const f = dateFormat(kind);
  try {
    return toLatinDigits(f ? f.format(d) : d.toLocaleString());
  } catch {
    return d.toISOString().slice(0, kind === 'time' ? 16 : 10);
  }
}

/** "11 Oct 2026", or "11 Oct, 5:07 PM" with the time. */
export function formatDate(value: string | number | Date, withTime = false): string {
  return formatWith(withTime ? 'dateTime' : 'date', value);
}

/** "5:07 PM" (or 24-hour when the phone uses it). */
export function formatTime(value: string | number | Date): string {
  return formatWith('time', value);
}

/** "French, German and Italian" / "الفرنسية والألمانية والإيطالية". */
export function formatList(items: readonly string[], type: 'and' | 'or' = 'and'): string {
  const list = items.filter((s) => s.length > 0);
  if (list.length <= 1) return list[0] ?? '';
  const head = list.slice(0, -1);
  const last = list[list.length - 1]!;
  if (uiLanguage === 'ar') {
    const joiner = type === 'and' ? 'و' : 'أو ';
    return list.length === 2 ? `${head[0]} ${joiner}${last}` : `${head.join('، ')}، ${joiner}${last}`;
  }
  const word = type === 'and' ? 'and' : 'or';
  return list.length === 2 ? `${head[0]} ${word} ${last}` : `${head.join(', ')}, ${word} ${last}`;
}

/* ------------------------------------------------------------------ language and region names */

/**
 * A language's name in the interface language. Arabic names ship with the language list
 * (Hermes has no Intl.DisplayNames); unknown codes fall back to the English name or the code.
 */
export function languageName(code: string, englishName?: string): string {
  if (code === 'auto') return t('detect');
  const l = getLanguage(code);
  if (uiLanguage === 'ar' && l) return l.nameAr;
  return englishName ?? l?.name ?? code;
}

/** Regions that appear in speech locales (the dialect picker): [English, Arabic]. */
const REGIONS: Record<string, readonly [string, string]> = {
  AE: ['UAE', 'الإمارات'],
  AR: ['Argentina', 'الأرجنتين'],
  AT: ['Austria', 'النمسا'],
  AU: ['Australia', 'أستراليا'],
  BD: ['Bangladesh', 'بنغلاديش'],
  BE: ['Belgium', 'بلجيكا'],
  BH: ['Bahrain', 'البحرين'],
  BO: ['Bolivia', 'بوليفيا'],
  BR: ['Brazil', 'البرازيل'],
  CA: ['Canada', 'كندا'],
  CH: ['Switzerland', 'سويسرا'],
  CL: ['Chile', 'تشيلي'],
  CN: ['China', 'الصين'],
  CO: ['Colombia', 'كولومبيا'],
  CR: ['Costa Rica', 'كوستاريكا'],
  CZ: ['Czechia', 'التشيك'],
  DE: ['Germany', 'ألمانيا'],
  DK: ['Denmark', 'الدنمارك'],
  DO: ['Dominican Republic', 'جمهورية الدومينيكان'],
  DZ: ['Algeria', 'الجزائر'],
  EC: ['Ecuador', 'الإكوادور'],
  EG: ['Egypt', 'مصر'],
  ES: ['Spain', 'إسبانيا'],
  FI: ['Finland', 'فنلندا'],
  FR: ['France', 'فرنسا'],
  GB: ['UK', 'المملكة المتحدة'],
  GH: ['Ghana', 'غانا'],
  GR: ['Greece', 'اليونان'],
  GT: ['Guatemala', 'غواتيمالا'],
  HK: ['Hong Kong', 'هونغ كونغ'],
  HN: ['Honduras', 'هندوراس'],
  HR: ['Croatia', 'كرواتيا'],
  HU: ['Hungary', 'المجر'],
  ID: ['Indonesia', 'إندونيسيا'],
  IE: ['Ireland', 'أيرلندا'],
  IL: ['Israel', 'إسرائيل'],
  IN: ['India', 'الهند'],
  IQ: ['Iraq', 'العراق'],
  IT: ['Italy', 'إيطاليا'],
  JO: ['Jordan', 'الأردن'],
  JP: ['Japan', 'اليابان'],
  KE: ['Kenya', 'كينيا'],
  KR: ['South Korea', 'كوريا الجنوبية'],
  KW: ['Kuwait', 'الكويت'],
  LB: ['Lebanon', 'لبنان'],
  LK: ['Sri Lanka', 'سريلانكا'],
  LY: ['Libya', 'ليبيا'],
  MA: ['Morocco', 'المغرب'],
  MX: ['Mexico', 'المكسيك'],
  MY: ['Malaysia', 'ماليزيا'],
  NG: ['Nigeria', 'نيجيريا'],
  NI: ['Nicaragua', 'نيكاراغوا'],
  NL: ['Netherlands', 'هولندا'],
  NO: ['Norway', 'النرويج'],
  NZ: ['New Zealand', 'نيوزيلندا'],
  OM: ['Oman', 'عُمان'],
  PA: ['Panama', 'بنما'],
  PE: ['Peru', 'بيرو'],
  PH: ['Philippines', 'الفلبين'],
  PK: ['Pakistan', 'باكستان'],
  PL: ['Poland', 'بولندا'],
  PR: ['Puerto Rico', 'بورتوريكو'],
  PS: ['Palestine', 'فلسطين'],
  PT: ['Portugal', 'البرتغال'],
  PY: ['Paraguay', 'باراغواي'],
  QA: ['Qatar', 'قطر'],
  RO: ['Romania', 'رومانيا'],
  RU: ['Russia', 'روسيا'],
  SA: ['Saudi Arabia', 'السعودية'],
  SD: ['Sudan', 'السودان'],
  SE: ['Sweden', 'السويد'],
  SG: ['Singapore', 'سنغافورة'],
  SK: ['Slovakia', 'سلوفاكيا'],
  SV: ['El Salvador', 'السلفادور'],
  SY: ['Syria', 'سوريا'],
  TH: ['Thailand', 'تايلاند'],
  TN: ['Tunisia', 'تونس'],
  TR: ['Türkiye', 'تركيا'],
  TW: ['Taiwan', 'تايوان'],
  TZ: ['Tanzania', 'تنزانيا'],
  UA: ['Ukraine', 'أوكرانيا'],
  US: ['US', 'الولايات المتحدة'],
  UY: ['Uruguay', 'الأوروغواي'],
  VE: ['Venezuela', 'فنزويلا'],
  VN: ['Vietnam', 'فيتنام'],
  YE: ['Yemen', 'اليمن'],
  ZA: ['South Africa', 'جنوب أفريقيا'],
  '419': ['Latin America', 'أمريكا اللاتينية'],
};

/** Speech-service language subtags that differ from ours. */
const SPEECH_LANGUAGE_ALIASES: Record<string, string> = { cmn: 'zh', fil: 'tl', nb: 'no', iw: 'he', in: 'id' };
const CANTONESE: readonly [string, string] = ['Cantonese', 'الكانتونية'];

/** Country or region name for a region code ("EG", "419"), in the interface language. */
export function regionName(code: string): string {
  const r = REGIONS[code.toUpperCase()];
  return r ? r[uiLanguage === 'ar' ? 1 : 0] : code.toUpperCase();
}

/**
 * A speech locale for the dialect picker: "ar-EG" → "Arabic (Egypt)" / "العربية (مصر)",
 * "cmn-Hans-CN" → "Chinese (Simplified) (China)". Unknown parts are shown as written.
 */
export function localeName(tag: string): string {
  if (getLanguage(tag)) return languageName(tag);
  const [first = tag, ...rest] = tag.split(/[-_]/);
  const lang = first.toLowerCase();
  const region = rest.find((p) => /^([a-z]{2}|\d{3})$/i.test(p));
  const name =
    lang === 'yue' ? CANTONESE[uiLanguage === 'ar' ? 1 : 0] : languageName(SPEECH_LANGUAGE_ALIASES[lang] ?? lang);
  return region ? `${name} (${regionName(region)})` : name;
}

/** Wiktionary part-of-speech headings in Arabic (English stays as Wiktionary writes it). */
const PARTS_OF_SPEECH_AR: Record<string, string> = {
  noun: 'اسم',
  'proper noun': 'اسم علم',
  verb: 'فعل',
  adjective: 'صفة',
  adverb: 'ظرف',
  pronoun: 'ضمير',
  preposition: 'حرف جر',
  postposition: 'أداة لاحقة',
  conjunction: 'حرف عطف',
  interjection: 'تعجّب',
  particle: 'أداة',
  numeral: 'عدد',
  number: 'عدد',
  determiner: 'محدِّد',
  article: 'أداة تعريف',
  participle: 'اسم مشتق',
  phrase: 'عبارة',
  'prepositional phrase': 'شبه جملة',
  idiom: 'تعبير اصطلاحي',
  proverb: 'مَثَل',
  prefix: 'سابقة',
  suffix: 'لاحقة',
  affix: 'لاصقة',
  abbreviation: 'اختصار',
  initialism: 'اختصار',
  acronym: 'اختصار',
  contraction: 'صيغة مختصرة',
  symbol: 'رمز',
  letter: 'حرف',
  classifier: 'مصنِّف',
  counter: 'مصنِّف',
  root: 'جذر',
  'punctuation mark': 'علامة ترقيم',
  'diacritical mark': 'علامة تشكيل',
};

export function partOfSpeechLabel(pos: string | null | undefined): string {
  const p = (pos ?? '').trim();
  if (uiLanguage !== 'ar') return p;
  return PARTS_OF_SPEECH_AR[p.toLowerCase()] ?? p;
}

/** Wiktionary language headings for dialects and close relatives, in Arabic. */
const DIALECTS_AR: Record<string, string> = {
  arabic: 'العربية الفصحى',
  'egyptian arabic': 'اللهجة المصرية',
  'levantine arabic': 'اللهجة الشامية',
  'north levantine arabic': 'اللهجة الشامية الشمالية',
  'south levantine arabic': 'اللهجة الشامية الجنوبية',
  'gulf arabic': 'اللهجة الخليجية',
  'hijazi arabic': 'اللهجة الحجازية',
  'najdi arabic': 'اللهجة النجدية',
  'iraqi arabic': 'اللهجة العراقية',
  'mesopotamian arabic': 'اللهجة العراقية',
  'bahrani arabic': 'اللهجة البحرانية',
  'omani arabic': 'اللهجة العُمانية',
  'yemeni arabic': 'اللهجة اليمنية',
  'sanaani arabic': 'اللهجة الصنعانية',
  'hadrami arabic': 'اللهجة الحضرمية',
  'sudanese arabic': 'اللهجة السودانية',
  'chadian arabic': 'اللهجة التشادية',
  'libyan arabic': 'اللهجة الليبية',
  'tunisian arabic': 'اللهجة التونسية',
  'algerian arabic': 'اللهجة الجزائرية',
  'moroccan arabic': 'اللهجة المغربية',
  'hassaniya arabic': 'اللهجة الحسانية',
  'cypriot arabic': 'العربية القبرصية',
  'juba arabic': 'عربي جوبا',
  maltese: 'المالطية',
  'serbo-croatian': 'الصربية الكرواتية',
  slovene: 'السلوفينية',
  'norwegian bokmål': 'النرويجية (بوكمول)',
  'norwegian nynorsk': 'النرويجية (نينوشك)',
  'northern kurdish': 'الكردية الشمالية',
  'central kurdish': 'الكردية الوسطى',
  dari: 'الدرية',
  cantonese: 'الكانتونية',
  mandarin: 'الماندرينية',
  manipuri: 'المانيبورية',
};

/**
 * A dictionary entry's dialect or related-language heading ("South Levantine Arabic"). The shared
 * dictionary table wins, so the word sheet's dialect chips and headings never use different names.
 */
export function dialectName(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (uiLanguage !== 'ar') return n;
  return DIALECT_NAMES_AR[n] ?? DIALECTS_AR[n.toLowerCase()] ?? n;
}

/* ------------------------------------------------------------------ sorting and search */

/**
 * Folds text for matching: case, Latin accents, Arabic short vowels and tatweel, and the
 * hamza/alef, ya/alef maqsura and ta marbuta variants people type interchangeably.
 */
export function normalizeSearch(text: string): string {
  let s = text.toLowerCase();
  try {
    s = s.normalize('NFKD');
  } catch {
    // normalize() missing: the replacements below still cover Arabic.
  }
  return s
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/[\u0649\u06cc]/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064a')
    .replace(/\u06a9/g, '\u0643')
    .replace(/[\u200c-\u200f\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when every word of the query appears in one of the fields (after normalizeSearch). */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.filter((f): f is string => !!f).map(normalizeSearch);
  return words.every((w) => haystack.some((h) => h.includes(w)));
}

let collator: Intl.Collator | null = null;
try {
  collator = new Intl.Collator(uiLanguage, { sensitivity: 'base', numeric: true });
} catch {
  // Plain code-point order below.
}

/** Compares two strings in the interface language's alphabetical order. */
export function compareText(a: string, b: string): number {
  const fa = normalizeSearch(a);
  const fb = normalizeSearch(b);
  if (collator) return collator.compare(fa, fb) || collator.compare(a, b);
  return fa < fb ? -1 : fa > fb ? 1 : 0;
}

/** A sorted copy, alphabetical in the interface language: sortByText(langs, (l) => l.label). */
export function sortByText<T>(items: readonly T[], text: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, key: text(item) }))
    .sort((a, b) => compareText(a.key, b.key))
    .map((x) => x.item);
}
