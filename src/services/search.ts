// «Поиск по истории» (v0.5 package 17): one skill's history or every skill's, over the journal
// tables. What a search finds is a completion (its own row in the history, cancelled ones
// included: they stay in the history struck through) or a mark; the rows it caused (a flask
// filled, a cancellation, a correction) are not results. A hit is the history event itself, so
// the screens draw it with the Timeline as it looks in the history: the flask state after it,
// the minutes, the date groups. Rows are matched first; the journal of a skill is replayed only
// when it has a hit.

import { db } from '../data/db';
import type { MarkEvent, TransactionEvent } from '../domain/events';
import { matchesTerms, searchTerms, type SearchFilter } from '../domain/search';
import type { Mark, Skill, StepCompletion } from '../domain/types';
import { historyEvents, historyTables } from './history';

/** Results shown at first and added by «Показать ещё». */
export const SEARCH_PAGE = 30;

export interface SearchOptions {
  query: string;
  filter: SearchFilter;
  /** At most this many hits (SEARCH_PAGE by default); `total` still counts them all. */
  limit?: number;
}

/** A completion's own row or a mark: what a search finds. */
export type SearchHit = TransactionEvent | MarkEvent;

/** A search that asks for nothing: no words and no filter. The screens show the plain history then. */
export function isEmptySearch(query: string, filter: SearchFilter): boolean {
  return filter === 'all' && searchTerms(query).length === 0;
}

function completionMatches(completion: StepCompletion, terms: string[], filter: SearchFilter): boolean {
  if (filter === 'marks' || (filter === 'notes' && !completion.note)) return false;
  return matchesTerms([completion.stepName, completion.note], terms);
}

function markMatches(mark: Mark, terms: string[], filter: SearchFilter): boolean {
  return filter !== 'notes' && matchesTerms([mark.title, mark.description], terms);
}

/** The ids a search finds among the rows (completions and marks share no ids). */
function matchedIds(completions: readonly StepCompletion[], marks: readonly Mark[], terms: string[], filter: SearchFilter): Set<string> {
  const ids = new Set<string>();
  for (const completion of completions) if (completionMatches(completion, terms, filter)) ids.add(completion.id);
  for (const mark of marks) if (markMatches(mark, terms, filter)) ids.add(mark.id);
  return ids;
}

/** The skill's hits, newest first, as history events; `completions` and `marks` are the skill's own, read already. */
async function skillHits(skill: Skill, ids: ReadonlySet<string>, completions: StepCompletion[], marks: Mark[]): Promise<SearchHit[]> {
  const [milestone, thresholds, transactions] = await Promise.all([
    db.milestones.where('skillId').equals(skill.id).first(),
    db.levelThresholds.where('skillId').equals(skill.id).toArray(),
    db.transactions.where('skillId').equals(skill.id).toArray(),
  ]);
  const events = historyEvents(skill, { milestone, thresholds, completions, transactions, marks });
  return events.filter(
    (event): event is SearchHit =>
      (event.type === 'MARK' && ids.has(event.mark.id)) || (event.type === 'COMPLETION' && event.completion !== undefined && ids.has(event.completion.id)),
  );
}

export interface SkillSearch {
  /** Newest first, at most `limit`. */
  events: SearchHit[];
  total: number;
  hasMore: boolean;
}

/** Searches one skill's history; null when the skill does not exist. */
export async function searchSkillHistory(skillId: string, { query, filter, limit = SEARCH_PAGE }: SearchOptions): Promise<SkillSearch | null> {
  const terms = searchTerms(query);
  return db.transaction('r', historyTables(), async () => {
    const skill = await db.skills.get(skillId);
    if (!skill) return null;
    if (isEmptySearch(query, filter)) return { events: [], total: 0, hasMore: false };
    const [completions, marks] = await Promise.all([
      db.completions.where('skillId').equals(skillId).toArray(),
      db.marks.where('skillId').equals(skillId).toArray(),
    ]);
    const ids = matchedIds(completions, marks, terms, filter);
    if (ids.size === 0) return { events: [], total: 0, hasMore: false };
    const hits = await skillHits(skill, ids, completions, marks);
    return { events: hits.slice(0, limit), total: hits.length, hasMore: hits.length > limit };
  });
}

export interface SearchGroup {
  skill: Skill;
  /** Newest first. */
  events: SearchHit[];
}

export interface GlobalSearch {
  /** Skills with hits, the one with the latest hit first; together at most `limit` hits. */
  groups: SearchGroup[];
  total: number;
  hasMore: boolean;
}

/** Searches every skill's history (active, reached and archived alike). */
export async function searchAllHistory({ query, filter, limit = SEARCH_PAGE }: SearchOptions): Promise<GlobalSearch> {
  const terms = searchTerms(query);
  if (isEmptySearch(query, filter)) return { groups: [], total: 0, hasMore: false };
  return db.transaction('r', historyTables(), async () => {
    const [skills, completions, marks] = await Promise.all([db.skills.toArray(), db.completions.toArray(), db.marks.toArray()]);
    const ids = matchedIds(completions, marks, terms, filter);
    if (ids.size === 0) return { groups: [], total: 0, hasMore: false };
    const withHits = new Set<string>();
    for (const completion of completions) if (ids.has(completion.id)) withHits.add(completion.skillId);
    for (const mark of marks) if (ids.has(mark.id)) withHits.add(mark.skillId);

    const groups: SearchGroup[] = [];
    for (const skill of skills) {
      if (!withHits.has(skill.id)) continue;
      const own = <T extends { skillId: string }>(rows: T[]) => rows.filter((row) => row.skillId === skill.id);
      const events = await skillHits(skill, ids, own(completions), own(marks));
      if (events.length > 0) groups.push({ skill, events });
    }
    // The latest hit first (its day, then when it was written); a tie keeps the names in order.
    const latest = (group: SearchGroup) => `${group.events[0]!.date}|${group.events[0]!.at}`;
    groups.sort((a, b) => (latest(a) === latest(b) ? a.skill.name.localeCompare(b.skill.name, 'ru') : latest(a) < latest(b) ? 1 : -1));

    const total = groups.reduce((sum, group) => sum + group.events.length, 0);
    const shown: SearchGroup[] = [];
    let left = limit;
    for (const group of groups) {
      if (left <= 0) break;
      shown.push({ skill: group.skill, events: group.events.slice(0, left) });
      left -= group.events.length;
    }
    return { groups: shown, total, hasMore: total > limit };
  });
}
