import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { isSearchFilter, searchTerms, SEARCH_FILTERS, type SearchFilter } from '../../domain/search';
import { isEmptySearch, searchAllHistory, SEARCH_PAGE, type GlobalSearch } from '../../services/search';
import { Screen } from '../components/Screen';
import { Timeline } from '../components/Timeline';
import { copy } from '../copy';
import { useToday } from '../hooks/useToday';
import { colorScope, copyForSkill } from '../progress/registry';
import type { SkillOpenRequest } from '../screens/SkillScreen';
import { makeHighlight } from './highlight';
import { SearchResults } from './HistorySearch';
import { SearchControls, useDebounced } from './SearchControls';
import { searchCopy as t } from './strings';

// «Поиск» over every skill's history (v0.5 package 17), `#/search?q=…&f=notes`, a lazy route
// opened by the search icon on the home screen. Same matching as the skill screen's search; the
// results are grouped by skill (the latest hit first), then by day, each skill's in its colour
// and level words. A result opens its skill with that completion's sheet (or the mark's) on
// top. The query lives in the address (replaced, not pushed, while typing), so «Назад» from the
// skill comes back to the same results.

const noop = () => {};

export default function SearchScreen() {
  const [params, setParams] = useSearchParams();
  const today = useToday();
  const navigate = useNavigate();
  const [text, setText] = useState(() => params.get('q') ?? '');
  const filterParam = params.get('f');
  const filter: SearchFilter = isSearchFilter(filterParam) ? filterParam : 'all';
  const [limit, setLimit] = useState(SEARCH_PAGE);
  const query = useDebounced(text);
  const input = useRef<HTMLInputElement>(null);

  // The address follows what is searched, replacing its own entry (the filter writes its own).
  const queryParam = params.get('q') ?? '';
  useEffect(() => {
    const q = query.trim() ? query : '';
    if (q === queryParam) return;
    setParams(
      (current) => {
        const out = new URLSearchParams(current);
        if (q) out.set('q', q);
        else out.delete('q');
        return out;
      },
      { replace: true },
    );
  }, [query, queryParam, setParams]);

  // A fresh search starts in the field (the home icon primes the keyboard for it on iOS).
  useEffect(() => {
    if (!params.get('q')) input.current?.focus({ preventScroll: true });
    // Once, as the screen opens.
  }, []);

  const searching = !isEmptySearch(query, filter);
  const result = useLiveQuery(() => (searching ? searchAllHistory({ query, filter, limit }) : null), [query, filter, limit, searching]);
  const [shown, setShown] = useState<GlobalSearch | null>(null);
  if (result !== undefined && result !== shown) setShown(result);
  const highlight = useMemo(() => makeHighlight(searchTerms(query)), [query]);

  const open = (skillId: string, request: SkillOpenRequest) => {
    input.current?.blur();
    navigate(`/skills/${skillId}`, { state: { open: request } });
  };

  return (
    <Screen title={copy.home.searchTitle} back="/skills">
      <SearchControls
        text={text}
        onText={(next) => {
          setText(next);
          setLimit(SEARCH_PAGE);
        }}
        filter={filter}
        onFilter={(next) => {
          setLimit(SEARCH_PAGE);
          setParams(
            (current) => {
              const out = new URLSearchParams(current);
              if (next === 'all') out.delete('f');
              else out.set('f', next);
              return out;
            },
            { replace: true },
          );
        }}
        label={t.globalField}
        placeholder={t.globalPlaceholder}
        filters={SEARCH_FILTERS}
        inputRef={input}
      />
      {!searching ? (
        <p className="search-hint hint">{t.globalHint}</p>
      ) : (
        <SearchResults found={shown} empty={shown !== null && shown.total === 0}>
          {shown?.groups.map(({ skill, events }) => (
            <section key={skill.id} className="search-group liquid-scope" {...colorScope(skill.color)}>
              <h2 className="section-title search-group-title">{skill.name}</h2>
              <Timeline
                events={events}
                levels={copyForSkill(skill)}
                today={today}
                hasMore={false}
                onMore={noop}
                onOpen={(id) => open(skill.id, { completion: id })}
                onOpenMark={(id) => open(skill.id, { mark: id })}
                highlight={highlight}
              />
            </section>
          ))}
          {shown?.hasMore && (
            <button type="button" className="text-button timeline-more" onClick={() => setLimit((n) => n + SEARCH_PAGE)}>
              {t.more}
            </button>
          )}
        </SearchResults>
      )}
    </Screen>
  );
}
