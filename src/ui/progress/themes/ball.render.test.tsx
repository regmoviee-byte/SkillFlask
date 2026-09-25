// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { BEAT_RIM, HOLD_MS, PILE_SLOTS, ballTheme } from './ball';

const { Hero, Mini } = ballTheme;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

afterEach(() => {
  cleanup();
  delete (Element.prototype as { animate?: unknown }).animate;
});

/** The markup without the per-instance gradient id. */
const markup = (el: Element) => el.innerHTML.replace(/ball[\w-]*-skin/g, 'skin');
const pileOf = (el: Element) => el.querySelectorAll('[data-i]').length;
const jersey = (el: Element) => el.querySelector('.ball-jersey-no')?.textContent;

/** WAAPI that finishes at once, recording the balls on the floor at every animation. */
function stubAnimate(container: Element, seen: number[]) {
  (Element.prototype as { animate?: unknown }).animate = function animate() {
    const n = pileOf(container);
    if (seen[seen.length - 1] !== n) seen.push(n);
    return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
  };
}

describe('ball hero and mini', () => {
  it('renders the hero as an image with the Russian label', () => {
    render(<Hero fill={0.45} capacity={100} />);
    const hero = screen.getByRole('img');
    expect(hero.getAttribute('aria-label')).toBe('Мяч пролетел 45% пути к кольцу');
    // The capacity scale: round values along the arc.
    expect(hero.textContent).toContain('25');
  });

  it('renders every state and the caller’s label', () => {
    for (const state of ['empty', 'active', 'complete'] as const) {
      render(<Hero fill={0.5} state={state} motion="reduced" label={`hero ${state}`} />);
      expect(screen.getByRole('img', { name: `hero ${state}` })).toBeTruthy();
    }
    expect(screen.getByRole('img', { name: 'hero complete' }).closest('.ball-theme--complete')).toBeTruthy();
  });

  it('renders the mini at its size', () => {
    render(<Mini fill={0.3} size={28} />);
    const mini = screen.getByRole('img');
    expect(mini.getAttribute('aria-label')).toBe('Мяч пролетел 30% пути к кольцу');
    expect(mini.getAttribute('width')).toBe('28');
    render(<Mini fill={1} state="complete" label="готово" />);
    expect(screen.getByRole('img', { name: 'готово' })).toBeTruthy();
  });

  it('shows the newest four marks as buttons and reports taps', () => {
    const onMarkTap = vi.fn();
    const marks = ['Первая', 'Пробный тест', 'Длинное название засечки', 'Четвёртая', 'Экзамен'].map((label, i) => ({ id: `m${i}`, label, height: i / 5 }));
    render(<Hero fill={0.6} marks={marks} onMarkTap={onMarkTap} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Пробный тест', 'Длинное наз…', 'Четвёртая', 'Экзамен']);
    expect(buttons[1]!.getAttribute('aria-label')).toBe('Засечка: Длинное название засечки');
    fireEvent.click(buttons[3]!);
    expect(onMarkTap).toHaveBeenCalledWith('m4');
  });

  it('plays a level-up without WAAPI: the beat still fires once and the new fill shows', async () => {
    const ref = createRef<ProgressHeroHandle>();
    render(<Hero ref={ref} fill={0.9} />);
    expect(ref.current?.element()).toBeTruthy();
    const onOverflow = vi.fn();
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2, onOverflow }));
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });

  it('crossfades under reduced motion and lands on toFill', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }) as unknown as Animation);
    Element.prototype.animate = animate;
    try {
      // As on the skill screen: the write moves the prop to the new fill while the beat plays.
      const { rerender } = render(<Hero ref={ref} fill={0.9} motion="reduced" />);
      const onOverflow = vi.fn();
      await act(async () => {
        const played = ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 3, onOverflow });
        rerender(<Hero ref={ref} fill={0.2} motion="reduced" />);
        await played;
        await nextFrame();
      });
      expect(onOverflow).toHaveBeenCalledTimes(1);
      // One crossfade, and none after it: the prop already equals toFill.
      expect(animate).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Мяч пролетел 20% пути к кольцу');
    } finally {
      delete (Element.prototype as { animate?: unknown }).animate;
    }
  });

  it('follows the fill prop after a level-up when it differs from toFill', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }) as unknown as Animation);
    Element.prototype.animate = animate;
    try {
      const { rerender } = render(<Hero ref={ref} fill={0.9} />);
      await act(async () => {
        const played = ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 1 });
        // A second write lands during the beat.
        rerender(<Hero ref={ref} fill={0.35} />);
        await played;
      });
      // The level-up ends on toFill, then the ball glides on to the prop.
      expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Мяч пролетел 20% пути к кольцу');
      const before = animate.mock.calls.length;
      await act(nextFrame);
      expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Мяч пролетел 35% пути к кольцу');
      expect(animate.mock.calls.length).toBeGreaterThan(before);
      // A completed skill: the golden ball leaves the flight for the net.
      rerender(<Hero ref={ref} fill={1} state="complete" />);
      await act(async () => {
        await ref.current!.playLevelUp({ fromFill: 0.35, toFill: 0, levels: 1 });
        await nextFrame();
      });
      expect(document.querySelector<SVGGElement>('.ball-pos')!.style.transform).toBe('translate(124px, 67px) rotate(18deg)');
    } finally {
      delete (Element.prototype as { animate?: unknown }).animate;
    }
  });

  it('draws a ball on the floor for every past level, the cart counting past its slots', () => {
    const one = render(<Hero fill={0.5} />).container;
    expect(pileOf(one)).toBe(0);
    expect(jersey(one)).toBe('1');
    const five = render(<Hero fill={0.5} level={5} />).container;
    expect(pileOf(five)).toBe(4);
    expect(jersey(five)).toBe('5');
    expect(five.querySelector('.ball-cart-tag')).toBeNull();
    const many = render(<Hero fill={0.5} level={160} />).container;
    expect(pileOf(many)).toBe(PILE_SLOTS);
    expect(many.querySelector('.ball-cart-tag')?.textContent).toBe('×159');
    // The jersey carries the level's last two digits.
    expect(jersey(many)).toBe('60');
  });

  it('animates the idle player only with full motion', () => {
    const full = render(<Hero fill={0.4} motion="full" />).container;
    expect(full.querySelectorAll('.ball-player .anim-decor')).toHaveLength(4);
    const reduced = render(<Hero fill={0.4} motion="reduced" />).container;
    expect(reduced.querySelectorAll('.anim-decor')).toHaveLength(0);
    // The pose still follows the fill.
    const pose = (el: Element) => (el.querySelector('.ball-player') as SVGGElement).style.transform;
    expect(pose(reduced)).toBe(pose(full));
  });

  it('draws up to three past balls under the mini hoop', () => {
    const count = (level?: number) => render(<Mini fill={0.4} level={level} size={28} />).container.querySelectorAll('.ball-heap').length;
    expect([undefined, 1, 2, 3, 9].map(count)).toEqual([0, 0, 1, 2, 3]);
  });

  // The app renders the new level together with the new fill, then plays the level-up.
  for (const [from, to, levels, piles] of [
    [4, 5, 1, [3, 4]],
    [4, 7, 3, [3, 4, 5, 6]],
    [4, 9, 5, [3, 4, 5, 6]],
  ] as const) {
    it(`plays level ${from} → ${to}: the pile on screen, one ball per basket, then exactly the new level`, async () => {
      const ref = createRef<ProgressHeroHandle>();
      const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={from} capacity={100} />);
      const seen: number[] = [];
      stubAnimate(container, seen);
      rerender(<Hero ref={ref} fill={0.1} level={to} capacity={100} />);
      // Until the play starts, the pile and the ball on screen stay.
      expect(pileOf(container)).toBe(from - 1);
      expect(jersey(container)).toBe(String(from));
      expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Мяч пролетел 90% пути к кольцу');
      const onOverflow = vi.fn();
      await act(async () => {
        await ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.1, levels, onOverflow });
        await nextFrame();
      });
      expect(onOverflow).toHaveBeenCalledTimes(1);
      // Past three baskets the rest of the balls join at the end.
      expect(seen).toEqual([...piles, ...(to - 1 > piles.at(-1)! ? [to - 1] : [])]);
      const fresh = render(<Hero fill={0.1} level={to} capacity={100} />);
      expect(markup(container)).toBe(markup(fresh.container));
    });
  }

  it('counts on the cart once its slots are full', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={PILE_SLOTS + 1} />);
    expect(container.querySelector('.ball-cart-tag')).toBeNull();
    const seen: number[] = [];
    stubAnimate(container, seen);
    rerender(<Hero ref={ref} fill={0.3} level={PILE_SLOTS + 2} />);
    await act(async () => {
      await ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.3, levels: 1 });
      await nextFrame();
    });
    expect(pileOf(container)).toBe(PILE_SLOTS);
    expect(container.querySelector('.ball-cart-tag')?.textContent).toBe(`×${PILE_SLOTS + 1}`);
    expect(markup(container)).toBe(markup(render(<Hero fill={0.3} level={PILE_SLOTS + 2} />).container));
  });

  it('crossfades once to the new level under reduced motion', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={4} motion="reduced" />);
    const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }) as unknown as Animation);
    Element.prototype.animate = animate;
    rerender(<Hero ref={ref} fill={0.1} level={5} motion="reduced" />);
    await act(async () => {
      await ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.1, levels: 1 });
      await nextFrame();
    });
    expect(animate).toHaveBeenCalledTimes(1);
    expect(markup(container)).toBe(markup(render(<Hero fill={0.1} level={5} motion="reduced" />).container));
  });

  it('fades to the new level when no level-up follows it', async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<Hero fill={0.9} level={2} />);
      rerender(<Hero fill={0.1} level={3} />);
      expect(pileOf(container)).toBe(1);
      act(() => vi.advanceTimersByTime(HOLD_MS));
      expect(markup(container)).toBe(markup(render(<Hero fill={0.1} level={3} />).container));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a lower level at once', () => {
    const { container, rerender } = render(<Hero fill={0.4} level={5} />);
    rerender(<Hero fill={0.4} level={4} />);
    expect(pileOf(container)).toBe(3);
  });

  it('shows the new level at once when WAAPI is missing', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={1} />);
    rerender(<Hero ref={ref} fill={0.2} level={2} />);
    const onOverflow = vi.fn();
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 1, onOverflow }));
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(pileOf(container)).toBe(1);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Мяч пролетел 20% пути к кольцу');
  });

  it('fires the beat when the drop keyframes put the ball on the rim', async () => {
    vi.useFakeTimers();
    const calls: { at: number; frames: Keyframe[]; duration: number }[] = [];
    Element.prototype.animate = vi.fn((frames: Keyframe[], options?: KeyframeAnimationOptions) => {
      calls.push({ at: Date.now(), frames, duration: Number(options?.duration ?? 0) });
      return { finished: Promise.resolve(), cancel: vi.fn() } as unknown as Animation;
    }) as unknown as Element['animate'];
    try {
      const ref = createRef<ProgressHeroHandle>();
      render(<Hero ref={ref} fill={0.9} />);
      let beatAt = -1;
      const onOverflow = vi.fn(() => (beatAt = Date.now()));
      await act(async () => {
        void ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 1, onOverflow });
        await vi.advanceTimersByTimeAsync(2000);
      });
      const drop = calls.find((c) => c.frames.some((k) => k.offset === BEAT_RIM && String(k.transform).startsWith('translate')))!;
      expect(onOverflow).toHaveBeenCalledTimes(1);
      expect(beatAt - drop.at).toBe(drop.duration * BEAT_RIM);
    } finally {
      vi.useRealTimers();
      delete (Element.prototype as { animate?: unknown }).animate;
    }
  });
});
