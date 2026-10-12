import { describe, expect, it } from 'vitest';
import { protectEntities, translateProtected } from './protect';

describe('protectEntities', () => {
  it('shields emails, web addresses and phone numbers and restores them', () => {
    const p = protectEntities('Mail sara@example.com, see linkedin.com/in/sara-example or https://example.org/cv, call +965 5550 0100.');
    expect(p.text).toBe('Mail {{0}}, see {{2}} or {{1}}, call {{3}}.');
    expect(p.restore('Courriel {{0}}, voir {{2}} ou {{1}}, appelez {{3}}.')).toBe(
      'Courriel sara@example.com, voir linkedin.com/in/sara-example ou https://example.org/cv, appelez +965 5550 0100.',
    );
  });

  it('accepts placeholders with spaces and rejects dropped or duplicated ones', () => {
    const p = protectEntities('Write to a@b.com or c@d.org');
    expect(p.restore('اكتب إلى {{ 0 }} أو {{1}}')).toBe('اكتب إلى a@b.com أو c@d.org');
    expect(p.restore('اكتب إلى {{0}}')).toBeNull();
    expect(p.restore('{{0}} {{0}} {{1}}')).toBeNull();
  });

  it('falls back to translating the original when placeholders break', async () => {
    const calls: string[] = [];
    const out = await translateProtected('Email a@b.com now', async (t) => {
      calls.push(t);
      return t.includes('{{0}}') ? 'broken' : `[x] ${t}`;
    });
    expect(calls).toEqual(['Email {{0}} now', 'Email a@b.com now']);
    expect(out).toBe('[x] Email a@b.com now');
  });

  it('leaves ordinary text and short numbers alone', () => {
    expect(protectEntities('I have 3 cats and 12,500 dollars').text).toBe('I have 3 cats and 12,500 dollars');
  });
});
