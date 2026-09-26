import { Suspense, type ReactNode } from 'react';
import { Screen } from '../components/Screen';
import { copy } from '../copy';
import { lazySafe } from '../lazySafe';
import type { HistorySearchProps } from './HistorySearch';

// The entry points of «Поиск по истории» (v0.5 package 17) in the first paint: the skill screen's
// search and the `/search` route come from lazy chunks (the search service, the matching and
// highlighting, the field and chips, the strings), loaded with the first skill screen that has a
// history or the first search. Meanwhile the history shows as it always did, under an empty box
// of the controls' height, so nothing moves when they arrive. A chunk that fails to load leaves
// the plain history (and, for the route, the skills), never a broken screen.

/** Without the chunk: the plain history, as before the search existed. */
function PlainHistory({ children }: HistorySearchProps) {
  return <>{children}</>;
}

const HistorySearch = lazySafe(() => import('./HistorySearch'), 'HistorySearch', PlainHistory);

/** The skill's «История»: the search field and chips above the plain history, or the results. */
export function SkillHistorySearch(props: Omit<HistorySearchProps, 'children'> & { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <>
          <div className="search-controls search-controls--placeholder" aria-hidden="true" />
          {props.children}
        </>
      }
    >
      <HistorySearch {...props} />
    </Suspense>
  );
}

/** A search chunk that did not load: back to the skills, where it was opened from. */
function SearchUnavailable() {
  return (
    <Screen title={copy.home.searchTitle} back="/skills">
      <p className="hint center">{copy.errors.searchChunk}</p>
    </Screen>
  );
}

const SearchScreen = lazySafe(() => import('./SearchScreen'), 'SearchScreen', SearchUnavailable);

/** `/search`: the header (title, «Назад») stands while the chunk loads. */
export function SearchRoute() {
  return (
    <Suspense fallback={<Screen title={copy.home.searchTitle} back="/skills">{null}</Screen>}>
      <SearchScreen />
    </Suspense>
  );
}
