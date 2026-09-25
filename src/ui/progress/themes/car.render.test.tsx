// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { carTheme, HOLD_MS } from './car';

const { Hero, Mini } = carTheme;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (Element.prototype as { animate?: unknown }).animate;
});

/** The markup without the per-instance clip id. */
const markup = (el: Element) => el.innerHTML.replace(/car[\w-]*-clip/g, 'clip');

/** The road class of the world on screen (the first; the next one sits above it while scrolling). */
const worldOn = (el: Element) => el.querySelector('svg g[class^="car-w"]')?.getAttribute('class');

/** WAAPI that finishes at once, recording the road on screen at every animation. */
function stubAnimate(container: Element, seen: string[]) {
  (Element.prototype as { animate?: unknown }).animate = function animate() {
    const on = worldOn(container);
    if (on && seen[seen.length - 1] !== on) seen.push(on);
    return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
  };
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe('car hero', () => {
  it('renders as an image with the Russian label', () => {
    render(<Hero fill={0.45} capacity={100} />);
    expect(screen.getByRole('img', { name: 'Машинка проехала 45% пути' })).toBeTruthy();
  });

  it('renders the empty and complete states', () => {
    render(<Hero fill={0.3} state="empty" />);
    expect(screen.getByRole('img', { name: 'Машинка проехала 0% пути' })).toBeTruthy();
    cleanup();
    render(<Hero fill={0.3} state="complete" />);
    expect(screen.getByRole('img', { name: 'Машинка проехала 100% пути' })).toBeTruthy();
  });

  it('shows captions for the newest four marks and reports taps', () => {
    const onMarkTap = vi.fn();
    const marks = ['Первая', 'Вторая', 'Третья', 'Четвёртая', 'Длинное название засечки'].map((label, i) => ({ id: `m${i}`, label, height: i / 5 }));
    render(<Hero fill={0.6} marks={marks} onMarkTap={onMarkTap} />);
    const captions = screen.getAllByRole('button');
    expect(captions).toHaveLength(4);
    expect(captions.map((b) => b.textContent)).toContain('Длинное наз…');
    fireEvent.click(screen.getByRole('button', { name: 'Засечка: Вторая' }));
    expect(onMarkTap).toHaveBeenCalledWith('m1');
  });

  it('draws the road of its level, six in turn', () => {
    expect(worldOn(render(<Hero fill={0.5} level={4} />).container)).toBe('car-w4');
    expect(worldOn(render(<Hero fill={0.5} level={7} />).container)).toBe('car-w1');
    expect(worldOn(render(<Hero fill={0.5} />).container)).toBe('car-w1');
  });

  // The app renders the new level together with the new fill, then plays the level-up.
  for (const [from, to, levels, roads] of [
    [4, 5, 1, ['car-w4', 'car-w5']],
    [4, 7, 3, ['car-w4', 'car-w5', 'car-w6', 'car-w1']],
  ] as const) {
    it(`plays level ${from} → ${to}: the completed road, the next ones, then exactly the new level`, async () => {
      const ref = createRef<ProgressHeroHandle>();
      const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={from} capacity={100} />);
      const seen: string[] = [];
      stubAnimate(container, seen);
      rerender(<Hero ref={ref} fill={0.1} level={to} capacity={100} />);
      // Until the play starts, the road and the car it had on screen stay.
      expect(worldOn(container)).toBe(`car-w${from}`);
      expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Машинка проехала 90% пути');
      const onOverflow = vi.fn();
      await act(async () => {
        await ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.1, levels, onOverflow });
        await frame();
      });
      expect(onOverflow).toHaveBeenCalledTimes(1);
      expect(seen).toEqual(roads);
      const fresh = render(<Hero fill={0.1} level={to} capacity={100} />);
      expect(markup(container)).toBe(markup(fresh.container));
    });
  }

  it('fades to the new road when no level-up follows the new level', async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<Hero fill={0.9} level={2} />);
      rerender(<Hero fill={0.1} level={3} />);
      expect(worldOn(container)).toBe('car-w2');
      act(() => vi.advanceTimersByTime(HOLD_MS));
      expect(markup(container)).toBe(markup(render(<Hero fill={0.1} level={3} />).container));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a lower level at once', () => {
    const { container, rerender } = render(<Hero fill={0.4} level={5} />);
    rerender(<Hero fill={0.4} level={4} />);
    expect(worldOn(container)).toBe('car-w4');
  });

  it('still reports the beat when WAAPI is missing', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={1} />);
    rerender(<Hero ref={ref} fill={0.2} level={2} />);
    const onOverflow = vi.fn();
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 1, onOverflow }));
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(ref.current!.element()).toBeTruthy();
    // Nothing to animate: the new level's road at once.
    expect(worldOn(container)).toBe('car-w2');
  });
});

describe('car mini', () => {
  it('renders at its size with the label', () => {
    render(<Mini fill={0.5} size={28} />);
    const img = screen.getByRole('img', { name: 'Машинка проехала 50% пути' });
    expect(img.getAttribute('width')).toBe('28');
  });

  it('shows the road of its level', () => {
    render(<Mini fill={0.5} level={5} />);
    expect(screen.getByRole('img').classList.contains('car-w5')).toBe(true);
  });
});
