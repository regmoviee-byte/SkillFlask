import { describe, expect, it } from 'vitest';
import { foldText, highlightFragments, isSearchFilter, matchesTerms, searchTerms, snippetStart } from './search';

const marked = (text: string, query: string) =>
  highlightFragments(text, searchTerms(query))
    .map((f) => (f.hit ? `[${f.text}]` : f.text))
    .join('');

describe('foldText', () => {
  it('lowers the case and reads «ё» as «е», one character for one', () => {
    expect(foldText('Ёжик в ТУМАНЕ, Ёлка')).toBe('ежик в тумане, елка');
    expect(foldText('Ёжик').length).toBe(4);
  });

  it('keeps characters whose lower case would change the length, and emoji whole', () => {
    expect(foldText('İstanbul')).toBe('İstanbul');
    expect(foldText('Бег 🏃 утром')).toBe('бег 🏃 утром');
    expect(foldText('Бег 🏃 утром').length).toBe('Бег 🏃 утром'.length);
  });
});

describe('searchTerms', () => {
  it('trims, splits on any whitespace and folds', () => {
    expect(searchTerms('  Разговор\tс  Ёжиком \n')).toEqual(['разговор', 'с', 'ежиком']);
  });

  it('is empty for a blank query', () => {
    expect(searchTerms('')).toEqual([]);
    expect(searchTerms('   \n ')).toEqual([]);
  });

  it('drops repeats and words inside a longer word of the query', () => {
    expect(searchTerms('чтение Чтение')).toEqual(['чтение']);
    expect(searchTerms('чте чтение вслух')).toEqual(['чтение', 'вслух']);
  });
});

describe('matchesTerms', () => {
  it('matches regardless of case and «ё» / «е» both ways', () => {
    expect(matchesTerms(['Ёлочные игрушки'], searchTerms('елочные'))).toBe(true);
    expect(matchesTerms(['Елочные игрушки'], searchTerms('ЁЛОЧНЫЕ'))).toBe(true);
  });

  it('needs every word, each anywhere in the texts', () => {
    const texts = ['Разговорная практика', 'Говорили про путешествия'];
    expect(matchesTerms(texts, searchTerms('практика путешеств'))).toBe(true);
    expect(matchesTerms(texts, searchTerms('практика футбол'))).toBe(false);
  });

  it('treats regular-expression characters literally', () => {
    expect(matchesTerms(['C++ и (немного) Rust'], searchTerms('c++'))).toBe(true);
    expect(matchesTerms(['C++ и (немного) Rust'], searchTerms('(немного)'))).toBe(true);
    expect(matchesTerms(['Чтение'], searchTerms('.*'))).toBe(false);
    expect(matchesTerms(['Цена 5.5$ [итог]'], searchTerms('5.5$ [итог]'))).toBe(true);
    expect(matchesTerms(['a\\b'], searchTerms('\\'))).toBe(true);
  });

  it('skips missing texts and matches everything with no words', () => {
    expect(matchesTerms(['Бег', null, undefined, ''], searchTerms('бег'))).toBe(true);
    expect(matchesTerms([null], searchTerms('бег'))).toBe(false);
    expect(matchesTerms(['что угодно'], [])).toBe(true);
  });
});

describe('highlightFragments', () => {
  it('marks every occurrence, keeping the original letters', () => {
    expect(marked('Ёлка и ещё одна ёлка', 'елка')).toBe('[Ёлка] и ещё одна [ёлка]');
    expect(marked('Чтение вслух', 'ЧТЕНИЕ')).toBe('[Чтение] вслух');
  });

  it('merges overlapping and touching matches of different words', () => {
    expect(marked('разговорник', 'разговор орник')).toBe('[разговорник]');
    expect(marked('абвгд', 'аб вг')).toBe('[абвг]д');
  });

  it('marks special characters as typed', () => {
    expect(marked('Учил C++ и C#', 'c++ c#')).toBe('Учил [C++] и [C#]');
  });

  it('returns the text as one plain fragment without a match, and nothing for an empty text', () => {
    expect(highlightFragments('Бег', ['плавание'])).toEqual([{ text: 'Бег', hit: false }]);
    expect(highlightFragments('', ['бег'])).toEqual([]);
  });
});

describe('snippetStart', () => {
  it('starts at 0 when the first match is near the start or missing', () => {
    expect(snippetStart('Короткая заметка про бег', searchTerms('бег'))).toBe(0);
    expect(snippetStart('x'.repeat(100), searchTerms('бег'))).toBe(0);
  });

  it('starts shortly before a deep match, at the start of a word', () => {
    const text = 'Сегодня долго разминались, потом прошли всю программу и в самом конце попробовали интервалы';
    const start = snippetStart(text, searchTerms('интервалы'));
    expect(start).toBeGreaterThan(0);
    expect(text[start - 1]).toBe(' ');
    expect(text.slice(start)).toContain('интервалы');
    expect(text.indexOf('интервалы') - start).toBeLessThanOrEqual(24);
  });

  it('follows the earliest of several words', () => {
    const text = `${'а '.repeat(30)}бег ${'б '.repeat(30)}плавание`;
    expect(text.slice(snippetStart(text, searchTerms('плавание бег')))).toMatch(/^.{0,24}бег/);
  });
});

describe('isSearchFilter', () => {
  it('knows the three filters', () => {
    expect(['all', 'notes', 'marks'].every(isSearchFilter)).toBe(true);
    expect(isSearchFilter('other')).toBe(false);
    expect(isSearchFilter(null)).toBe(false);
  });
});
