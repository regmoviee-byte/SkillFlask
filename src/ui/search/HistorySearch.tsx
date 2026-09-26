import { useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { searchTerms, SEARCH_FILTERS, type SearchFilter } from '../../domain/search';
import type { Skill } from '../../domain/types';
import { isEmptySearch, searchSkillHistory, SEARCH_PAGE, type SkillSearch } from '../../services/search';
import { Timeline } from '../components/Timeline';
import { copyForSkill } from '../progress/registry';
import { makeHighlight } from './highlight';
import { SearchControls, useDebounced } from './SearchControls';
import { searchCopy as t } from './strings';

// «Поиск по истории» on the skill screen (v0.5 package 17), a lazy chunk: the field and the
// chips at the top of «История». With nothing typed and «Все» the history below is the plain
// one (`children`); otherwise the results, drawn by the same Timeline — day groups, the flask
// state after each completion, a tap opens the completion or the mark — with the matched words
// marked. The search runs 150 ms after typing stops and follows the journal live.

export interface HistorySearchProps {
  skill: Skill;
  today: string;
  /** «Засечки» is offered when the skill has marks. */
  hasMarks: boolean;
  onOpen(completionId: string): void;
  onOpenMark(markId: string): void;
  /** The plain history. */
  children: ReactNode;
}

export default function HistorySearch({ skill, today, hasMarks, onOpen, onOpenMark, children }: HistorySearchProps) {
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const [limit, setLimit] = useState(SEARCH_PAGE);
  const query = useDebounced(text);
  const searching = !isEmptySearch(query, filter);
  const result = useLiveQuery(
    () => (searching ? searchSkillHistory(skill.id, { query, filter, limit }) : null),
    [skill.id, query, filter, limit, searching, today],
  );
  // The last results stay while the next ones are read, so the list does not blink on each letter.
  const [shown, setShown] = useState<SkillSearch | null>(null);
  if (result !== undefined && result !== shown) setShown(result);
  const highlight = useMemo(() => makeHighlight(searchTerms(query)), [query]);
  const filters = hasMarks ? SEARCH_FILTERS : SEARCH_FILTERS.filter((f) => f !== 'marks');

  return (
    <>
      <SearchControls
        text={text}
        onText={(next) => {
          setText(next);
          setLimit(SEARCH_PAGE);
        }}
        filter={filter}
        onFilter={(next) => {
          setFilter(next);
          setLimit(SEARCH_PAGE);
        }}
        label={t.skillField}
        placeholder={t.skillField}
        filters={filters}
      />
      {!searching ? (
        children
      ) : (
        <SearchResults found={shown} empty={shown !== null && shown.total === 0}>
          {shown && shown.total > 0 && (
            <Timeline
              events={shown.events}
              levels={copyForSkill(skill)}
              today={today}
              hasMore={shown.hasMore}
              onMore={() => setLimit((n) => n + SEARCH_PAGE)}
              onOpen={onOpen}
              onOpenMark={onOpenMark}
              highlight={highlight}
            />
          )}
        </SearchResults>
      )}
    </>
  );
}

/** The count (announced politely) or «Ничего не нашлось», then the results. */
export function SearchResults({ found, empty, children }: { found: { total: number } | null; empty: boolean; children: ReactNode }) {
  return (
    <div className="search-results">
      <p className="search-count hint small" aria-live="polite">
        {found === null ? ' ' : empty ? t.nothing : t.found(found.total)}
      </p>
      {children}
    </div>
  );
}
