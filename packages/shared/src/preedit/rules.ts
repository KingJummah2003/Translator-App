/**
 * Deterministic English pre-editing applied before the on-device model, which cannot be
 * retrained. Each function rewrites one input pattern that the model is known to mangle
 * (long paragraphs, contractions that hide a negation, 12-hour times, ambiguous words in
 * safety text, names that must not be translated) into a form it handles reliably.
 *
 * Runs on the phone (Hermes) and in Workers, so it sticks to plain regular expressions:
 * no lookbehind, no Unicode property escapes, no Intl.Segmenter.
 */

import { protectEntities, type Protected } from '../protect';
import {
  AMBIGUOUS_GIVEN,
  GIVEN_NAMES,
  NAME_LIKE_PLACES,
  PLACE_NAMES,
  PLACE_WORDS,
  SURNAMES_FIRST,
  SURNAME_PARTICLES,
} from './names';
import {
  ALWAYS_TERMS,
  CAPS_TO_TRANSLATE,
  COMMON_WORDS,
  MID_SENTENCE_TERMS,
  PHRASE_TERMS,
  TECH_CONTEXT,
  WORK_TITLES,
} from './terms';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------------------------------------
 * Sentence splitting
 * ---------------------------------------------------------------------------------------- */

export interface Segment {
  /** One sentence or line, without surrounding whitespace or list markers. */
  text: string;
  /** Exactly what followed it in the input: spaces, newlines and the next line's bullet. */
  sep: string;
}

const BULLET = '(?:[-*•·▪◦‣●○■►➤–—]|\\(?\\d{1,3}[.)]|\\(?[a-z]\\))[ \\t]+';
const LEADING = new RegExp(`^\\s*(?:${BULLET})?`);
const LINE_BREAK = new RegExp(`[ \\t]*(?:\\r?\\n[ \\t]*)+(?:${BULLET})?`, 'g');
// A Latin terminator needs whitespace after it; CJK full-width ones end a sentence on their own.
const BOUNDARY = /([.!?…؟।۔]+)(["'”’)\]»」』]*)([ \t]+)|([。！？]+)(["'”’）」』]*)([ \t]*)/g;

/** Never end a sentence after these. */
const NO_SPLIT_AFTER = new Set(
  'mr mrs ms dr prof messrs mme mlle sen gov gen col capt lt sgt rev hon e.g i.e cf vs viz approx appx incl excl esp fig figs tel fax ext ref attn'.split(
    ' ',
  ),
);
/** Abbreviations that sit before a number ("No. 5", "Vol. 2", "Jan. 3", "Apt. 4B"). */
const BEFORE_NUMBER = new Set(
  'no nos nr vol vols p pp pg ch chap sec art para min max est rm apt ste jan feb mar apr jun jul aug sep sept oct nov dec'.split(
    ' ',
  ),
);
/** Abbreviations that often end a sentence too; split only when a typical sentence opener follows. */
const MAYBE_END = new Set(
  'inc ltd co corp llc plc jr sr st ave blvd rd dept univ govt bros mt ft u.s u.k u.n e.u u.s.a'.split(' '),
);
/** These end a sentence whenever a capitalized ordinary word follows ("etc. The", "5 p.m. We"). */
const END_BEFORE_CAPITAL = new Set(['etc', 'a.m', 'p.m']);
const OPENERS = new Set(
  `the a an this that these those it its i we you he she they there here my our your his her their
  please but and so if when in on at for as after before however also then thanks thank what how why
  where who is are do does can could would will should all some no not yes each every one many most
  both during since while although because today tomorrow yesterday now let note see`
    .trim()
    .split(/\s+/),
);

function firstWord(s: string): string {
  return (/^["'“‘(\[]*([A-Za-z']+)/.exec(s)?.[1] ?? '').toLowerCase();
}

function shouldSplit(before: string, terminator: string, after: string): boolean {
  const next = after.replace(/^["'“‘(\[]+/, '');
  const c = next.charAt(0);
  if (!c) return false;
  const lower = /[a-zà-öø-ÿ]/.test(c);
  if (/[!?؟]/.test(terminator)) return !lower;
  if (/[।۔]/.test(terminator)) return true;
  if (terminator.length > 1 || terminator === '…') return /[A-Z]/.test(c); // ellipsis
  if (lower) return false;
  const word = (/[^\s"'“‘(\[]*$/.exec(before)?.[0] ?? '').toLowerCase();
  if (NO_SPLIT_AFTER.has(word)) return false;
  if (BEFORE_NUMBER.has(word) && /[\d+#]/.test(c)) return false;
  if (END_BEFORE_CAPITAL.has(word)) return /[A-Z]/.test(c) && !/^[A-Z]{2,}\b/.test(next);
  if (MAYBE_END.has(word) || /^[a-z]$/.test(word) || /^(?:[a-z]\.)+[a-z]$/.test(word)) {
    return OPENERS.has(firstWord(next));
  }
  return true;
}

function splitLine(line: string, sep: string, out: Segment[]): void {
  let start = 0;
  BOUNDARY.lastIndex = 0;
  for (let m = BOUNDARY.exec(line); m; m = BOUNDARY.exec(line)) {
    const cjk = m[4] !== undefined;
    const space = (cjk ? m[6] : m[3]) ?? '';
    const end = m.index + m[0].length - space.length;
    const after = line.slice(m.index + m[0].length);
    if (!after) break;
    if (cjk || shouldSplit(line.slice(start, m.index), m[1]!, after)) {
      out.push({ text: line.slice(start, end), sep: space });
      start = m.index + m[0].length;
    }
  }
  out.push({ text: line.slice(start), sep });
}

/**
 * Splits text into sentences and lines so each can be translated alone; on-device models
 * drop or merge clauses in long paragraphs. Joining every `text + sep` gives back the input
 * exactly. A leading indent or bullet becomes a first segment with empty text.
 */
export function splitSentences(input: string): Segment[] {
  const out: Segment[] = [];
  const lead = LEADING.exec(input)?.[0] ?? '';
  if (lead) out.push({ text: '', sep: lead });
  const body = input.slice(lead.length);
  const trail = /\s*$/.exec(body)?.[0] ?? '';
  const content = body.slice(0, body.length - trail.length);
  if (!content) {
    if (trail) out.push({ text: '', sep: trail });
    return out;
  }
  let start = 0;
  LINE_BREAK.lastIndex = 0;
  for (let m = LINE_BREAK.exec(content); m; m = LINE_BREAK.exec(content)) {
    splitLine(content.slice(start, m.index), m[0], out);
    start = m.index + m[0].length;
  }
  splitLine(content.slice(start), trail, out);
  return out;
}

/** Inverse of splitSentences, after each segment's text has been rewritten or translated. */
export function joinSegments(segments: readonly Segment[]): string {
  return segments.map((s) => s.text + s.sep).join('');
}

/* ------------------------------------------------------------------------------------------
 * Contractions
 * ---------------------------------------------------------------------------------------- */

const APOS = "['’ʼ]";
const words = (s: string): ReadonlySet<string> => new Set(s.trim().split(/\s+/));

const IRREGULAR_PARTICIPLES = words(`been seen done gone had taken given made known written eaten broken
  spoken chosen forgotten begun sent lost found told said bought brought thought heard met paid got
  gotten kept slept felt understood stood won sold held built spent taught caught fought sought lent
  meant ridden driven flown grown shown thrown drawn worn torn hidden bitten fallen forgiven frozen
  stolen woken sung rung swum drunk left`);
/** After 's these only make sense as a perfect ("it's happened", "she's arrived"), never as "is". */
const PERFECT_ONLY = words(`been got gotten had arrived happened come become started begun stopped
  changed grown risen fallen died returned improved increased decreased decided agreed eaten slept woken`);
/** Participles that after "it's"/"that's" are usually passive: "it's called the Old Town". */
const PASSIVE_PRONE = words('called named known considered located based made used supposed said titled labelled labeled priced');
const OBJECT_START = words(`the a an my your his her our their its this these those some any all me you
  him us them every no everything nothing something anything everyone nobody someone two three four
  five six seven eight nine ten many much several enough`);
const SKIPPABLE_ADVERBS = words('just already never ever always recently finally also not really actually only almost nearly since');

function isParticiple(word: string): boolean {
  if (IRREGULAR_PARTICIPLES.has(word)) return true;
  if (!/^[a-z]{2,}ed$/.test(word) || /^(?:shed|wed|bed|red|embed|hundred)$/.test(word)) return false;
  return !/eed$/.test(word) || /^(?:agreed|freed|guaranteed|decreed|refereed)$/.test(word);
}

/** The next few words after a contraction, lowercased; stops at punctuation. */
function following(text: string, from: number): string[] {
  const m = /^\s+([A-Za-z'’-]+)(?:\s+([A-Za-z'’-]+))?(?:\s+([A-Za-z'’-]+))?/.exec(text.slice(from, from + 80));
  return m ? m.slice(1).filter((w): w is string => !!w).map((w) => w.toLowerCase()) : [];
}

const skipAdverb = (next: string[]): string[] => (next[0] && SKIPPABLE_ADVERBS.has(next[0]) ? next.slice(1) : next);

/** Matches the capitalization of the contraction: "IT'S" -> "IS", otherwise lowercase. */
function aux(match: string, word: string): string {
  const letters = match.replace(/[^A-Za-z]/g, '');
  return letters.length > 1 && letters === letters.toUpperCase() ? word.toUpperCase() : word;
}

function capitalizeLike(source: string, word: string): string {
  if (source.length > 1 && source === source.toUpperCase()) return word.toUpperCase();
  return /^[A-Z]/.test(source) ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

function hasOrIs(subject: string, text: string, end: number): 'has' | 'is' {
  const next = following(text, end);
  const after = skipAdverb(next);
  const verb = after[0];
  if (!verb) return 'is';
  if (PERFECT_ONLY.has(verb)) return 'has';
  if (verb === 'left' && /^(?:he|she|who)$/i.test(subject)) return 'has';
  const object = after[1];
  if (isParticiple(verb) && !PASSIVE_PRONE.has(verb) && object && (OBJECT_START.has(object) || /^\d/.test(object))) {
    return 'has';
  }
  return 'is';
}

function hadOrWould(text: string, end: number): 'had' | 'would' {
  const verb = skipAdverb(following(text, end))[0];
  if (verb && (verb === 'better' || (isParticiple(verb) && verb !== 'come'))) return 'had';
  return 'would';
}

/** Chat spellings without the apostrophe; only forms that are not themselves English words. */
const BARE_NEGATIVES: Readonly<Record<string, string>> = {
  dont: 'do not',
  doesnt: 'does not',
  didnt: 'did not',
  isnt: 'is not',
  arent: 'are not',
  wasnt: 'was not',
  werent: 'were not',
  havent: 'have not',
  hasnt: 'has not',
  hadnt: 'had not',
  couldnt: 'could not',
  wouldnt: 'would not',
  shouldnt: 'should not',
  mustnt: 'must not',
  cant: 'cannot',
  wont: 'will not',
  im: 'I am',
  youre: 'you are',
  theyre: 'they are',
  thats: 'that is',
  whats: 'what is',
};

// Lowercase or capitalized only: all-caps "IM" or "CANT" is more likely an acronym or a shout.
const BARE_FORMS = new RegExp(
  `\\b(?:${Object.keys(BARE_NEGATIVES)
    .map((w) => `[${w[0]}${w[0]!.toUpperCase()}]${w.slice(1)}`)
    .join('|')})\\b`,
  'g',
);

/**
 * Spells out contractions. On-device models lose the "not" inside "hadn't" or "couldn't"
 * in longer sentences and confuse "'s" and "'d"; the full forms translate reliably.
 * Possessives ("John's car", "the company's") are left alone.
 */
export function expandContractions(text: string): string {
  return text
    .replace(new RegExp(`\\b(can|won|shan|ain)${APOS}t\\b`, 'gi'), (m, stem: string, offset: number, all: string) => {
      const s = stem.toLowerCase();
      if (s === 'can') return capitalizeLike(stem, aux(m, 'cannot'));
      if (s === 'won') return capitalizeLike(stem, aux(m, 'will not'));
      if (s === 'shan') return capitalizeLike(stem, aux(m, 'shall not'));
      const subject = /(\w+)\s*$/.exec(all.slice(0, offset))?.[1]?.toLowerCase();
      const verb = subject === 'i' ? 'am' : subject && /^(?:you|we|they|all|these|those)$/.test(subject) ? 'are' : 'is';
      return capitalizeLike(stem, aux(m, `${verb} not`));
    })
    .replace(new RegExp(`\\b([A-Za-z]+)n${APOS}t\\b`, 'gi'), (m, stem: string) => `${stem} ${aux(m, 'not')}`)
    .replace(new RegExp(`\\b(let)${APOS}s\\b`, 'gi'), (m, verb: string) => `${verb} ${aux(m, 'us')}`)
    .replace(new RegExp(`\\b(y)${APOS}all\\b`, 'gi'), (m, y: string) => capitalizeLike(y, aux(m, 'you all')))
    .replace(new RegExp(`\\b(I)${APOS}m\\b`, 'gi'), (m, i: string) => `${i} ${aux(m, 'am')}`)
    .replace(new RegExp(`\\b([A-Za-z]+)${APOS}re\\b`, 'g'), (m, w: string) => `${w} ${aux(m, 'are')}`)
    .replace(new RegExp(`\\b([A-Za-z]+)${APOS}ve\\b`, 'g'), (m, w: string) => `${w} ${aux(m, 'have')}`)
    .replace(new RegExp(`\\b([A-Za-z]+)${APOS}ll\\b`, 'g'), (m, w: string) => `${w} ${aux(m, 'will')}`)
    .replace(
      new RegExp(`\\b(it|that|what|there|here|he|she|who|where|how|when|why)${APOS}s\\b`, 'gi'),
      (m, w: string, offset: number, all: string) => `${w} ${aux(m, hasOrIs(w, all, offset + m.length))}`,
    )
    .replace(
      new RegExp(`\\b(I|you|he|she|it|we|they|who|that|there|what|where|how)${APOS}d\\b`, 'gi'),
      (m, w: string, offset: number, all: string) => `${w} ${aux(m, hadOrWould(all, offset + m.length))}`,
    )
    .replace(BARE_FORMS, (m) => capitalizeLike(m, BARE_NEGATIVES[m.toLowerCase()]!));
}

/* ------------------------------------------------------------------------------------------
 * Times
 * ---------------------------------------------------------------------------------------- */

const CLOCK = '(\\d{1,2})(?:[:.](\\d{2}))?';
// Mixed-case "Am"/"Pm" is left out on purpose: it is far more often a word than a time.
const MERIDIEM = '(a\\.m\\.?|A\\.M\\.?|p\\.m\\.?|P\\.M\\.?|am|AM|pm|PM)';
// "4 AM-B" (a room) or "AM/FM" is not a time; "8 AM-4 PM" still is.
const TIME_END = '(?![A-Za-z0-9/]|[-–][A-Za-z])';
const SHARED_RANGE = new RegExp(`\\b${CLOCK}(\\s*(?:-|–|—|to|until|till|and)\\s*)${CLOCK}\\s?${MERIDIEM}${TIME_END}`, 'g');
const SINGLE_TIME = new RegExp(`\\b${CLOCK}\\s?${MERIDIEM}${TIME_END}`, 'g');
const NOT_TIME_BEFORE =
  /(?:^|[^A-Za-z])(?:room|rooms|gate|gates|terminal|platform|seat|row|flat|apt|apartment|unit|suite|no|number|block|building|floor|level|bus|route|line|chapter|page|section|model|version|category|grade|class|size|type|phase|stage|step|item|table|zone|door|hall|bay|track|lane|exit|ward|bed|box)\.?\s*(?:no\.?\s*)?$/i;

function minutesOf(hour: number, minute: number, pm: boolean): number {
  return ((hour % 12) + (pm ? 12 : 0)) * 60 + minute;
}

function clock24(total: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

function validClock(hour: string, minute: string | undefined): boolean {
  const h = Number(hour);
  const m = minute === undefined ? 0 : Number(minute);
  return h >= 1 && h <= 12 && m <= 59;
}

function looksLikeTime(all: string, offset: number): boolean {
  const before = all.slice(Math.max(0, offset - 24), offset);
  return !/[\d.,:$€£]$/.test(before) && !NOT_TIME_BEFORE.test(before);
}

/** "p.m." at the end of a sentence also carried the full stop; keep it. */
function periodAfter(meridiem: string, rest: string): string {
  return meridiem.endsWith('.') && /^(?:$|\s*\n|\s+["'“(]?[A-Z])/.test(rest) ? '.' : '';
}

/**
 * Rewrites 12-hour clock times as 24-hour ("3:30 PM" -> "15:30", "8 AM to 4 PM" -> "08:00 to
 * 16:00"). On-device models garble AM/PM, and 24-hour digits pass through every language.
 * "noon" and "midnight" are already unambiguous words and stay as they are.
 */
export function normalizeTimes(text: string): string {
  return text
    .replace(SHARED_RANGE, (m, h1: string, m1: string | undefined, joint: string, h2: string, m2: string | undefined, mer: string, offset: number, all: string) => {
      if (!validClock(h1, m1) || !validClock(h2, m2) || !looksLikeTime(all, offset)) return m;
      const pm = mer[0]!.toLowerCase() === 'p';
      const end = minutesOf(Number(h2), Number(m2 ?? 0), pm);
      let start = minutesOf(Number(h1), Number(m1 ?? 0), pm);
      // "10-2 PM" means 10:00 to 14:00; "10-1 AM" runs overnight from 22:00.
      if (start > end) start = minutesOf(Number(h1), Number(m1 ?? 0), !pm);
      return `${clock24(start)}${joint}${clock24(end)}${periodAfter(mer, all.slice(offset + m.length))}`;
    })
    .replace(SINGLE_TIME, (m, h: string, min: string | undefined, mer: string, offset: number, all: string) => {
      if (!validClock(h, min) || !looksLikeTime(all, offset)) return m;
      const total = minutesOf(Number(h), Number(min ?? 0), mer[0]!.toLowerCase() === 'p');
      return clock24(total) + periodAfter(mer, all.slice(offset + m.length));
    });
}

/* ------------------------------------------------------------------------------------------
 * Word senses
 * ---------------------------------------------------------------------------------------- */

interface SenseRule {
  /** Global pattern for the ambiguous wording. */
  pattern: RegExp;
  /** Replacement; `$1`..`$9` refer to the pattern's groups. */
  to: string | ((groups: string[], sentence: string) => string);
  /** The sentence must contain this for the rule to apply. */
  when?: RegExp;
  /** The rule is skipped when the sentence contains this. */
  unless?: RegExp;
}

const UNTIL_CLAUSE_END = '(?=\\s*[.,!?;:)]|\\s*$|\\s+(?:and|but|so|since|for|right|today|now|at|this|again|too|as|from|which|that|or|because|all|last|yesterday|recently|tonight)\\b)';
const plural = (groups: string[], i: number, one: string, many: string): string => (groups[i] ? many : one);

/**
 * Each rule fixes a word whose wrong sense is common or dangerous in travel, food, medical
 * and legal text, and fires only when the sentence makes the intended sense certain.
 */
const SENSE_RULES: SenseRule[] = [
  // "take one tablet twice a day" came back as a tablet computer.
  {
    pattern: /\btablet(s)?\b/gi,
    to: (g) => plural(g, 0, 'pill', 'pills'),
    when: /\b(?:doses?|dosage|daily|a day|per day|twice|once a|every \d+ hours|mg|milligrams?|medicines?|medications?|pharmacy|pharmacist|chemist|prescriptions?|prescribed|painkillers?|paracetamol|acetaminophen|ibuprofen|aspirin|antibiotics?|vitamins?|supplements?|swallow\w*|chew\w*|dissolv\w*|side effects?|with food|with water|meals?|empty stomach|pills?|capsules?|doctor|headache|fever|sleeping|overdose)\b|\b(?:take|takes|took|taking)\s+(?:one|two|three|four|a|an|half a|another|\d+(?:\.\d+)?)\s+tablets?\b/i,
    unless: /\b(?:charg\w*|screen|ipad|android|apps?|wi-?fi|battery|laptop|device|keyboard|stylus|download\w*|stream\w*|games?|samsung|touchscreen|cover|usb|watch\w*|films?|movies?|videos?|photos?|internet|online|e-?mails?)\b/i,
  },
  // Allergy questions: "nuts" came back as hardware or dice. Naming peanuts too keeps the
  // food sense, and errs towards caution because many people include peanuts in "nuts".
  {
    pattern: /\bnuts\b(?!\s+about\b)/gi,
    to: (_, s) => (/\?|\b(?:no|not|without|free|avoid|never|cannot)\b|n['’]t\b/i.test(s) ? 'nuts or peanuts' : 'nuts and peanuts'),
    when: /\b(?:allerg\w*|intoleran\w*|anaphyla\w*|epi-?pen|contains?|containing|traces?|ingredients?|cannot eat|can not eat|do not eat|don['’]t eat|can['’]t eat|avoid)\b/i,
    unless: /\b(?:peanuts?|tree nuts|bolts?|screws?|washers?|wrench|spanner|tighten\w*|loosen\w*|threads?|hardware|steel|metal|go nuts|went nuts|going nuts|drives? me nuts|driving me nuts)\b/i,
  },
  { pattern: /\bnut allerg(y|ies)\b/gi, to: 'nut and peanut allerg$1', unless: /\bpeanut/i },
  // "chest pain" came back as pain in a box; the prepositional form names a body part.
  { pattern: /\bchest pain(s)?\b/gi, to: (g) => plural(g, 0, 'pain in the chest', 'pains in the chest') },
  // Booking: "a table for four" was read as four tables or a table for the number four.
  {
    pattern: /\btable for (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|1[0-9]|20|[1-9])\b(?!\s*(?:people|persons?|guests?|adults?|diners|of\b|pax|weeks?|days?|hours?|minutes?|months?|years?|nights?|o['’]clock|[ap]\.?m\b|[:.,]\d))/gi,
    to: (g) => `table for ${g[0]} ${/^(?:one|1)$/i.test(g[0]!) ? 'person' : 'people'}`,
  },
  // "the bill"/"the check" at a restaurant came back as a banknote, a law or a cheque.
  {
    pattern: /\bthe (?:bill|check|cheque)\b(?!\s+for\b|\s*-\s*(?:in|out)\b)/gi,
    to: 'the bill for the meal',
    when: /\b(?:waiter|waitress|restaurant|meal|dinner|lunch|breakfast|menu|table|food|tip|dessert|cafe|café)\b|\b(?:bring|have|get|ask for|pay|split)\s+(?:us\s+|me\s+)?the\s+(?:bill|check)\b|\bthe\s+(?:bill|check),?\s+please\b/i,
    unless: /\b(?:hotel|room|stay|nights?|check-?out|reception|electricity|electric|phone|gas|utility|utilities|rent|parliament|congress|senate|law|legislation|amendment|passed|government|minister|vote|bank|deposit|cash(?:ed)?|signed?|bounced?|medical|hospital|security|background|spell\w*|doctor)\b/i,
  },
  // "I have a cold" came back as low temperature.
  { pattern: new RegExp(`\\b(have|has|had|having|got|get|gets|getting|caught|catch|catches|catching|with)\\s+a\\s+cold\\b${UNTIL_CLAUSE_END}`, 'gi'), to: '$1 a common cold' },
  {
    pattern: new RegExp(`\\b(have|has|had|having|got|running|run|runs)\\s+a\\s+(high\\s+|slight\\s+|mild\\s+|very high\\s+)?temperature\\b(?=\\s+of\\s+(?:3[89]|4[01])\\b|${UNTIL_CLAUSE_END.slice(3)}`, 'gi'),
    to: '$1 a $2fever',
  },
  // "flu shot" came back as a gunshot or a photo.
  { pattern: /\b(flu|tetanus|booster|covid|covid-19|rabies|allergy|insulin|b12|cortisone|hepatitis|measles|steroid|typhoid|vaccine)\s+shot(s)?\b/gi, to: (g) => `${g[0]} ${plural(g, 1, 'injection', 'injections')}` },
  { pattern: /\bdrug\s?store(s)?\b/gi, to: (g) => plural(g, 0, 'pharmacy', 'pharmacies') },
  // "drugs" in a medical history question came back as narcotics.
  {
    pattern: /\bdrug(s)?\b(?!\s*(?:-|test|tests|testing|company|companies|industry|dealer|dealers|addict|abuse|use|user|users)\b)/gi,
    to: (g) => plural(g, 0, 'medicine', 'medicines'),
    when: /\b(?:prescription|prescribed|pharmacy|pharmacist|doctor|dose|dosage|allerg\w*|side effects?|medical|over-the-counter|blood pressure|diabetes|treatment|patients?|hospital|taking any|currently taking|interact\w*)\b/i,
    unless: /\b(?:illegal|illicit|dealers?|dealing|traffick\w*|smuggl\w*|police|abuse|addict\w*|recreational|cocaine|heroin|cannabis|marijuana|weed|overdosed|cartels?|narcotics?|customs)\b/i,
  },
  // British "chemist" meaning the shop came back as a scientist.
  { pattern: /\b(the|a|nearest|local|nearby)\s+chemist['’]s\b/gi, to: '$1 pharmacy' },
  {
    pattern: /\b(the|a|nearest|local|nearby)\s+chemist\b(?!['’])/gi,
    to: '$1 pharmacy',
    when: /\b(?:where|is there|find|nearest|open|closed|buy|pick up|medicines?|prescriptions?|plasters?|paracetamol|ibuprofen|cough)\b/i,
    unless: /\b(?:works?|worked|as a|is a|was a|be a|become|lab\w*|research\w*|scientist|degree|chemistry|universit\w*|career|job)\b/i,
  },
  {
    pattern: /\b(?:wound\s+)?dressing(s)?\b/gi,
    to: (g) => plural(g, 0, 'wound dressing', 'wound dressings'),
    when: /\b(?:wound|cut|burn|injur\w*|bleed\w*|nurse|stitch\w*|sterile|surgery|surgical|blister|graze|infect\w*|bandage)\b/i,
    unless: /\b(?:salad|sauce|vinaigrette|ranch|caesar|mayo\w*|oil|vinegar|turkey|stuffing|dressing room|dressing gown|window)\b/i,
  },
  {
    pattern: /\b(my|her|your)\s+period(s)?\b(?!\s+of\b)/gi,
    to: (g) => `${g[0]} menstrual ${plural(g, 1, 'period', 'periods')}`,
    when: /\b(?:late|missed|miss|cramps?|pain\w*|heavy|started|irregular|pregnan\w*|tampons?|pads?|bleed\w*|cycle)\b/i,
    unless: /\b(?:trial|probation\w*|notice|waiting|grace|billing|payment|contract|warranty|class|lesson|school|menstrua\w*)\b/i,
  },
  { pattern: new RegExp(`\\bon the pill\\b${UNTIL_CLAUSE_END}`, 'gi'), to: 'on the contraceptive pill' },
  // Travel: "restroom" came back as a lounge, "Where is the bathroom" as a room with a bath.
  { pattern: /\b(?:rest|wash)room(s)?\b/gi, to: (g) => plural(g, 0, 'toilet', 'toilets') },
  {
    pattern: /\bbathroom(s)?\b/gi,
    to: (g) => plural(g, 0, 'toilet', 'toilets'),
    when: /\b(?:where|nearest|use the|need the|need to go|find the|go to the|looking for|public)\b/i,
    unless: /\b(?:hotel room|bedroom|apartment|flat|house|clean\w*|renovat\w*|tiles?|shower|bathtub|bath|sink|en-?suite|private|shared|kitchen|mirror)\b/i,
  },
  // British "lift" (elevator) came back as a car ride or as lifting.
  {
    pattern: /\b(the|a)\s+lift(s)?\b/gi,
    to: (g) => `${g[0]} ${plural(g, 1, 'elevator', 'elevators')}`,
    when: /\b(?:floors?|stairs|ground|basement|lobby|button|out of order|broken|not working|wheelchair|take the lift|use the lift|in the lift)\b/i,
    unless: /\b(?:give|gave|giving|offer\w*|need a lift|ride|car|drive|ski|chair ?lift|weights?|face ?lift|airport|station|home)\b/i,
  },
  // British "flat" (apartment) came back as the adjective.
  {
    pattern: /\b(my|our|your|his|her|their|the|a|this|that|shared|rented|studio|one-bedroom|two-bedroom|1-bedroom|2-bedroom)\s+flat\b(?![-\s]*(?:tyres?|tires?|rates?|fees?|screens?|shoes|white|surface|iron|out|cap|bread|pack|panel|file|top|line|stomach|feet|foot|road|ground|sheet|price|tax|bottom|roof)\b)/gi,
    to: (g) => `${/^a$/i.test(g[0]!) ? `${g[0]}n` : g[0]} apartment`,
    when: /\b(?:rent|rented|renting|live|lives|living|lived|landlord|landlady|bedrooms?|move|moving|moved|share|sharing|lease|kitchen|stay|staying|neighbou?rs?|floor|block|building|tenant|flatmate|deposit|furnished)\b/i,
    unless: /\b(?:tyre|tire|puncture|battery|beer|soda|lemonade|champagne|music|note|key|singing|pitch|land|terrain|earth|surface)\b/i,
  },
  // British ticket types came back as "returned ticket" and "unmarried ticket".
  { pattern: /\breturn (ticket|fare)(s)?\b/gi, to: (g) => `round-trip ${g[0]}${g[1] ?? ''}` },
  {
    pattern: /\bsingle (ticket|fare)(s)?\b/gi,
    to: (g) => `one-way ${g[0]}${g[1] ?? ''}`,
    when: /\b(?:train|bus|coach|rail|railway|station|metro|underground|tube|subway|tram|ferry|platform)\b/i,
    unless: /\b(?:concert|show|match|game|cinema|movie|film|museum|event|festival)\b/i,
  },
  // "book a room" came back with "book" as the noun.
  {
    pattern: /\b(?:(the|a|an|my|your|his|her|our|their|this|that)\s+)?(book|books|booked|booking)\s+(?=(?:a|an|the|my|our|two|three|four|\d+)\s+(?:rooms?|table|flights?|tickets?|seats?|taxi|cab|hotel|tour|trip|car|bed|place|spot|session|class|court|slot|nights?|double|single|twin|return|one-way|appointment)\b)/gi,
    to: (g, s) => {
      if (g[0]) return `${g[0]} ${g[1]} `; // "the book a friend lent" is the noun
      const appointment = /\bappointment\b/i.test(s);
      const forms: Record<string, [string, string]> = {
        book: ['reserve', 'schedule'],
        books: ['reserves', 'schedules'],
        booked: ['reserved', 'scheduled'],
        booking: ['reserving', 'scheduling'],
      };
      return `${forms[g[1]!.toLowerCase()]![appointment ? 1 : 0]} `;
    },
  },
  // Legal and traffic "fine" came back as "good".
  { pattern: /\b(parking|speeding|traffic|library|heavy|hefty)\s+fine(s)?\b/gi, to: (g) => `${g[0]} ${plural(g, 1, 'penalty', 'penalties')}` },
  {
    pattern: new RegExp(`\\b(pay|paid|paying|pays|get|got|getting|gets|receive|received|receiving|issued|issue|issues|face|faced|faces|facing|risk|risks|impose|imposed|incur|incurred|charged)\\s+(a|the|any|this|that|no)\\s+fine(s)?\\b(?=\\s+(?:of|for|if|when|after|in|on)\\b|${UNTIL_CLAUSE_END.slice(3)}`, 'gi'),
    to: (g) => `${g[0]} ${g[1]} ${plural(g, 2, 'penalty', 'penalties')}`,
  },
  {
    pattern: /\b(a|the|any|no|small|generous|extra)\s+tip\b/gi,
    to: '$1 gratuity',
    when: /\b(?:included|include|leave|leaving|waiter|waitress|restaurant|bill|service charge|driver|percent|how much|expected|customary)\b|%/i,
    unless: /\b(?:useful|helpful|great tip|good tip|advice|hint|pen|finger|tongue|iceberg|top tip|tip (?:on|for)|cigarette|rubbish|dump|tip-off)\b/i,
  },
  {
    pattern: /\b(a|the|two|three|our|my|some|as a|for a)\s+starter(s)?\b/gi,
    to: (g) => `${g[0]} ${plural(g, 1, 'appetizer', 'appetizers')}`,
    when: /\b(?:menu|order|ordered|main|mains|dessert|course|soup|salad|share|sharing|dinner|lunch|restaurant)\b/i,
    unless: /\b(?:for starters|engine|motor|car|sourdough|starter (?:pack|kit|home)|self-starter|non-starter)\b/i,
  },
  // American "fall" (season) came back as falling, which in medical text reads as an injury.
  {
    pattern: /\b(in the|this|last|next|early|late|during the|until the|by the|every)\s+fall\b(?!\s+(?:of|from|in|on|down|off|over|apart|behind|asleep|ill|sick|into|through|out|for|back|short)\b)/gi,
    to: '$1 autumn',
    unless: /\b(?:hurt|injur\w*|broke|broken|hip|wrist|ankle|slipped|tripped|hospital|fell|fallen|bruis\w*|landed|ladder|stairs|elderly|dizzy|faint\w*|risk|prevent\w*|stocks?|prices?|market|shares|rain|snow|water)\b/i,
  },
  { pattern: /\bfall (semester|term|season|20\d\d)\b/gi, to: 'autumn $1' },
  // Contracts: "the parties" came back as celebrations.
  {
    pattern: /\b(either|each|both|neither|the other|any|the|a|one)\s+(part(?:y|ies))\b/gi,
    to: '$1 contracting $2',
    when: /\b(?:hereby|herein|hereto|thereof|shall|agreement|contract|clause|obligations?|liab\w*|breach|indemnif\w*|governed|signator(?:y|ies)|binding|terminat\w*)\b/i,
    unless: /\b(?:birthday|dinner|celebrat\w*|guests?|invit\w*|political|labou?r|democratic|republican|conservative|elect\w*|votes?|voting|contracting)\b/i,
  },
  // Steak doneness: "well done" came back as praise, "rare" as uncommon.
  {
    pattern: /\bwell[- ]done\b/gi,
    to: 'fully cooked',
    when: /\b(?:steaks?|burgers?|meat|beef|lamb|cooked|cook|how would you like|medium|rare|grill\w*|pork)\b/i,
    unless: /\b(?:job|work|team|congratulations|congrats|bravo|everyone|guys|you did|exams?|tests?|results?)\b/i,
  },
  {
    pattern: /\b(steaks?|burgers?|it|them)\s+(cooked\s+)?rare\b|\brare\s+(steaks?|burgers?|beef|lamb)\b/gi,
    to: (g) => (g[2] ? `lightly cooked ${g[2]}` : `${g[0]} lightly cooked`),
    when: /\b(?:steaks?|burgers?|meat|beef|lamb|cooked|cook|how would you like)\b/i,
    unless: /\b(?:medium|disease|condition|species|book|coin|stamp|occasion|chance|cases?|bird|animal|collect\w*)\b/i,
  },
  {
    pattern: /\bhot\b(?![-\s]*(?:dogs?|pot|springs?|tub|chocolate|water|weather|day|drinks?|line|spot|keys?)\b)/gi,
    to: 'spicy',
    when: /\b(?:spicy|spices?|chil+[ie]s?|chilli|peppers?|curry|curries|sauce|salsa|mild|jalape\w*|wasabi|sriracha|tabasco|harissa)\b/i,
    unless: /\b(?:temperature|weather|outside|sun|summer|room|shower|oven|stove|burn\w*|coffee|tea|soup|plate|degrees|fever|microwave|heat(?:ed)? up)\b/i,
  },
  // "still water" came back as "water still"/"yet water".
  {
    pattern: /\b(a|some|of|the|or|prefer|want|like)\s+still\s+(mineral\s+)?water\b/gi,
    to: '$1 non-sparkling $2water',
    unless: /\b(?:lake|pond|river|sea|lagoon|pool|surface|reflect\w*|deep|calm)\b/i,
  },
  { pattern: /\bstill or sparkling\b/gi, to: 'non-sparkling or sparkling' },
  { pattern: /\bsparkling or still\b/gi, to: 'sparkling or non-sparkling' },
];

function applyRule(sentence: string, rule: SenseRule): string {
  if (rule.when && !rule.when.test(sentence)) return sentence;
  if (rule.unless && rule.unless.test(sentence)) return sentence;
  return sentence.replace(rule.pattern, (...args: unknown[]) => {
    const match = args[0] as string;
    const groups = args.slice(1, -2).map((g) => (typeof g === 'string' ? g : '')) as string[];
    const out =
      typeof rule.to === 'string'
        ? rule.to.replace(/\$(\d)/g, (_, n: string) => groups[Number(n) - 1] ?? '')
        : rule.to(groups, sentence);
    return /^[A-Z]/.test(match) && /^[a-z]/.test(out) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
  });
}

/**
 * Rewrites a small set of ambiguous words to an unambiguous equivalent when the sentence
 * makes the intended sense certain ("take one tablet a day" -> "take one pill a day").
 */
export function disambiguate(text: string): string {
  return joinSegments(
    splitSentences(text).map((seg) => ({ ...seg, text: SENSE_RULES.reduce(applyRule, seg.text) })),
  );
}

/* ------------------------------------------------------------------------------------------
 * Names and terms
 * ---------------------------------------------------------------------------------------- */

interface Span {
  start: number;
  end: number;
}

interface Token extends Span {
  text: string;
}

const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;
// Spans that are never touched: earlier placeholders and the things protectEntities shields.
const UNTOUCHABLE: RegExp[] = [
  /\{\{\s*\d+\s*\}\}/g,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\b(?:https?:\/\/|www\.)\S+/g,
  /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|co|ai|me|edu|gov|info|biz)\b(?:\/\S*)?/gi,
];
const WORD = /[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-z0-9À-ÖØ-öø-ÿ'’-]*[A-Za-z0-9À-ÖØ-öø-ÿ]|[A-Za-zÀ-ÖØ-öø-ÿ]/g;
const CODE_TOKEN = /(^|[^\w.#+])(C#|C\+\+|F#|Objective-C|ASP\.NET|\.NET|[A-Za-z][A-Za-z0-9]*\.js)(?![\w#+])/g;
const CAMEL = /\b[A-Za-z]*[a-z][A-Z][A-Za-z0-9]*\b/g;
const LETTERS_DIGITS = /\b[A-Za-z]+\d[A-Za-z0-9]*\b/g;
const ACRONYM = /\b[A-Z]{2,6}(?:-\d{1,4})?s?\b/g;
const QUOTED = /["“]([^"“”\n]{3,80}?)["”]/g;
const DEGREES = new Set(['PhD', 'BSc', 'MSc', 'BEng', 'MEng', 'BCom', 'MPhil', 'DPhil', 'BEd', 'MEd']);
const MINOR_TITLE_WORDS = new Set('a an the and or of in on at to for with from by nor but vs'.split(' '));
const HONORIFIC = /^(?:Mr|Mrs|Ms|Miss|Dr|Prof|Sheikh|Sheikha|Sir|Dame)$/;
const POSSESSIVE = /['’]s$/;

function phraseRegex(phrases: readonly string[]): RegExp {
  const parts = [...phrases]
    .sort((a, b) => b.length - a.length)
    .map((p) => {
      const body = p.replace(/^The /, '').split(' ').map(escapeRe).join('\\s+');
      return p.startsWith('The ') ? `(?:[Tt]he\\s+)?${body}` : body;
    });
  return new RegExp(`\\b(?:${parts.join('|')})(?![\\w-])`, 'g');
}

const TITLES_RE = phraseRegex(WORK_TITLES);
const PHRASES_RE = phraseRegex(PHRASE_TERMS);
const SURNAME_AT = new RegExp(
  `^\\s+((?:(?:${SURNAME_PARTICLES})(?:\\s+|-))*)((?:O['’]|Mc|Mac|D['’])?[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]+(?:-[A-Za-zÀ-ÖØ-öø-ÿ][a-zà-öø-ÿ]+)*(?:['’]s)?)`,
);
const GIVEN_AFTER_FAMILY = /^\s+([A-Z][a-z]+(?:-[A-Za-z][a-z]+)?)/;
const APPLE_CONTEXT =
  /\b(?:iPhones?|iPads?|Mac|MacBook|iOS|macOS|iCloud|AirPods|Samsung|Google|Microsoft|company|CEO|stock|shares|announced|launched|released|products?|devices?)\b|\bApple\s+(?:Inc|Store|TV|ID|Watch|Music|Pay)\b/;

function spansOf(re: RegExp, text: string, offset: number, prefixGroup = false): Span[] {
  const out: Span[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const lead = prefixGroup ? (m[1] ?? '').length : 0;
    out.push({ start: offset + m.index + lead, end: offset + m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

function tokensOf(text: string, offset: number): Token[] {
  const out: Token[] = [];
  WORD.lastIndex = 0;
  for (let m = WORD.exec(text); m; m = WORD.exec(text)) {
    out.push({ text: m[0], start: offset + m.index, end: offset + m.index + m[0].length });
  }
  return out;
}

const isCommon = (word: string): boolean => COMMON_WORDS.has(word.toLowerCase());

interface SentenceInfo {
  text: string;
  offset: number;
  tokens: Token[];
  /** Ordinary words capitalized, as in "Managed Cross-Functional Teams Using Slack". */
  titleCase: boolean;
  /** Shouted or a heading ("WORK EXPERIENCE", "DO NOT ENTER"). */
  heading: boolean;
  /** About software or technology, which makes "Swift" or "Unity" product names. */
  tech: boolean;
}

function describe(text: string, offset: number): SentenceInfo {
  const tokens = tokensOf(text, offset);
  const ordinary = tokens.slice(1).filter((t) => t.text.length >= 3 && isCommon(t.text));
  const capitalized = ordinary.filter((t) => /^[A-Z]/.test(t.text)).length;
  const caps = tokens.filter((t) => t.text.length >= 2 && /[A-Z]/.test(t.text) && !/[a-z]/.test(t.text));
  const shouty = caps.filter((t) => isCommon(t.text) || t.text.length > 6).length;
  const words = tokens.filter((t) => t.text.length >= 2).length;
  PHRASES_RE.lastIndex = 0;
  return {
    text,
    offset,
    tokens,
    titleCase: capitalized >= 2 && capitalized / ordinary.length >= 0.6,
    heading: shouty >= 2 || (shouty >= 1 && caps.length === words),
    tech: TECH_CONTEXT.test(text) || PHRASES_RE.test(text) || tokens.some((t) => ALWAYS_TERMS.has(t.text.replace(POSSESSIVE, ''))),
  };
}

/** Surname tokens after `from`; null when the words turn out to name a place. */
function surnameEnd(s: SentenceInfo, from: number, max: number): number | null {
  let pos = from - s.offset;
  let end = -1;
  for (let count = 0; count < max; count++) {
    const m = SURNAME_AT.exec(s.text.slice(pos));
    if (!m) break;
    const core = m[2]!.replace(POSSESSIVE, '');
    if (PLACE_WORDS.has(core) || PLACE_NAMES.has(core)) return null;
    if (isCommon(core)) break;
    pos += m[0].length;
    end = pos - (m[2]!.length - core.length);
    if (core !== m[2]) break; // a possessive ends the name
  }
  if (end < 0) return null;
  const next = /^\s+([A-Z][a-z]+)/.exec(s.text.slice(end))?.[1];
  return next && PLACE_WORDS.has(next) ? null : s.offset + end;
}

function nameSpans(s: SentenceInfo): Span[] {
  const out: Span[] = [];
  s.tokens.forEach((t, i) => {
    let end: number | null = null;
    if (GIVEN_NAMES.has(t.text) && !(AMBIGUOUS_GIVEN.has(t.text) && (s.titleCase || s.heading))) {
      const initial = /^\s+[A-Z]\./.exec(s.text.slice(t.end - s.offset))?.[0].length ?? 0;
      end = surnameEnd(s, t.end + initial, 3);
    } else if (SURNAMES_FIRST.has(t.text) && !s.heading && !s.titleCase) {
      const given = GIVEN_AFTER_FAMILY.exec(s.text.slice(t.end - s.offset));
      const word = given?.[1];
      if (word && !isCommon(word) && !PLACE_WORDS.has(word) && !PLACE_NAMES.has(word)) {
        const next = /^\s+([A-Z][a-z]+)/.exec(s.text.slice(t.end - s.offset + given![0].length))?.[1];
        end = next && PLACE_WORDS.has(next) ? null : t.end + given![0].length;
      }
    } else if (HONORIFIC.test(t.text)) {
      // "Mr. Al-Sabah": keep the title translatable, protect only the surname.
      const dot = s.text.charAt(t.end - s.offset) === '.' ? 1 : 0;
      const close = surnameEnd(s, t.end + dot, 3);
      const first = s.tokens[i + 1];
      if (close !== null && first) out.push({ start: first.start, end: close });
      return;
    }
    if (end === null) return;
    const candidate = s.text.slice(t.start - s.offset, end - s.offset);
    if ([...NAME_LIKE_PLACES].some((p) => candidate.startsWith(p))) return;
    out.push({ start: t.start, end });
  });
  return out;
}

function termSpans(s: SentenceInfo): Span[] {
  const out: Span[] = [];
  s.tokens.forEach((t, i) => {
    const word = t.text.replace(POSSESSIVE, '');
    const span = { start: t.start, end: t.start + word.length };
    const before = s.text.slice(0, t.start - s.offset);
    const after = s.text.slice(span.end - s.offset);
    const midSentence = i > 0 && !s.titleCase && !s.heading;
    if (ALWAYS_TERMS.has(t.text) || ALWAYS_TERMS.has(word)) {
      out.push(ALWAYS_TERMS.has(t.text) ? { start: t.start, end: t.end } : span);
    } else if (MID_SENTENCE_TERMS.has(word)) {
      if (word === 'Amazon' && /\b[Tt]he\s+$/.test(before)) return; // the river or rainforest
      if (!s.heading && (midSentence || s.tech)) out.push(span);
    } else if (word === 'Go') {
      const programming =
        /\b(?:in|with|using|and|or|like|learn|learning|know|knowing|written in)\s+$/.test(before) ||
        /^\s+(?:developer|developers|code|programming|language|modules?|routines?|backend|services?|compiler)\b/.test(after);
      if (midSentence && s.tech && programming) out.push(span);
    } else if (word === 'Teams') {
      if (midSentence && (/\b(?:on|via|in|over|using|use|through)\s+$/i.test(before) || /^\s+(?:calls?|meetings?|chats?|channels?)\b/i.test(after))) {
        out.push(span);
      }
    } else if (word === 'Apple') {
      if (!s.heading && !s.titleCase && !/\ban?\s+$/i.test(before) && APPLE_CONTEXT.test(s.text)) out.push(span);
    }
  });
  return out;
}

function quotedTitleSpans(s: SentenceInfo): Span[] {
  const out: Span[] = [];
  QUOTED.lastIndex = 0;
  for (let m = QUOTED.exec(s.text); m; m = QUOTED.exec(s.text)) {
    const inner = m[1]!;
    const words = inner.trim().split(/\s+/);
    const capitalized = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
    const titleLike = words.every((w) => /^[A-Z0-9]/.test(w) || MINOR_TITLE_WORDS.has(w));
    if (words.length < 2 || words.length > 8 || capitalized < 2 || !titleLike || /[.!?]$/.test(inner)) continue;
    const start = s.offset + m.index + 1;
    out.push({ start, end: start + inner.length });
  }
  return out;
}

function acronymSpans(s: SentenceInfo): Span[] {
  if (s.heading) return [];
  return spansOf(ACRONYM, s.text, s.offset).filter((sp) => {
    const token = s.text.slice(sp.start - s.offset, sp.end - s.offset);
    const base = token.replace(/-\d+$/, '').replace(/s$/, '');
    return !CAPS_TO_TRANSLATE.has(base) && !isCommon(base);
  });
}

function mixedSpans(s: SentenceInfo): Span[] {
  const camel = spansOf(CAMEL, s.text, s.offset).filter((sp) => !DEGREES.has(s.text.slice(sp.start - s.offset, sp.end - s.offset)));
  return [...camel, ...spansOf(LETTERS_DIGITS, s.text, s.offset), ...spansOf(CODE_TOKEN, s.text, s.offset, true)];
}

function sentencesOf(text: string): SentenceInfo[] {
  const out: SentenceInfo[] = [];
  let offset = 0;
  for (const seg of splitSentences(text)) {
    if (seg.text) out.push(describe(seg.text, offset));
    offset += seg.text.length + seg.sep.length;
  }
  return out;
}

/** Longest match wins; anything overlapping an untouchable span is dropped. */
function choose(candidates: Span[], blocked: Span[]): Span[] {
  const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
  const sorted = candidates
    .filter((c) => c.end > c.start && !blocked.some((b) => overlaps(b, c)))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const c of sorted) if (!out.length || c.start >= out[out.length - 1]!.end) out.push(c);
  return out;
}

function firstFreeIndex(text: string): number {
  let next = 0;
  PLACEHOLDER.lastIndex = 0;
  for (let m = PLACEHOLDER.exec(text); m; m = PLACEHOLDER.exec(text)) next = Math.max(next, Number(m[1]) + 1);
  return next;
}

/**
 * Shields product and library names, acronyms, well-known titles and people's names with
 * the same {{n}} placeholders as protectEntities, numbering after any placeholders already
 * in the text so the two compose. restore() fills in only its own placeholders and leaves
 * lower-numbered ones for the earlier layer; it returns null if any of its own went missing.
 * Places are deliberately left alone: "Paris" or "Jordan Valley" should be translated.
 */
export function protectTerms(input: string): Protected {
  const base = firstFreeIndex(input);
  const blocked = UNTOUCHABLE.flatMap((re) => spansOf(re, input, 0));
  const candidates = sentencesOf(input).flatMap((s) => [
    ...spansOf(TITLES_RE, s.text, s.offset),
    ...spansOf(PHRASES_RE, s.text, s.offset),
    ...quotedTitleSpans(s),
    ...nameSpans(s),
    ...termSpans(s),
    ...mixedSpans(s),
    ...acronymSpans(s),
  ]);
  const saved: string[] = [];
  let text = '';
  let last = 0;
  for (const span of choose(candidates, blocked)) {
    text += `${input.slice(last, span.start)}{{${base + saved.length}}}`;
    saved.push(input.slice(span.start, span.end));
    last = span.end;
  }
  text += input.slice(last);
  return {
    text,
    restore(translated) {
      if (!saved.length) return translated;
      const seen = new Set<number>();
      let ok = true;
      const out = translated.replace(PLACEHOLDER, (m, n: string) => {
        const i = Number(n) - base;
        if (i < 0) return m;
        if (i >= saved.length || seen.has(i)) {
          ok = false;
          return '';
        }
        seen.add(i);
        return saved[i]!;
      });
      return ok && seen.size === saved.length ? out : null;
    },
  };
}

/** protectEntities followed by protectTerms, with one restore that undoes both. */
export function protectForTranslation(input: string): Protected {
  const entities = protectEntities(input);
  const terms = protectTerms(entities.text);
  return {
    text: terms.text,
    restore(translated) {
      const partial = terms.restore(translated);
      return partial === null ? null : entities.restore(partial);
    },
  };
}
