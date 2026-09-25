// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { FAR_HENS, NEAR_HENS, chickTheme } from './chick';

const { Hero, Mini } = chickTheme;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('chick hero', () => {
  it('renders as an image with the Russian label', () => {
    render(<Hero fill={0.45} capacity={100} />);
    const img = screen.getByRole('img', { name: 'Цыплёнок вырос на 45%' });
    expect(img.tagName).toBe('svg');
    expect(img.getAttribute('viewBox')).toBe('0 0 160 260');
    // The growth stake: quarter ticks and a straw band scaled to the fill.
    expect(img.querySelectorAll('.chick-tick')).toHaveLength(3);
    expect((img.querySelector('.chick-band') as SVGElement).style.transform).toBe('scale(1, 0.45)');
    // Cracks are growing: the egg wobbles as the one idle loop.
    expect(img.querySelectorAll('.anim-decor')).toHaveLength(1);
    expect(img.querySelector('.chick-wobble.anim-decor')).not.toBeNull();
  });

  it('blinks instead of wobbling once the chick stands', () => {
    const { container } = render(<Hero fill={0.8} />);
    expect(container.querySelectorAll('.anim-decor')).toHaveLength(1);
    expect(container.querySelector('.chick-blink.anim-decor')).not.toBeNull();
  });

  it('takes a custom label and the complete state', () => {
    render(<Hero fill={1} state="complete" label="Все цыплята выросли" />);
    const img = screen.getByRole('img', { name: 'Все цыплята выросли' });
    expect(img.closest('.chick--complete')).not.toBeNull();
    expect(img.querySelectorAll('.anim-decor')).toHaveLength(0);
  });

  it('draws marks as captions with a tap handler', () => {
    const onMarkTap = vi.fn();
    const marks = [
      { id: 'a', label: 'Пробный тест', height: 0.2 },
      { id: 'b', label: 'Длинное название засечки', height: 0.45 },
      { id: 'c', label: 'Экзамен', height: 0.58 },
    ];
    const { container } = render(<Hero fill={0.6} capacity={100} marks={marks} onMarkTap={onMarkTap} />);
    const long = screen.getByRole('button', { name: 'Засечка: Длинное название засечки' });
    expect(long.textContent).toBe('Длинное наз…');
    fireEvent.click(long);
    expect(onMarkTap).toHaveBeenCalledWith('b');
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(container.querySelectorAll('.chick-mark-flag')).toHaveLength(3);
    expect(container.querySelector('.chick--marked')).not.toBeNull();
  });

  it('captions only the newest four marks', () => {
    const marks = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, label: `Засечка ${i}`, height: i / 6 }));
    const { container } = render(<Hero fill={0.9} marks={marks} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Засечка 2', 'Засечка 3', 'Засечка 4', 'Засечка 5']);
    expect(container.querySelectorAll('.chick-mark-flag')).toHaveLength(6);
  });

  it('plays a level-up without WAAPI by calling onOverflow once', async () => {
    const ref = createRef<ProgressHeroHandle>();
    render(<Hero ref={ref} fill={0.9} />);
    const onOverflow = vi.fn();
    expect(ref.current?.element()?.tagName).toBe('svg');
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2, onOverflow }));
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });
});

describe('chick mini', () => {
  it('renders a square image with the label', () => {
    render(<Mini fill={0.5} size={28} />);
    const img = screen.getByRole('img', { name: 'Цыплёнок вырос на 50%' });
    expect(img.getAttribute('width')).toBe('28');
    expect(img.getAttribute('height')).toBe('28');
    const [, , w, h] = img.getAttribute('viewBox')!.split(' ').map(Number);
    expect(w).toBe(h);
    expect(img.querySelectorAll('.anim-decor')).toHaveLength(0);
  });

  it('shows a golden hen when complete', () => {
    const { container } = render(<Mini fill={1} state="complete" />);
    expect(container.querySelector('.chick--complete .chick-hen')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Цыплёнок вырос на 100%' })).toBeTruthy();
  });

  it('keeps clip ids unique per instance', () => {
    const { container } = render(
      <>
        <Mini fill={0.6} />
        <Mini fill={0.6} />
      </>,
    );
    const ids = [...container.querySelectorAll('clipPath')].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('chick yard', () => {
  const hens = (root: ParentNode) => root.querySelectorAll('[data-hen]').length;

  it('grows with the level: strolling hens up front, a still flock behind', () => {
    const { container, rerender } = render(<Hero fill={0.5} level={1} />);
    expect(container.querySelector('.chick-yard')).not.toBeNull();
    expect(hens(container)).toBe(0);
    expect(container.querySelector('.chick-flock')).toBeNull();
    rerender(<Hero fill={0.5} level={5} />);
    expect(hens(container)).toBe(4);
    expect(container.querySelectorAll('.chick-yh--near')).toHaveLength(4);
    rerender(<Hero fill={0.5} level={13} />);
    expect(container.querySelectorAll('.chick-yh--near')).toHaveLength(NEAR_HENS);
    expect(container.querySelectorAll('.chick-yh--far')).toHaveLength(2);
    rerender(<Hero fill={0.5} level={60} />);
    expect(hens(container)).toBe(NEAR_HENS + FAR_HENS);
    const flock = container.querySelector('.chick-flock-light')!.getAttribute('d')! + container.querySelector('.chick-flock-dark')!.getAttribute('d')!;
    // Four shapes (body, neck, head, tail) per hen of the flock.
    expect(flock.match(/M/g)!.length / 4).toBe(59 - NEAR_HENS - FAR_HENS);
    // At most three animated groups per strolling hen, plus the egg's wobble.
    expect(container.querySelectorAll('.anim-decor').length).toBeLessThanOrEqual((NEAR_HENS + FAR_HENS) * 3 + 1);
  });

  it('seeds each hen a stroll of her own', () => {
    const { container } = render(<Hero fill={0.5} level={12} />);
    const walks = [...container.querySelectorAll<SVGGElement>('.chick-walk.anim-decor')];
    expect(walks).toHaveLength(11);
    expect(new Set(walks.map((w) => w.style.animationDuration)).size).toBe(walks.length);
    expect(new Set(walks.map((w) => w.style.animationDelay)).size).toBe(walks.length);
    for (const w of walks) expect(w.style.animationName).toMatch(/^chick-walk-\d$/);
  });

  it('stands the hens still, in varied poses, under reduced motion', () => {
    const { container } = render(<Hero fill={0.5} level={12} motion="reduced" />);
    expect(container.querySelectorAll('.chick-yard .anim-decor')).toHaveLength(0);
    const walks = [...container.querySelectorAll<SVGGElement>('.chick-walk')];
    expect(walks).toHaveLength(11);
    expect(walks.every((w) => !w.style.animationName)).toBe(true);
    expect(new Set(walks.map((w) => w.style.transform)).size).toBeGreaterThan(5);
  });

  it('keeps the hens raised on screen when no level is given', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const { container } = render(<Hero ref={ref} fill={0.9} />);
    expect(hens(container)).toBe(0);
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2 }));
    expect(hens(container)).toBe(2);
  });

  describe('level-up with the level already moved on (the app renders it first)', () => {
    /** Markup without the ids useId() makes per render and without the running CSS animations. */
    const normalized = (root: Element) => {
      const html = root.innerHTML.replace(/\s*animation-(name|duration|delay): [^;]+;/g, '');
      const ids = [...new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!))];
      return ids.reduce((out, id, k) => out.split(id).join(`id${k}`), html);
    };
    const frame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    // jsdom has no WAAPI: an animate() that finishes at once runs the choreography through every phase.
    let animations = 0;
    beforeEach(() => {
      animations = 0;
      const animate = () => {
        animations += 1;
        return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
      };
      Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate });
    });
    afterEach(() => {
      delete (Element.prototype as { animate?: unknown }).animate;
    });

    it.each([
      [1, 4, 5],
      [3, 4, 7],
    ])('plays %i level(s) from level %i to %i and ends as a fresh render', async (levels, from, to) => {
      const ref = createRef<ProgressHeroHandle>();
      const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={from} />);
      expect(hens(container)).toBe(from - 1);
      rerender(<Hero ref={ref} fill={0.1} level={to} />);
      const seen: number[] = [];
      await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.1, levels, onOverflow: () => seen.push(hens(container)) }));
      await frame();
      // The choreography ran (every phase animates), and at the beat the yard still showed the
      // flock from before the write.
      expect(animations).toBeGreaterThan(30 * levels);
      expect(seen).toEqual([from - 1]);
      expect(hens(container)).toBe(to - 1);
      expect(container.querySelector('.chick--scripted')).toBeNull();
      const fresh = render(<Hero fill={0.1} level={to} />);
      expect(normalized(container)).toBe(normalized(fresh.container));
    });
  });
});
