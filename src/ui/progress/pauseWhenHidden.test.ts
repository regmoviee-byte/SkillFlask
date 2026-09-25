// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { installPauseWhenHidden } from './pauseWhenHidden';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('installPauseWhenHidden', () => {
  it('marks html.paused while the page is hidden, with one listener however many heroes call it', () => {
    const add = vi.spyOn(document, 'addEventListener');
    installPauseWhenHidden();
    installPauseWhenHidden();
    expect(add.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
    add.mockRestore();
    const root = document.documentElement;
    expect(root.classList.contains('paused')).toBe(false);
    setVisibility('hidden');
    expect(root.classList.contains('paused')).toBe(true);
    setVisibility('visible');
    expect(root.classList.contains('paused')).toBe(false);
  });
});
