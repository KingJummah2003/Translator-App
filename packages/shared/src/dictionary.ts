/**
 * How each app language is found in English Wiktionary, and which of its dialects and
 * regional varieties are shown alongside it.
 *
 * Wiktionary's REST definition endpoint files a language under its own key only when it
 * has a Wikimedia site code; everything else (Norwegian, Slovene, Kurdish, Māori, most
 * Arabic dialects, ...) lands in one shared "other" list where only `entry.language`
 * identifies it. Matching every entry by its exact Wiktionary language name works for
 * both cases, and also drops look-alike languages that share a script.
 *
 * Names were checked against Wiktionary's Module:languages canonical-name tables. Historical
 * stages (Old/Middle X) and languages the app offers on their own are deliberately left out.
 */

export interface DictionaryEntrySource {
  /** Wiktionary names of the language itself, preferred first. */
  names: string[];
  /** Dialects and close regional varieties, shown after the standard senses with a label. */
  dialects: string[];
}

/** App codes whose Wiktionary name differs from the app's English name. */
const NAMES: Record<string, string[]> = {
  zh: ['Chinese'],
  'zh-TW': ['Chinese'],
  bs: ['Serbo-Croatian'],
  hr: ['Serbo-Croatian'],
  sr: ['Serbo-Croatian'],
  tl: ['Tagalog'],
  fy: ['West Frisian'],
  gn: ['Paraguayan Guarani'],
  hmn: ['White Hmong', 'Green Hmong'],
  rw: ['Rwanda-Rundi'],
  gom: ['Konkani'],
  ku: ['Northern Kurdish'],
  ckb: ['Central Kurdish'],
  mi: ['Māori'],
  'mni-Mtei': ['Manipuri'],
  nso: ['Northern Sotho'],
  no: ['Norwegian Bokmål', 'Norwegian Nynorsk', 'Norwegian'],
  st: ['Sotho'],
  si: ['Sinhalese'],
  sl: ['Slovene'],
  ak: ['Akan'],
  my: ['Burmese'],
  gd: ['Scottish Gaelic'],
};

const DIALECTS: Record<string, string[]> = {
  ar: [
    'Gulf Arabic',
    'Najdi Arabic',
    'Hijazi Arabic',
    'Egyptian Arabic',
    'North Levantine Arabic',
    'South Levantine Arabic',
    'Iraqi Arabic',
    'Omani Arabic',
    'Baharna Arabic',
    'Dhofari Arabic',
    'Shihhi Arabic',
    'Yemeni Arabic',
    'Sudanese Arabic',
    'Libyan Arabic',
    'Tunisian Arabic',
    'Algerian Arabic',
    'Moroccan Arabic',
    'Hassaniya Arabic',
    'Chadian Arabic',
    'Juba Arabic',
  ],
  sq: ['Arbëresh Albanian', 'Arvanitika Albanian'],
  bn: ['Sylheti', 'Chittagonian', 'Kamta'],
  my: ['Rakhine'],
  ckb: ['Southern Kurdish', 'Laki'],
  co: ['Gallurese', 'Sassarese'],
  da: ['Jutish'],
  de: [
    'Alemannic German',
    'Bavarian',
    'Low German',
    'Swabian',
    'Central Franconian',
    'Rhine Franconian',
    'East Central German',
    'Pennsylvania German',
    'Hunsrik',
  ],
  el: ['Pontic Greek', 'Tsakonian'],
  en: ['Scots', 'Jamaican Creole', 'Hawaiian Creole', 'Antigua and Barbuda Creole English'],
  es: ['Ladino'],
  et: ['Võro'],
  fi: ['Meänkieli', 'Kven'],
  fr: ['Walloon', 'Picard', 'Norman'],
  fy: ['North Frisian', 'Saterland Frisian'],
  gl: ['Fala'],
  gn: ['Mbya Guarani'],
  hi: ['Awadhi', 'Haryanvi', 'Chhattisgarhi', 'Marwari', 'Mewari', 'Fiji Hindi'],
  hmn: [],
  id: ['Betawi'],
  it: [
    'Neapolitan',
    'Sicilian',
    'Venetan',
    'Lombard',
    'Piedmontese',
    'Ligurian',
    'Emilian',
    'Tarantino',
    'Friulian',
    'Sardinian',
    'Gallurese',
    'Sassarese',
  ],
  ja: ['Okinawan', 'Northern Amami Ōshima', 'Southern Amami Ōshima', 'Miyako', 'Yonaguni', 'Okinoerabu', 'Yoron'],
  jv: ['Osing'],
  km: ['Northern Khmer'],
  ko: ['Jeju'],
  lo: ['Isan', 'Nyaw'],
  lt: ['Samogitian'],
  lv: ['Latgalian'],
  mn: ['Buryat', 'Kalmyk'],
  ms: ['Brunei Malay', 'Kedah Malay', 'Sarawak Malay', 'Terengganu Malay'],
  ne: ['Doteli'],
  nl: ['Limburgish', 'West Flemish', 'Zealandic'],
  or: ['Sambalpuri'],
  pa: ['Saraiki', 'Pahari-Potwari', 'Northern Hindko', 'Southern Hindko'],
  pl: ['Silesian', 'Kashubian'],
  pt: ['Fala'],
  ro: ['Aromanian', 'Megleno-Romanian', 'Istro-Romanian'],
  bs: ['Slavomolisano'],
  hr: ['Slavomolisano'],
  sr: ['Slavomolisano'],
  sd: ['Kachchi'],
  si: ['Veddah'],
  sn: ['Ndau', 'Kalanga'],
  so: ['Maay'],
  sv: ['Elfdalian', 'Jamtish', 'Gutnish'],
  sw: ['Ngazidja Comorian', 'Maore Comorian', 'Ndzwani Comorian', 'Mwali Comorian', 'Mwani'],
  tg: ['Bukhari'],
  th: ['Northern Thai', 'Isan', 'Southern Thai'],
  ts: ['Ronga'],
  tt: ['Siberian Tatar'],
  ur: ['Deccani'],
};

/**
 * Which dialect to list first for a speaker from a given country (ISO 3166 region code).
 * Only languages with strongly regional dialects need an entry.
 */
const REGIONAL_DIALECTS: Record<string, Record<string, string[]>> = {
  ar: {
    KW: ['Gulf Arabic'],
    AE: ['Gulf Arabic'],
    QA: ['Gulf Arabic'],
    BH: ['Gulf Arabic', 'Baharna Arabic'],
    SA: ['Najdi Arabic', 'Hijazi Arabic', 'Gulf Arabic'],
    OM: ['Omani Arabic', 'Gulf Arabic', 'Dhofari Arabic'],
    IQ: ['Iraqi Arabic'],
    EG: ['Egyptian Arabic'],
    SY: ['North Levantine Arabic'],
    LB: ['North Levantine Arabic'],
    JO: ['South Levantine Arabic'],
    PS: ['South Levantine Arabic'],
    YE: ['Yemeni Arabic'],
    SD: ['Sudanese Arabic'],
    SS: ['Juba Arabic'],
    LY: ['Libyan Arabic'],
    TN: ['Tunisian Arabic'],
    DZ: ['Algerian Arabic'],
    MA: ['Moroccan Arabic'],
    MR: ['Hassaniya Arabic'],
    EH: ['Hassaniya Arabic'],
    TD: ['Chadian Arabic'],
  },
  de: { CH: ['Alemannic German'], LI: ['Alemannic German'], AT: ['Bavarian'] },
  it: { CH: ['Lombard'] },
  nl: { BE: ['West Flemish', 'Limburgish'] },
  en: { JM: ['Jamaican Creole'], AG: ['Antigua and Barbuda Creole English'] },
  sw: { KM: ['Ngazidja Comorian', 'Ndzwani Comorian', 'Mwali Comorian'], YT: ['Maore Comorian'], MZ: ['Mwani'] },
  ms: { BN: ['Brunei Malay'] },
  pa: { PK: ['Saraiki', 'Pahari-Potwari'] },
  so: { SO: ['Maay'] },
};

/** Arabic display names for every dialect above (the Arabic UI never shows English names). */
export const DIALECT_NAMES_AR: Record<string, string> = {
  'Gulf Arabic': 'اللهجة الخليجية',
  'Najdi Arabic': 'اللهجة النجدية',
  'Hijazi Arabic': 'اللهجة الحجازية',
  'Egyptian Arabic': 'اللهجة المصرية',
  'North Levantine Arabic': 'اللهجة الشامية الشمالية',
  'South Levantine Arabic': 'اللهجة الشامية الجنوبية',
  'Iraqi Arabic': 'اللهجة العراقية',
  'Omani Arabic': 'اللهجة العُمانية',
  'Baharna Arabic': 'اللهجة البحرانية',
  'Dhofari Arabic': 'اللهجة الظفارية',
  'Shihhi Arabic': 'اللهجة الشحية',
  'Yemeni Arabic': 'اللهجة اليمنية',
  'Sudanese Arabic': 'اللهجة السودانية',
  'Libyan Arabic': 'اللهجة الليبية',
  'Tunisian Arabic': 'اللهجة التونسية',
  'Algerian Arabic': 'اللهجة الجزائرية',
  'Moroccan Arabic': 'اللهجة المغربية',
  'Hassaniya Arabic': 'اللهجة الحسانية',
  'Chadian Arabic': 'اللهجة التشادية',
  'Juba Arabic': 'عربي جوبا',
  'Arbëresh Albanian': 'الألبانية الأربرشية',
  'Arvanitika Albanian': 'الألبانية الأرفانيتية',
  Sylheti: 'السيلهتية',
  Chittagonian: 'الشيتاغونغية',
  Kamta: 'الكامتا',
  Rakhine: 'الراخينية',
  'Southern Kurdish': 'الكردية الجنوبية',
  Laki: 'اللكية',
  Gallurese: 'الغالورية',
  Sassarese: 'الساساريزية',
  Jutish: 'اليوتلاندية',
  'Alemannic German': 'الأليمانية (الألمانية السويسرية)',
  Bavarian: 'البافارية',
  'Low German': 'الألمانية السفلى',
  Swabian: 'الشوابية',
  'Central Franconian': 'الفرانكونية الوسطى',
  'Rhine Franconian': 'الفرانكونية الراينية',
  'East Central German': 'الألمانية الوسطى الشرقية',
  'Pennsylvania German': 'ألمانية بنسلفانيا',
  Hunsrik: 'الهونسريك',
  'Pontic Greek': 'اليونانية البنطية',
  Tsakonian: 'التساكونية',
  Scots: 'الاسكتلندية',
  'Jamaican Creole': 'الكريولية الجامايكية',
  'Hawaiian Creole': 'الكريولية الهاوايية',
  'Antigua and Barbuda Creole English': 'كريولية أنتيغوا وباربودا',
  Ladino: 'اللادينو',
  Võro: 'الفورو',
  Meänkieli: 'الميانكييلي',
  Kven: 'الكفينية',
  Walloon: 'الوالونية',
  Picard: 'البيكاردية',
  Norman: 'النورماندية',
  'North Frisian': 'الفريزية الشمالية',
  'Saterland Frisian': 'فريزية زاترلاند',
  Fala: 'الفالا',
  'Mbya Guarani': 'غوارانية مبيا',
  Awadhi: 'الأوادية',
  Haryanvi: 'الهاريانية',
  Chhattisgarhi: 'التشاتيسغارية',
  Marwari: 'الماروارية',
  Mewari: 'الميوارية',
  'Fiji Hindi': 'هندية فيجي',
  Betawi: 'البيتاوية',
  Neapolitan: 'النابولية',
  Sicilian: 'الصقلية',
  Venetan: 'البندقية',
  Lombard: 'اللومباردية',
  Piedmontese: 'البيدمونتية',
  Ligurian: 'الليغورية',
  Emilian: 'الإميليانية',
  Tarantino: 'التارانتية',
  Friulian: 'الفريولية',
  Sardinian: 'السردينية',
  Okinawan: 'الأوكيناوية',
  'Northern Amami Ōshima': 'لهجة أمامي الشمالية',
  'Southern Amami Ōshima': 'لهجة أمامي الجنوبية',
  Miyako: 'المياكو',
  Yonaguni: 'اليوناغوني',
  Okinoerabu: 'الأوكينوإيرابو',
  Yoron: 'اليورون',
  Osing: 'الأوسينغ',
  'Northern Khmer': 'الخميرية الشمالية',
  Jeju: 'لهجة جيجو',
  Isan: 'الإيسانية',
  Nyaw: 'النياو',
  Samogitian: 'الساموجيتية',
  Latgalian: 'اللاتغالية',
  Buryat: 'البورياتية',
  Kalmyk: 'الكالميكية',
  'Brunei Malay': 'ملايو بروناي',
  'Kedah Malay': 'ملايو قدح',
  'Sarawak Malay': 'ملايو ساراواك',
  'Terengganu Malay': 'ملايو ترغكانو',
  Doteli: 'الدوتيلية',
  Limburgish: 'الليمبورغية',
  'West Flemish': 'الفلمنكية الغربية',
  Zealandic: 'الزيلاندية',
  Sambalpuri: 'السامبالبورية',
  Saraiki: 'السرائيكية',
  'Pahari-Potwari': 'البهاري البوتواري',
  'Northern Hindko': 'الهندكو الشمالية',
  'Southern Hindko': 'الهندكو الجنوبية',
  Silesian: 'السيليزية',
  Kashubian: 'الكاشوبية',
  Aromanian: 'الأرومانية',
  'Megleno-Romanian': 'الميغلينو رومانية',
  'Istro-Romanian': 'الإسترو رومانية',
  Slavomolisano: 'السلافوموليزانية',
  Kachchi: 'الكوتشية',
  Veddah: 'الفيدية',
  Ndau: 'النداو',
  Kalanga: 'الكالانغا',
  Maay: 'الماي',
  Elfdalian: 'الإلفدالية',
  Jamtish: 'اليامتية',
  Gutnish: 'الغوتنية',
  'Ngazidja Comorian': 'القمرية (القمر الكبرى)',
  'Maore Comorian': 'القمرية (مايوت)',
  'Ndzwani Comorian': 'القمرية (أنجوان)',
  'Mwali Comorian': 'القمرية (موهيلي)',
  Mwani: 'الموانية',
  Bukhari: 'البخارية',
  'Northern Thai': 'التايلاندية الشمالية',
  'Southern Thai': 'التايلاندية الجنوبية',
  Ronga: 'الرونغا',
  'Siberian Tatar': 'التترية السيبيرية',
  Deccani: 'الدكنية',
};

/** Where to look up `code` in Wiktionary, or the app's English name when nothing special applies. */
export function dictionarySource(code: string, englishName: string): DictionaryEntrySource {
  return { names: NAMES[code] ?? [englishName], dialects: DIALECTS[code] ?? [] };
}

/**
 * Dialects to list first for someone in `region`, followed by the rest in their usual
 * order. Returns the plain list when the region has no preference.
 */
export function orderDialects(code: string, region?: string | null): string[] {
  const all = DIALECTS[code] ?? [];
  const preferred = region ? REGIONAL_DIALECTS[code]?.[region.toUpperCase()] ?? [] : [];
  return [...preferred.filter((d) => all.includes(d)), ...all.filter((d) => !preferred.includes(d))];
}

/** A dialect's display name in the UI language. */
export function dialectName(name: string, uiLanguage: string): string {
  return uiLanguage === 'ar' ? DIALECT_NAMES_AR[name] ?? name : name;
}

/** Every dialect name in the map, for tests. */
export const ALL_DIALECTS = [...new Set(Object.values(DIALECTS).flat())];

/** One part-of-speech block from the dictionary API. */
export interface DictionarySense {
  partOfSpeech: string;
  /** Wiktionary language of this entry, e.g. "Arabic" or "Gulf Arabic". */
  language: string;
  /** Set when the entry belongs to a dialect or regional variety of the requested language. */
  dialect?: string;
  definitions: { text: string; examples: string[] }[];
}

export interface DictionaryResponse {
  word: string;
  lang: string;
  /** Standard-language senses first, then dialect senses in map order. */
  senses: DictionarySense[];
  source: string;
}
