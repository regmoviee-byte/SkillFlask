import { useEffect, useRef, useState, type RefObject } from 'react';
import type { SearchFilter } from '../../domain/search';
import { haptics } from '../../platform/haptics';
import { Icon } from '../components/Icon';
import { searchCopy as t } from './strings';

// The search field and the filter chips «Все · С заметками · Засечки», shared by the skill's
// history and the global search. The field is plain text (enterkeyhint «search» hides the
// keyboard); × clears it and keeps the focus in it.

/** Typing settles for this long before a search runs. */
export const SEARCH_DEBOUNCE_MS = 150;

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

interface SearchControlsProps {
  text: string;
  onText(text: string): void;
  filter: SearchFilter;
  onFilter(filter: SearchFilter): void;
  label: string;
  placeholder: string;
  /** «Засечки» only where there are marks to find. */
  filters: readonly SearchFilter[];
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function SearchControls({ text, onText, filter, onFilter, label, placeholder, filters, inputRef }: SearchControlsProps) {
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  return (
    <div className="search-controls">
      <div className="search-field">
        <Icon name="search" size={20} className="search-field-icon" />
        <input
          ref={input}
          className="input search-input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          aria-label={label}
          placeholder={placeholder}
          value={text}
          maxLength={100}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        {text && (
          <button
            type="button"
            className="icon-button search-clear"
            aria-label={t.clear}
            onClick={() => {
              onText('');
              input.current?.focus();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </div>
      {filters.length > 1 && (
        <div className="filter-chips search-chips" role="group" aria-label={t.filterLabel}>
          {filters.map((key) => (
            <button
              key={key}
              type="button"
              className="chip"
              aria-pressed={filter === key}
              onClick={() => {
                if (filter === key) return;
                haptics.select();
                onFilter(key);
              }}
            >
              {t.filters[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
