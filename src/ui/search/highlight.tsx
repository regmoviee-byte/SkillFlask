import { highlightFragments, snippetStart } from '../../domain/search';
import type { Highlight } from '../components/Timeline';

// The matched words as <mark> (announced as highlighted text by screen readers that support it;
// the words read on as one text either way). A long text whose first match sits deep inside
// starts shortly before it, after «…», so the match is on the lines the result shows.

export function makeHighlight(terms: readonly string[]): Highlight {
  return (text) => {
    if (terms.length === 0) return text;
    const start = snippetStart(text, terms);
    const fragments = highlightFragments(start > 0 ? text.slice(start) : text, terms);
    return (
      <>
        {start > 0 && '…'}
        {fragments.map((f, i) =>
          f.hit ? (
            <mark key={i} className="search-hit">
              {f.text}
            </mark>
          ) : (
            f.text
          ),
        )}
      </>
    );
  };
}
