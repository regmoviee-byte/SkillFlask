// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { moonTheme } from './moon';

const { Hero, Mini } = moonTheme;

/** jsdom has no WAAPI: a stub whose animations finish at once (or never), recording cancels. */
function stubAnimate(finish = true) {
  const made: { cancelled: boolean }[] = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  proto.animate = function animate() {
    const animation = {
      cancelled: false,
      finished: finish ? Promise.resolve() : new Promise(() => {}),
      cancel() {
        this.cancelled = true;
      },
    };
    made.push(animation);
    return animation;
  };
  return made;
}

afterEach(() => {
  cleanup();
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
  vi.useRealTimers();
});

/** The hero's markup with its generated ids made neutral, so two renders can be compared. */
function markup(container: HTMLElement): string {
  const html = container.innerHTML;
  const id = /id="([^"]+)-sky"/.exec(html)![1]!;
  return html.split(id).join('ID');
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 60)));

describe('moon theme rendering', () => {
  it('renders the hero as an image with the Russian label', () => {
    render(<Hero fill={0.45} />);
    expect(screen.getByRole('img', { name: 'Луна заполнена на 45%' })).toBeTruthy();
  });

  it('renders every state and a custom label', () => {
    const { container } = render(
      <>
        <Hero fill={0} state="empty" />
        <Hero fill={1} state="complete" label="Полнолуние" />
        <Hero fill={0.3} motion="reduced" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Луна заполнена на 0%' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Полнолуние' })).toBeTruthy();
    expect(container.querySelector('.moon--complete')).toBeTruthy();
  });

  it('tints a special mini', () => {
    render(
      <>
        <Mini fill={1} level={13} />
        <Mini fill={1} level={2} />
      </>,
    );
    const minis = screen.getAllByRole('img');
    expect(minis[0]!.classList.contains('moon--blue')).toBe(true);
    expect(minis[1]!.classList.contains('moon--blue')).toBe(false);
  });

  it('renders minis', () => {
    render(
      <>
        <Mini fill={0.5} size={28} />
        <Mini fill={1} state="complete" />
      </>,
    );
    const minis = screen.getAllByRole('img');
    expect(minis).toHaveLength(2);
    expect(minis[0]!.getAttribute('aria-label')).toBe('Луна заполнена на 50%');
    expect(minis[0]!.getAttribute('width')).toBe('28');
  });

  it('draws marks with at most four caption buttons that report taps', () => {
    const onMarkTap = vi.fn();
    const marks = ['Один', 'Два', 'Три', 'Четыре', 'Длинное название засечки'].map((label, i) => ({ id: `m${i}`, label, height: i / 5 }));
    render(<Hero fill={0.6} marks={marks} onMarkTap={onMarkTap} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(buttons[3]!.textContent).toBe('Длинное наз…');
    fireEvent.click(screen.getByRole('button', { name: 'Засечка: Длинное название засечки' }));
    expect(onMarkTap).toHaveBeenCalledWith('m4');
  });

  it('draws the land and the name of the level, twelve in turn', () => {
    const { container, rerender } = render(<Hero fill={0.5} level={4} />);
    expect(container.querySelector('.moon-land--4')).toBeTruthy();
    expect(container.querySelector('.moon-name')!.textContent).toBe('Розовая луна');
    rerender(<Hero fill={0.5} level={1} />);
    expect(container.querySelector('.moon-land--1')).toBeTruthy();
    cleanup();
    const again = render(<Hero fill={0.5} level={25} />);
    expect(again.container.querySelector('.moon-land--1')).toBeTruthy();
    expect(again.container.querySelector('.moon-name')!.textContent).toBe('Волчья луна');
    cleanup();
    const plain = render(<Hero fill={0.5} />);
    expect(plain.container.querySelector('.moon-land--1')).toBeTruthy();
    expect(plain.container.querySelectorAll('[data-star]')).toHaveLength(0);
  });

  it('lights a star for every completed moon and joins seven into a constellation', () => {
    const { container } = render(<Hero fill={0.5} level={7} />);
    expect(container.querySelectorAll('[data-star]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-lines]')).toHaveLength(0);
    cleanup();
    render(<Hero fill={0.5} level={8} />);
    expect(document.querySelectorAll('[data-star]')).toHaveLength(7);
    expect(document.querySelectorAll('[data-lines="0"]').length).toBeGreaterThan(0);
    // One star twinkles: the newest.
    expect(document.querySelectorAll('.anim-decor')).toHaveLength(1);
    expect(document.querySelector('[data-star="6"]')!.classList.contains('anim-decor')).toBe(true);
    cleanup();
    render(<Hero fill={0.5} level={120} />);
    expect(document.querySelectorAll('[data-star]')).toHaveLength(50);
    expect(document.querySelector('.moon-dust')).toBeTruthy();
  });

  it('marks the special moons', () => {
    const { container } = render(
      <>
        <Hero fill={1} level={13} />
        <Hero fill={1} level={9} />
        <Hero fill={1} level={17} />
        <Hero fill={1} level={17} state="complete" />
      </>,
    );
    const heroes = container.querySelectorAll('.moon--hero');
    expect(heroes[0]!.classList.contains('moon--blue')).toBe(true);
    expect(heroes[1]!.classList.contains('moon--super')).toBe(true);
    expect(heroes[2]!.classList.contains('moon--blood')).toBe(true);
    // A completed skill's Moon is golden, never tinted.
    expect(heroes[3]!.classList.contains('moon--blood')).toBe(false);
    expect(Number((heroes[2]!.querySelector('.moon-tint') as SVGElement).style.opacity)).toBeGreaterThan(0.8);
  });

  it('keeps the sky on screen when the level grows, until the level-up plays, and ends on the new level', async () => {
    for (const [from, levels] of [
      [4, 1],
      [4, 3],
      [12, 2],
    ] as const) {
      stubAnimate();
      const ref = createRef<ProgressHeroHandle>();
      const to = from + levels;
      const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={from} />);
      // The app renders the new level with its fill, then plays the level-up.
      rerender(<Hero ref={ref} fill={0.1} level={to} />);
      expect(container.querySelector(`.moon-land--${((from - 1) % 12) + 1}`)).toBeTruthy();
      expect(container.querySelectorAll('[data-star]')).toHaveLength(from - 1);
      const onOverflow = vi.fn();
      await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.1, levels, onOverflow }));
      await settle();
      expect(onOverflow).toHaveBeenCalledTimes(1);
      const played = markup(container);
      cleanup();
      const fresh = render(<Hero fill={0.1} level={to} />);
      expect(played).toBe(markup(fresh.container));
      expect(fresh.container.querySelectorAll('[data-star]')).toHaveLength(to - 1);
      cleanup();
    }
  });

  it('shows the new level on its own when no level-up follows, and at once when the level goes back', async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Hero fill={0.9} level={4} motion="reduced" />);
    rerender(<Hero fill={0.1} level={5} motion="reduced" />);
    expect(container.querySelector('.moon-land--4')).toBeTruthy();
    act(() => vi.advanceTimersByTime(800));
    expect(container.querySelector('.moon-land--5')).toBeTruthy();
    expect(container.querySelectorAll('[data-star]')).toHaveLength(4);
    rerender(<Hero fill={0.95} level={4} motion="reduced" />);
    expect(container.querySelector('.moon-land--4')).toBeTruthy();
    expect(container.querySelectorAll('[data-star]')).toHaveLength(3);
  });

  it('cancels a sweep that a newer one or a level-up overtakes', async () => {
    const made = stubAnimate(false);
    const ref = createRef<ProgressHeroHandle>();
    const { rerender } = render(<Hero ref={ref} fill={0.2} level={3} motion="full" />);
    rerender(<Hero ref={ref} fill={0.5} level={3} motion="full" />);
    const first = [...made];
    expect(first.length).toBeGreaterThan(0);
    rerender(<Hero ref={ref} fill={0.8} level={3} motion="full" />);
    expect(first.every((a) => a.cancelled)).toBe(true);
    const second = made.slice(first.length);
    expect(second.length).toBeGreaterThan(0);
    expect(second.some((a) => a.cancelled)).toBe(false);
    void ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.1, levels: 1 });
    expect(second.every((a) => a.cancelled)).toBe(true);
  });

  it('still calls onOverflow once where WAAPI is missing', async () => {
    const ref = createRef<ProgressHeroHandle>();
    render(<Hero ref={ref} fill={0.9} />);
    const onOverflow = vi.fn();
    await ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2, onOverflow });
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(ref.current!.element()).toBeTruthy();
  });
});
