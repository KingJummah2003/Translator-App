/**
 * Every language the app offers.
 *
 * offline  Google ML Kit has an on-device model (≈30 MB download, works without internet).
 * ocr      Script the on-device camera text recognizer can read. Languages without one
 *          fall back to cloud OCR (for example Arabic, Persian, Hebrew, Thai).
 * rtl      Written right to left; the UI mirrors text alignment for these.
 *
 * Codes follow the cloud provider (BCP-47 / Google Translate). The API can return a
 * longer live list; this file is the offline-safe fallback.
 */

export type OcrScript = 'latin' | 'chinese' | 'devanagari' | 'japanese' | 'korean';

export interface Language {
  code: string;
  name: string;
  native: string;
  offline: boolean;
  rtl?: boolean;
  ocr?: OcrScript;
  /** Locale for speech recognition / text-to-speech when it differs from `code`. */
  speech?: string;
}

const L = (
  code: string,
  name: string,
  native: string,
  offline: boolean,
  extra: Partial<Pick<Language, 'rtl' | 'ocr' | 'speech'>> = {},
): Language => ({ code, name, native, offline, ...extra });

export const LANGUAGES: readonly Language[] = [
  L('af', 'Afrikaans', 'Afrikaans', true, { ocr: 'latin', speech: 'af-ZA' }),
  L('sq', 'Albanian', 'Shqip', true, { ocr: 'latin', speech: 'sq-AL' }),
  L('am', 'Amharic', 'አማርኛ', false, { speech: 'am-ET' }),
  L('ar', 'Arabic', 'العربية', true, { rtl: true, speech: 'ar-SA' }),
  L('hy', 'Armenian', 'Հայերեն', false, { speech: 'hy-AM' }),
  L('as', 'Assamese', 'অসমীয়া', false),
  L('ay', 'Aymara', 'Aymar aru', false, { ocr: 'latin' }),
  L('az', 'Azerbaijani', 'Azərbaycan', false, { ocr: 'latin', speech: 'az-AZ' }),
  L('bm', 'Bambara', 'Bamanankan', false, { ocr: 'latin' }),
  L('eu', 'Basque', 'Euskara', false, { ocr: 'latin', speech: 'eu-ES' }),
  L('be', 'Belarusian', 'Беларуская', true, { speech: 'be-BY' }),
  L('bn', 'Bengali', 'বাংলা', true, { speech: 'bn-BD' }),
  L('bho', 'Bhojpuri', 'भोजपुरी', false, { ocr: 'devanagari' }),
  L('bs', 'Bosnian', 'Bosanski', false, { ocr: 'latin', speech: 'bs-BA' }),
  L('bg', 'Bulgarian', 'Български', true, { speech: 'bg-BG' }),
  L('my', 'Burmese', 'မြန်မာ', false, { speech: 'my-MM' }),
  L('ca', 'Catalan', 'Català', true, { ocr: 'latin', speech: 'ca-ES' }),
  L('ceb', 'Cebuano', 'Cebuano', false, { ocr: 'latin' }),
  L('ny', 'Chichewa', 'Chichewa', false, { ocr: 'latin' }),
  L('zh', 'Chinese (Simplified)', '简体中文', true, { ocr: 'chinese', speech: 'zh-CN' }),
  L('zh-TW', 'Chinese (Traditional)', '繁體中文', false, { ocr: 'chinese', speech: 'zh-TW' }),
  L('co', 'Corsican', 'Corsu', false, { ocr: 'latin' }),
  L('hr', 'Croatian', 'Hrvatski', true, { ocr: 'latin', speech: 'hr-HR' }),
  L('cs', 'Czech', 'Čeština', true, { ocr: 'latin', speech: 'cs-CZ' }),
  L('da', 'Danish', 'Dansk', true, { ocr: 'latin', speech: 'da-DK' }),
  L('dv', 'Dhivehi', 'ދިވެހި', false, { rtl: true }),
  L('doi', 'Dogri', 'डोगरी', false, { ocr: 'devanagari' }),
  L('nl', 'Dutch', 'Nederlands', true, { ocr: 'latin', speech: 'nl-NL' }),
  L('en', 'English', 'English', true, { ocr: 'latin', speech: 'en-US' }),
  L('eo', 'Esperanto', 'Esperanto', true, { ocr: 'latin' }),
  L('et', 'Estonian', 'Eesti', true, { ocr: 'latin', speech: 'et-EE' }),
  L('ee', 'Ewe', 'Eʋegbe', false, { ocr: 'latin' }),
  L('tl', 'Filipino', 'Filipino', true, { ocr: 'latin', speech: 'fil-PH' }),
  L('fi', 'Finnish', 'Suomi', true, { ocr: 'latin', speech: 'fi-FI' }),
  L('fr', 'French', 'Français', true, { ocr: 'latin', speech: 'fr-FR' }),
  L('fy', 'Frisian', 'Frysk', false, { ocr: 'latin' }),
  L('gl', 'Galician', 'Galego', true, { ocr: 'latin', speech: 'gl-ES' }),
  L('ka', 'Georgian', 'ქართული', true, { speech: 'ka-GE' }),
  L('de', 'German', 'Deutsch', true, { ocr: 'latin', speech: 'de-DE' }),
  L('el', 'Greek', 'Ελληνικά', true, { speech: 'el-GR' }),
  L('gn', 'Guarani', "Avañe'ẽ", false, { ocr: 'latin' }),
  L('gu', 'Gujarati', 'ગુજરાતી', true, { speech: 'gu-IN' }),
  L('ht', 'Haitian Creole', 'Kreyòl ayisyen', true, { ocr: 'latin' }),
  L('ha', 'Hausa', 'Hausa', false, { ocr: 'latin' }),
  L('haw', 'Hawaiian', 'ʻŌlelo Hawaiʻi', false, { ocr: 'latin' }),
  L('he', 'Hebrew', 'עברית', true, { rtl: true, speech: 'he-IL' }),
  L('hi', 'Hindi', 'हिन्दी', true, { ocr: 'devanagari', speech: 'hi-IN' }),
  L('hmn', 'Hmong', 'Hmoob', false, { ocr: 'latin' }),
  L('hu', 'Hungarian', 'Magyar', true, { ocr: 'latin', speech: 'hu-HU' }),
  L('is', 'Icelandic', 'Íslenska', true, { ocr: 'latin', speech: 'is-IS' }),
  L('ig', 'Igbo', 'Igbo', false, { ocr: 'latin' }),
  L('ilo', 'Ilocano', 'Ilokano', false, { ocr: 'latin' }),
  L('id', 'Indonesian', 'Bahasa Indonesia', true, { ocr: 'latin', speech: 'id-ID' }),
  L('ga', 'Irish', 'Gaeilge', true, { ocr: 'latin', speech: 'ga-IE' }),
  L('it', 'Italian', 'Italiano', true, { ocr: 'latin', speech: 'it-IT' }),
  L('ja', 'Japanese', '日本語', true, { ocr: 'japanese', speech: 'ja-JP' }),
  L('jv', 'Javanese', 'Basa Jawa', false, { ocr: 'latin', speech: 'jv-ID' }),
  L('kn', 'Kannada', 'ಕನ್ನಡ', true, { speech: 'kn-IN' }),
  L('kk', 'Kazakh', 'Қазақ тілі', false, { speech: 'kk-KZ' }),
  L('km', 'Khmer', 'ខ្មែរ', false, { speech: 'km-KH' }),
  L('rw', 'Kinyarwanda', 'Ikinyarwanda', false, { ocr: 'latin' }),
  L('gom', 'Konkani', 'कोंकणी', false, { ocr: 'devanagari' }),
  L('ko', 'Korean', '한국어', true, { ocr: 'korean', speech: 'ko-KR' }),
  L('kri', 'Krio', 'Krio', false, { ocr: 'latin' }),
  L('ku', 'Kurdish (Kurmanji)', 'Kurdî', false, { ocr: 'latin' }),
  L('ckb', 'Kurdish (Sorani)', 'کوردی', false, { rtl: true }),
  L('ky', 'Kyrgyz', 'Кыргызча', false),
  L('lo', 'Lao', 'ລາວ', false, { speech: 'lo-LA' }),
  L('la', 'Latin', 'Latina', false, { ocr: 'latin' }),
  L('lv', 'Latvian', 'Latviešu', true, { ocr: 'latin', speech: 'lv-LV' }),
  L('ln', 'Lingala', 'Lingála', false, { ocr: 'latin' }),
  L('lt', 'Lithuanian', 'Lietuvių', true, { ocr: 'latin', speech: 'lt-LT' }),
  L('lg', 'Luganda', 'Luganda', false, { ocr: 'latin' }),
  L('lb', 'Luxembourgish', 'Lëtzebuergesch', false, { ocr: 'latin' }),
  L('mk', 'Macedonian', 'Македонски', true, { speech: 'mk-MK' }),
  L('mai', 'Maithili', 'मैथिली', false, { ocr: 'devanagari' }),
  L('mg', 'Malagasy', 'Malagasy', false, { ocr: 'latin' }),
  L('ms', 'Malay', 'Bahasa Melayu', true, { ocr: 'latin', speech: 'ms-MY' }),
  L('ml', 'Malayalam', 'മലയാളം', false, { speech: 'ml-IN' }),
  L('mt', 'Maltese', 'Malti', true, { ocr: 'latin' }),
  L('mi', 'Maori', 'Māori', false, { ocr: 'latin' }),
  L('mr', 'Marathi', 'मराठी', true, { ocr: 'devanagari', speech: 'mr-IN' }),
  L('mni-Mtei', 'Meitei', 'ꯃꯤꯇꯩꯂꯣꯟ', false),
  L('lus', 'Mizo', 'Mizo ṭawng', false, { ocr: 'latin' }),
  L('mn', 'Mongolian', 'Монгол', false, { speech: 'mn-MN' }),
  L('ne', 'Nepali', 'नेपाली', false, { ocr: 'devanagari', speech: 'ne-NP' }),
  L('no', 'Norwegian', 'Norsk', true, { ocr: 'latin', speech: 'nb-NO' }),
  L('or', 'Odia', 'ଓଡ଼ିଆ', false),
  L('om', 'Oromo', 'Afaan Oromoo', false, { ocr: 'latin' }),
  L('ps', 'Pashto', 'پښتو', false, { rtl: true }),
  L('fa', 'Persian', 'فارسی', true, { rtl: true, speech: 'fa-IR' }),
  L('pl', 'Polish', 'Polski', true, { ocr: 'latin', speech: 'pl-PL' }),
  L('pt', 'Portuguese', 'Português', true, { ocr: 'latin', speech: 'pt-BR' }),
  L('pa', 'Punjabi', 'ਪੰਜਾਬੀ', false, { speech: 'pa-IN' }),
  L('qu', 'Quechua', 'Runa Simi', false, { ocr: 'latin' }),
  L('ro', 'Romanian', 'Română', true, { ocr: 'latin', speech: 'ro-RO' }),
  L('ru', 'Russian', 'Русский', true, { speech: 'ru-RU' }),
  L('sm', 'Samoan', 'Gagana Samoa', false, { ocr: 'latin' }),
  L('sa', 'Sanskrit', 'संस्कृतम्', false, { ocr: 'devanagari' }),
  L('gd', 'Scottish Gaelic', 'Gàidhlig', false, { ocr: 'latin' }),
  L('nso', 'Sepedi', 'Sepedi', false, { ocr: 'latin' }),
  L('sr', 'Serbian', 'Српски', false, { speech: 'sr-RS' }),
  L('st', 'Sesotho', 'Sesotho', false, { ocr: 'latin' }),
  L('sn', 'Shona', 'chiShona', false, { ocr: 'latin' }),
  L('sd', 'Sindhi', 'سنڌي', false, { rtl: true }),
  L('si', 'Sinhala', 'සිංහල', false, { speech: 'si-LK' }),
  L('sk', 'Slovak', 'Slovenčina', true, { ocr: 'latin', speech: 'sk-SK' }),
  L('sl', 'Slovenian', 'Slovenščina', true, { ocr: 'latin', speech: 'sl-SI' }),
  L('so', 'Somali', 'Soomaali', false, { ocr: 'latin' }),
  L('es', 'Spanish', 'Español', true, { ocr: 'latin', speech: 'es-ES' }),
  L('su', 'Sundanese', 'Basa Sunda', false, { ocr: 'latin', speech: 'su-ID' }),
  L('sw', 'Swahili', 'Kiswahili', true, { ocr: 'latin', speech: 'sw-KE' }),
  L('sv', 'Swedish', 'Svenska', true, { ocr: 'latin', speech: 'sv-SE' }),
  L('tg', 'Tajik', 'Тоҷикӣ', false),
  L('ta', 'Tamil', 'தமிழ்', true, { speech: 'ta-IN' }),
  L('tt', 'Tatar', 'Татар', false),
  L('te', 'Telugu', 'తెలుగు', true, { speech: 'te-IN' }),
  L('th', 'Thai', 'ไทย', true, { speech: 'th-TH' }),
  L('ti', 'Tigrinya', 'ትግርኛ', false),
  L('ts', 'Tsonga', 'Xitsonga', false, { ocr: 'latin' }),
  L('tr', 'Turkish', 'Türkçe', true, { ocr: 'latin', speech: 'tr-TR' }),
  L('tk', 'Turkmen', 'Türkmen', false, { ocr: 'latin' }),
  L('ak', 'Twi', 'Twi', false, { ocr: 'latin' }),
  L('uk', 'Ukrainian', 'Українська', true, { speech: 'uk-UA' }),
  L('ur', 'Urdu', 'اردو', true, { rtl: true, speech: 'ur-PK' }),
  L('ug', 'Uyghur', 'ئۇيغۇرچە', false, { rtl: true }),
  L('uz', 'Uzbek', 'Oʻzbek', false, { ocr: 'latin', speech: 'uz-UZ' }),
  L('vi', 'Vietnamese', 'Tiếng Việt', true, { ocr: 'latin', speech: 'vi-VN' }),
  L('cy', 'Welsh', 'Cymraeg', true, { ocr: 'latin', speech: 'cy-GB' }),
  L('xh', 'Xhosa', 'isiXhosa', false, { ocr: 'latin' }),
  L('yi', 'Yiddish', 'ייִדיש', false, { rtl: true }),
  L('yo', 'Yoruba', 'Yorùbá', false, { ocr: 'latin' }),
  L('zu', 'Zulu', 'isiZulu', false, { ocr: 'latin', speech: 'zu-ZA' }),
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function getLanguage(code: string): Language | undefined {
  return BY_CODE.get(code);
}

export function isLanguageCode(code: string): boolean {
  return BY_CODE.has(code);
}

export function isRtl(code: string): boolean {
  return BY_CODE.get(code)?.rtl === true;
}

/** True when both directions of a pair can be translated on the device. */
export function canTranslateOffline(source: string, target: string): boolean {
  return BY_CODE.get(source)?.offline === true && BY_CODE.get(target)?.offline === true;
}

export const OFFLINE_LANGUAGE_CODES = LANGUAGES.filter((l) => l.offline).map((l) => l.code);
