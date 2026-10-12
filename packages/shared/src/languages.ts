/**
 * Every language the app offers.
 *
 * offline  Google ML Kit has an on-device model (≈30 MB download, works without internet).
 * ocr      Script the on-device camera text recognizer can read. Languages without one
 *          fall back to cloud OCR (for example Arabic, Persian, Hebrew, Thai).
 * rtl      Written right to left; the UI mirrors text alignment for these.
 *
 * Each entry carries its English name, its Arabic name (the app's other interface
 * language; Hermes has no Intl.DisplayNames, so names ship as data) and its own name.
 *
 * Codes follow the cloud provider (BCP-47 / Google Translate). The API can return a
 * longer live list; this file is the offline-safe fallback.
 */

export type OcrScript = 'latin' | 'chinese' | 'devanagari' | 'japanese' | 'korean';

export interface Language {
  code: string;
  /** English name. */
  name: string;
  /** Arabic name, shown when the interface is in Arabic. */
  nameAr: string;
  /** The language's name for itself. */
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
  nameAr: string,
  native: string,
  offline: boolean,
  extra: Partial<Pick<Language, 'rtl' | 'ocr' | 'speech'>> = {},
): Language => ({ code, name, nameAr, native, offline, ...extra });

export const LANGUAGES: readonly Language[] = [
  L('af', 'Afrikaans', 'الأفريقانية', 'Afrikaans', true, { ocr: 'latin', speech: 'af-ZA' }),
  L('sq', 'Albanian', 'الألبانية', 'Shqip', true, { ocr: 'latin', speech: 'sq-AL' }),
  L('am', 'Amharic', 'الأمهرية', 'አማርኛ', false, { speech: 'am-ET' }),
  L('ar', 'Arabic', 'العربية', 'العربية', true, { rtl: true, speech: 'ar-SA' }),
  L('hy', 'Armenian', 'الأرمنية', 'Հայերեն', false, { speech: 'hy-AM' }),
  L('as', 'Assamese', 'الأسامية', 'অসমীয়া', false),
  L('ay', 'Aymara', 'الأيمارا', 'Aymar aru', false, { ocr: 'latin' }),
  L('az', 'Azerbaijani', 'الأذربيجانية', 'Azərbaycan', false, { ocr: 'latin', speech: 'az-AZ' }),
  L('bm', 'Bambara', 'البامبارا', 'Bamanankan', false, { ocr: 'latin' }),
  L('eu', 'Basque', 'الباسكية', 'Euskara', false, { ocr: 'latin', speech: 'eu-ES' }),
  L('be', 'Belarusian', 'البيلاروسية', 'Беларуская', true, { speech: 'be-BY' }),
  L('bn', 'Bengali', 'البنغالية', 'বাংলা', true, { speech: 'bn-BD' }),
  L('bho', 'Bhojpuri', 'البوجبورية', 'भोजपुरी', false, { ocr: 'devanagari' }),
  L('bs', 'Bosnian', 'البوسنية', 'Bosanski', false, { ocr: 'latin', speech: 'bs-BA' }),
  L('bg', 'Bulgarian', 'البلغارية', 'Български', true, { speech: 'bg-BG' }),
  L('my', 'Burmese', 'البورمية', 'မြန်မာ', false, { speech: 'my-MM' }),
  L('ca', 'Catalan', 'الكتالانية', 'Català', true, { ocr: 'latin', speech: 'ca-ES' }),
  L('ceb', 'Cebuano', 'السيبوانية', 'Cebuano', false, { ocr: 'latin' }),
  L('ny', 'Chichewa', 'التشيتشيوا', 'Chichewa', false, { ocr: 'latin' }),
  L('zh', 'Chinese (Simplified)', 'الصينية (المبسّطة)', '简体中文', true, { ocr: 'chinese', speech: 'zh-CN' }),
  L('zh-TW', 'Chinese (Traditional)', 'الصينية (التقليدية)', '繁體中文', false, { ocr: 'chinese', speech: 'zh-TW' }),
  L('co', 'Corsican', 'الكورسيكية', 'Corsu', false, { ocr: 'latin' }),
  L('hr', 'Croatian', 'الكرواتية', 'Hrvatski', true, { ocr: 'latin', speech: 'hr-HR' }),
  L('cs', 'Czech', 'التشيكية', 'Čeština', true, { ocr: 'latin', speech: 'cs-CZ' }),
  L('da', 'Danish', 'الدنماركية', 'Dansk', true, { ocr: 'latin', speech: 'da-DK' }),
  L('dv', 'Dhivehi', 'المالديفية', 'ދިވެހި', false, { rtl: true }),
  L('doi', 'Dogri', 'الدوغرية', 'डोगरी', false, { ocr: 'devanagari' }),
  L('nl', 'Dutch', 'الهولندية', 'Nederlands', true, { ocr: 'latin', speech: 'nl-NL' }),
  L('en', 'English', 'الإنجليزية', 'English', true, { ocr: 'latin', speech: 'en-US' }),
  L('eo', 'Esperanto', 'الإسبرانتو', 'Esperanto', true, { ocr: 'latin' }),
  L('et', 'Estonian', 'الإستونية', 'Eesti', true, { ocr: 'latin', speech: 'et-EE' }),
  L('ee', 'Ewe', 'الإيوي', 'Eʋegbe', false, { ocr: 'latin' }),
  L('tl', 'Filipino', 'الفلبينية', 'Filipino', true, { ocr: 'latin', speech: 'fil-PH' }),
  L('fi', 'Finnish', 'الفنلندية', 'Suomi', true, { ocr: 'latin', speech: 'fi-FI' }),
  L('fr', 'French', 'الفرنسية', 'Français', true, { ocr: 'latin', speech: 'fr-FR' }),
  L('fy', 'Frisian', 'الفريزية', 'Frysk', false, { ocr: 'latin' }),
  L('gl', 'Galician', 'الجاليكية', 'Galego', true, { ocr: 'latin', speech: 'gl-ES' }),
  L('ka', 'Georgian', 'الجورجية', 'ქართული', true, { speech: 'ka-GE' }),
  L('de', 'German', 'الألمانية', 'Deutsch', true, { ocr: 'latin', speech: 'de-DE' }),
  L('el', 'Greek', 'اليونانية', 'Ελληνικά', true, { speech: 'el-GR' }),
  L('gn', 'Guarani', 'الغوارانية', "Avañe'ẽ", false, { ocr: 'latin' }),
  L('gu', 'Gujarati', 'الغوجاراتية', 'ગુજરાતી', true, { speech: 'gu-IN' }),
  L('ht', 'Haitian Creole', 'الكريولية الهايتية', 'Kreyòl ayisyen', true, { ocr: 'latin' }),
  L('ha', 'Hausa', 'الهوسا', 'Hausa', false, { ocr: 'latin' }),
  L('haw', 'Hawaiian', 'الهاوائية', 'ʻŌlelo Hawaiʻi', false, { ocr: 'latin' }),
  L('he', 'Hebrew', 'العبرية', 'עברית', true, { rtl: true, speech: 'he-IL' }),
  L('hi', 'Hindi', 'الهندية', 'हिन्दी', true, { ocr: 'devanagari', speech: 'hi-IN' }),
  L('hmn', 'Hmong', 'الهمونغ', 'Hmoob', false, { ocr: 'latin' }),
  L('hu', 'Hungarian', 'الهنغارية', 'Magyar', true, { ocr: 'latin', speech: 'hu-HU' }),
  L('is', 'Icelandic', 'الآيسلندية', 'Íslenska', true, { ocr: 'latin', speech: 'is-IS' }),
  L('ig', 'Igbo', 'الإيغبو', 'Igbo', false, { ocr: 'latin' }),
  L('ilo', 'Ilocano', 'الإيلوكانية', 'Ilokano', false, { ocr: 'latin' }),
  L('id', 'Indonesian', 'الإندونيسية', 'Bahasa Indonesia', true, { ocr: 'latin', speech: 'id-ID' }),
  L('ga', 'Irish', 'الأيرلندية', 'Gaeilge', true, { ocr: 'latin', speech: 'ga-IE' }),
  L('it', 'Italian', 'الإيطالية', 'Italiano', true, { ocr: 'latin', speech: 'it-IT' }),
  L('ja', 'Japanese', 'اليابانية', '日本語', true, { ocr: 'japanese', speech: 'ja-JP' }),
  L('jv', 'Javanese', 'الجاوية', 'Basa Jawa', false, { ocr: 'latin', speech: 'jv-ID' }),
  L('kn', 'Kannada', 'الكانادا', 'ಕನ್ನಡ', true, { speech: 'kn-IN' }),
  L('kk', 'Kazakh', 'الكازاخية', 'Қазақ тілі', false, { speech: 'kk-KZ' }),
  L('km', 'Khmer', 'الخميرية', 'ខ្មែរ', false, { speech: 'km-KH' }),
  L('rw', 'Kinyarwanda', 'الكينيارواندية', 'Ikinyarwanda', false, { ocr: 'latin' }),
  L('gom', 'Konkani', 'الكونكانية', 'कोंकणी', false, { ocr: 'devanagari' }),
  L('ko', 'Korean', 'الكورية', '한국어', true, { ocr: 'korean', speech: 'ko-KR' }),
  L('kri', 'Krio', 'الكريو', 'Krio', false, { ocr: 'latin' }),
  L('ku', 'Kurdish (Kurmanji)', 'الكردية (الكرمانجية)', 'Kurdî', false, { ocr: 'latin' }),
  L('ckb', 'Kurdish (Sorani)', 'الكردية (السورانية)', 'کوردی', false, { rtl: true }),
  L('ky', 'Kyrgyz', 'القيرغيزية', 'Кыргызча', false),
  L('lo', 'Lao', 'اللاوية', 'ລາວ', false, { speech: 'lo-LA' }),
  L('la', 'Latin', 'اللاتينية', 'Latina', false, { ocr: 'latin' }),
  L('lv', 'Latvian', 'اللاتفية', 'Latviešu', true, { ocr: 'latin', speech: 'lv-LV' }),
  L('ln', 'Lingala', 'اللينغالا', 'Lingála', false, { ocr: 'latin' }),
  L('lt', 'Lithuanian', 'الليتوانية', 'Lietuvių', true, { ocr: 'latin', speech: 'lt-LT' }),
  L('lg', 'Luganda', 'اللوغندية', 'Luganda', false, { ocr: 'latin' }),
  L('lb', 'Luxembourgish', 'اللوكسمبورغية', 'Lëtzebuergesch', false, { ocr: 'latin' }),
  L('mk', 'Macedonian', 'المقدونية', 'Македонски', true, { speech: 'mk-MK' }),
  L('mai', 'Maithili', 'المايثيلية', 'मैथिली', false, { ocr: 'devanagari' }),
  L('mg', 'Malagasy', 'الملغاشية', 'Malagasy', false, { ocr: 'latin' }),
  L('ms', 'Malay', 'الملايوية', 'Bahasa Melayu', true, { ocr: 'latin', speech: 'ms-MY' }),
  L('ml', 'Malayalam', 'المالايالامية', 'മലയാളം', false, { speech: 'ml-IN' }),
  L('mt', 'Maltese', 'المالطية', 'Malti', true, { ocr: 'latin' }),
  L('mi', 'Maori', 'الماورية', 'Māori', false, { ocr: 'latin' }),
  L('mr', 'Marathi', 'الماراثية', 'मराठी', true, { ocr: 'devanagari', speech: 'mr-IN' }),
  L('mni-Mtei', 'Meitei', 'الميتية (المانيبورية)', 'ꯃꯤꯇꯩꯂꯣꯟ', false),
  L('lus', 'Mizo', 'الميزو', 'Mizo ṭawng', false, { ocr: 'latin' }),
  L('mn', 'Mongolian', 'المنغولية', 'Монгол', false, { speech: 'mn-MN' }),
  L('ne', 'Nepali', 'النيبالية', 'नेपाली', false, { ocr: 'devanagari', speech: 'ne-NP' }),
  L('no', 'Norwegian', 'النرويجية', 'Norsk', true, { ocr: 'latin', speech: 'nb-NO' }),
  L('or', 'Odia', 'الأوديا', 'ଓଡ଼ିଆ', false),
  L('om', 'Oromo', 'الأورومية', 'Afaan Oromoo', false, { ocr: 'latin' }),
  L('ps', 'Pashto', 'البشتوية', 'پښتو', false, { rtl: true }),
  L('fa', 'Persian', 'الفارسية', 'فارسی', true, { rtl: true, speech: 'fa-IR' }),
  L('pl', 'Polish', 'البولندية', 'Polski', true, { ocr: 'latin', speech: 'pl-PL' }),
  L('pt', 'Portuguese', 'البرتغالية', 'Português', true, { ocr: 'latin', speech: 'pt-BR' }),
  L('pa', 'Punjabi', 'البنجابية', 'ਪੰਜਾਬੀ', false, { speech: 'pa-IN' }),
  L('qu', 'Quechua', 'الكيتشوا', 'Runa Simi', false, { ocr: 'latin' }),
  L('ro', 'Romanian', 'الرومانية', 'Română', true, { ocr: 'latin', speech: 'ro-RO' }),
  L('ru', 'Russian', 'الروسية', 'Русский', true, { speech: 'ru-RU' }),
  L('sm', 'Samoan', 'الساموائية', 'Gagana Samoa', false, { ocr: 'latin' }),
  L('sa', 'Sanskrit', 'السنسكريتية', 'संस्कृतम्', false, { ocr: 'devanagari' }),
  L('gd', 'Scottish Gaelic', 'الغيلية الإسكتلندية', 'Gàidhlig', false, { ocr: 'latin' }),
  L('nso', 'Sepedi', 'السيبيدي', 'Sepedi', false, { ocr: 'latin' }),
  L('sr', 'Serbian', 'الصربية', 'Српски', false, { speech: 'sr-RS' }),
  L('st', 'Sesotho', 'السوتو', 'Sesotho', false, { ocr: 'latin' }),
  L('sn', 'Shona', 'الشونا', 'chiShona', false, { ocr: 'latin' }),
  L('sd', 'Sindhi', 'السندية', 'سنڌي', false, { rtl: true }),
  L('si', 'Sinhala', 'السنهالية', 'සිංහල', false, { speech: 'si-LK' }),
  L('sk', 'Slovak', 'السلوفاكية', 'Slovenčina', true, { ocr: 'latin', speech: 'sk-SK' }),
  L('sl', 'Slovenian', 'السلوفينية', 'Slovenščina', true, { ocr: 'latin', speech: 'sl-SI' }),
  L('so', 'Somali', 'الصومالية', 'Soomaali', false, { ocr: 'latin' }),
  L('es', 'Spanish', 'الإسبانية', 'Español', true, { ocr: 'latin', speech: 'es-ES' }),
  L('su', 'Sundanese', 'السوندية', 'Basa Sunda', false, { ocr: 'latin', speech: 'su-ID' }),
  L('sw', 'Swahili', 'السواحلية', 'Kiswahili', true, { ocr: 'latin', speech: 'sw-KE' }),
  L('sv', 'Swedish', 'السويدية', 'Svenska', true, { ocr: 'latin', speech: 'sv-SE' }),
  L('tg', 'Tajik', 'الطاجيكية', 'Тоҷикӣ', false),
  L('ta', 'Tamil', 'التاميلية', 'தமிழ்', true, { speech: 'ta-IN' }),
  L('tt', 'Tatar', 'التترية', 'Татар', false),
  L('te', 'Telugu', 'التيلوغوية', 'తెలుగు', true, { speech: 'te-IN' }),
  L('th', 'Thai', 'التايلاندية', 'ไทย', true, { speech: 'th-TH' }),
  L('ti', 'Tigrinya', 'التغرينية', 'ትግርኛ', false),
  L('ts', 'Tsonga', 'التسونغا', 'Xitsonga', false, { ocr: 'latin' }),
  L('tr', 'Turkish', 'التركية', 'Türkçe', true, { ocr: 'latin', speech: 'tr-TR' }),
  L('tk', 'Turkmen', 'التركمانية', 'Türkmen', false, { ocr: 'latin' }),
  L('ak', 'Twi', 'التوي', 'Twi', false, { ocr: 'latin' }),
  L('uk', 'Ukrainian', 'الأوكرانية', 'Українська', true, { speech: 'uk-UA' }),
  L('ur', 'Urdu', 'الأردية', 'اردو', true, { rtl: true, speech: 'ur-PK' }),
  L('ug', 'Uyghur', 'الأويغورية', 'ئۇيغۇرچە', false, { rtl: true }),
  L('uz', 'Uzbek', 'الأوزبكية', 'Oʻzbek', false, { ocr: 'latin', speech: 'uz-UZ' }),
  L('vi', 'Vietnamese', 'الفيتنامية', 'Tiếng Việt', true, { ocr: 'latin', speech: 'vi-VN' }),
  L('cy', 'Welsh', 'الويلزية', 'Cymraeg', true, { ocr: 'latin', speech: 'cy-GB' }),
  L('xh', 'Xhosa', 'الخوسا', 'isiXhosa', false, { ocr: 'latin' }),
  L('yi', 'Yiddish', 'اليديشية', 'ייִדיש', false, { rtl: true }),
  L('yo', 'Yoruba', 'اليوروبا', 'Yorùbá', false, { ocr: 'latin' }),
  L('zu', 'Zulu', 'الزولو', 'isiZulu', false, { ocr: 'latin', speech: 'zu-ZA' }),
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
