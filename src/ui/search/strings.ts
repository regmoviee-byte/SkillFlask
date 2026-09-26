// Texts of «Поиск по истории» (v0.5 package 17), in the lazy search chunks; copy.test.ts walks
// them with the rest. The search icon's name on the home screen is copy.home.search (first paint).

import { formatNumber } from '../../lib/format';
import type { SearchFilter } from '../../domain/search';

export const searchCopy = Object.freeze({
  /** The skill screen's field: its label and placeholder. */
  skillField: 'Поиск по истории',
  /** The global field: its label, and the placeholder that says what it looks through. */
  globalField: 'Поиск по всем навыкам',
  globalPlaceholder: 'Действие, заметка, засечка',
  clear: 'Очистить поиск',
  filterLabel: 'Что искать',
  filters: {
    all: 'Все',
    notes: 'С заметками',
    marks: 'Засечки',
  } satisfies Record<SearchFilter, string>,
  found: (n: number) => `Найдено: ${formatNumber(n)}`,
  /** An empty result: neutral, nothing about the user. */
  nothing: 'Ничего не нашлось',
  /** The global screen before anything is typed. */
  globalHint: 'Ищет в названиях действий, заметках и засечках всех навыков: в активных, достигнутых и в архиве.',
  more: 'Показать ещё',
});
