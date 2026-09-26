// Matching and highlighting for «Поиск по истории» (v0.5 package 17), pure. A query is split
// into words; an entry matches when every word occurs somewhere in its texts (the step's name
// as it was recorded, the note, a mark's title and description). Case never matters, «ё» is
// «е», and the query is plain text: no character has a special meaning (no RegExp is built).

/** Which entries a search looks at: every kind, completions with a note, or marks only. */
export type SearchFilter = 'all' | 'notes' | 'marks';

export const SEARCH_FILTERS: readonly SearchFilter[] = ['all', 'notes', 'marks'];

export const isSearchFilter = (value: unknown): value is SearchFilter => SEARCH_FILTERS.includes(value as SearchFilter);

/**
 * Folds a text for matching: lower case, «ё» → «е». One UTF-16 unit in, one out (a character
 * whose lower case is longer, like «İ», is kept as it is), so an index into the folded text is
 * an index into the original: the highlight marks exactly what was typed.
 */
export function foldText(text: string): string {
  let out = '';
  for (const ch of text) {
    // Astral characters (emoji) never match a letter: kept whole, two units as they were.
    let lower = ch.length === 1 ? ch.toLowerCase() : ch;
    if (lower.length !== ch.length) lower = ch;
    out += lower === 'ё' ? 'е' : lower;
  }
  return out;
}

/** The words of a query, folded, without repeats and without a word contained in a longer one. */
export function searchTerms(query: string): string[] {
  const words = [...new Set(foldText(query.trim()).split(/\s+/).filter(Boolean))];
  // «чте чтение»: the shorter word adds nothing to either the match or the highlight.
  return words.filter((word) => !words.some((other) => other !== word && other.includes(word)));
}

/** Every term occurs in at least one of the texts (empty terms match everything). */
export function matchesTerms(texts: readonly (string | null | undefined)[], terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const folded = texts.filter((text): text is string => Boolean(text)).map(foldText);
  return terms.every((term) => folded.some((text) => text.includes(term)));
}

export interface Fragment {
  text: string;
  /** Part of a match: drawn as <mark>. */
  hit: boolean;
}

/**
 * The text cut into plain and matched fragments, in order; overlapping and touching matches of
 * different terms merge into one. Without a match the whole text is one plain fragment.
 */
export function highlightFragments(text: string, terms: readonly string[]): Fragment[] {
  if (!text) return [];
  const folded = foldText(text);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) ranges.push([at, at + term.length]);
  }
  if (ranges.length === 0) return [{ text, hit: false }];
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const out: Fragment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) out.push({ text: text.slice(cursor, start), hit: false });
    out.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}

/** Characters kept before the first match of a long text. */
const SNIPPET_LEAD = 24;
/** A text whose first match starts later than this is shown from shortly before it. */
const SNIPPET_FROM = 40;

/**
 * Where to start showing a text in a one-line result so its first match is on screen: 0 when the
 * match is near the start (or there is none), else about SNIPPET_LEAD characters before it, at
 * the start of a word when one is near. The screen puts «…» in front.
 */
export function snippetStart(text: string, terms: readonly string[]): number {
  const folded = foldText(text);
  let first = -1;
  for (const term of terms) {
    const at = folded.indexOf(term);
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  if (first <= SNIPPET_FROM) return 0;
  const from = first - SNIPPET_LEAD;
  const space = text.indexOf(' ', from);
  return space !== -1 && space < first ? space + 1 : from;
}
