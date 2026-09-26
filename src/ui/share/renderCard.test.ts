import { afterEach, describe, expect, it, vi } from 'vitest';
import { ART_TIMEOUT_MS, artOrFlask, CARD_SURFACES, stageTokens, withTimeout } from './renderCard';

// The card's picture is the theme's own drawing, or the flask when that cannot be had: the
// card is always produced. The canvas itself is checked by the walkthrough's PNG files
// (scripts/screenshots.mjs); here, the rule that picks the picture.

afterEach(() => {
  vi.useRealTimers();
});

describe('artOrFlask', () => {
  it('takes the theme’s picture when it rasterizes in time', async () => {
    const flask = vi.fn(() => 'flask');
    await expect(artOrFlask(async () => 'pizza', flask)).resolves.toEqual({ art: 'pizza', fallback: false });
    expect(flask).not.toHaveBeenCalled();
  });

  it('falls back to the flask when rasterizing throws', async () => {
    const result = await artOrFlask(() => {
      throw new Error('The picture did not load as an image');
    }, () => 'flask');
    expect(result).toEqual({ art: 'flask', fallback: true });
  });

  it('falls back to the flask on a tainted canvas (SecurityError)', async () => {
    const tainted = async () => {
      throw new DOMException('The canvas has been tainted by cross-origin data.', 'SecurityError');
    };
    await expect(artOrFlask(tainted, () => 'flask')).resolves.toEqual({ art: 'flask', fallback: true });
  });

  it('falls back to the flask when the picture takes longer than two seconds', async () => {
    vi.useFakeTimers();
    let settled = false;
    const result = artOrFlask(() => new Promise<string>(() => {}), () => 'flask').then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(ART_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ art: 'flask', fallback: true });
  });
});

describe('withTimeout', () => {
  it('passes the value or the error through and clears its timer', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve(3), 100)).resolves.toBe(3);
    await expect(withTimeout(Promise.reject(new Error('no')), 100)).rejects.toThrow('no');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the card styles', () => {
  it('paint the stage with the card’s own surfaces, not the Telegram theme’s', () => {
    expect(stageTokens('dark')['--color-bg-elevated']).toBe(CARD_SURFACES.dark.surface);
    expect(stageTokens('light')['--color-fg']).toBe(CARD_SURFACES.light.fg);
    expect(Object.keys(stageTokens('light')).every((key) => key.startsWith('--color-'))).toBe(true);
  });
});
