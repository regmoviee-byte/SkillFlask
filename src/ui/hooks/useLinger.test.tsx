// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLinger } from './useLinger';

function List({ items }: { items: string[] }) {
  const rows = useLinger(items, (item) => item, 600);
  return <ul>{rows.map(({ item, leaving }) => <li key={item} data-leaving={leaving || undefined}>{item}</li>)}</ul>;
}

const shown = (container: HTMLElement) => [...container.querySelectorAll('li')].map((li) => li.textContent);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useLinger', () => {
  it('keeps a row that left for its time, then drops it', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<List items={['a', 'b']} />);
    rerender(<List items={['b']} />);
    expect(shown(container)).toEqual(['a', 'b']);
    act(() => vi.advanceTimersByTime(600));
    expect(shown(container)).toEqual(['b']);
  });

  it('still drops the row when its timer fires a millisecond before the wall clock gets there', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<List items={['a', 'b']} />);
    rerender(<List items={['b']} />);
    // The first check after the timer reads a clock 1 ms behind it: the row is not due yet.
    const now = Date.now.bind(Date);
    const lagging = vi.spyOn(Date, 'now').mockImplementation(() => now() - 1);
    act(() => vi.advanceTimersByTime(600));
    expect(shown(container)).toEqual(['a', 'b']);
    lagging.mockRestore();
    act(() => vi.advanceTimersByTime(5));
    expect(shown(container)).toEqual(['b']);
  });
});
