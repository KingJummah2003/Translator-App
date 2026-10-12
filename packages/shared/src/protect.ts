/**
 * Shields things a translation engine must not touch — email addresses, web addresses and
 * phone numbers — by swapping them for {{n}} placeholders before translating and putting
 * them back afterwards. On-device models otherwise "translate" them (linkedin.com became
 * "linkinedin.com" in testing). The {{n}} form survived intact in every script we tested;
 * if an engine still drops or duplicates one, restore() returns null and the caller should
 * translate the original text instead.
 */

const PATTERNS: RegExp[] = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // email
  /\b(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)]/g, // URL with scheme or www
  /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|co|ai|me|edu|gov|info|biz|kw|sa|ae|uk|de|fr|es|it|nl|ru|cn|jp|in|br|ca|au)(?:\/[^\s<>"']*[^\s<>"'.,;:!?)])?\b/gi, // bare domain
  /\+?\d[\d\s().-]{6,}\d/g, // phone number (7+ digits)
];

export interface Protected {
  text: string;
  restore(translated: string): string | null;
}

export function protectEntities(input: string): Protected {
  const saved: string[] = [];
  let text = input;
  for (const pattern of PATTERNS) {
    text = text.replace(pattern, (match) => {
      // Already inside a placeholder from an earlier pattern.
      if (/^\{\{\d+\}\}$/.test(match)) return match;
      saved.push(match);
      return `{{${saved.length - 1}}}`;
    });
  }
  return {
    text,
    restore(translated) {
      if (!saved.length) return translated;
      const seen = new Set<number>();
      let ok = true;
      const out = translated.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => {
        const i = Number(n);
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

/** Translates with entity protection, falling back to the plain text if placeholders broke. */
export async function translateProtected(text: string, translate: (t: string) => Promise<string>): Promise<string> {
  const p = protectEntities(text);
  if (p.text === text) return translate(text);
  const restored = p.restore(await translate(p.text));
  return restored ?? translate(text);
}
