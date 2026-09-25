// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { LEVEL_HOLD_MS, RocketMini, planetFor, rocketTheme } from './rocket';

const { Hero, Mini } = rocketTheme;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The markup, attributes sorted and the useId prefix taken out, so two renders compare equal. */
function markup(container: HTMLElement): string {
  const id = container.querySelector('radialGradient')!.id.replace(/-halo$/, '');
  const walk = (node: Node): string => {
    if (!(node instanceof Element)) return node.textContent ?? '';
    const attributes = [...node.attributes].map((a) => `${a.name}="${a.value}"`).sort();
    return `<${node.tagName} ${attributes.join(' ')}>${[...node.childNodes].map(walk).join('')}</${node.tagName}>`;
  };
  return [...container.childNodes].map(walk).join('').split(id).join('ID');
}

/** Element.animate that finishes at once and never touches the DOM. */
function instantAnimations() {
  const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel() {} }) as unknown as Animation);
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
  return () => {
    delete (Element.prototype as { animate?: unknown }).animate;
  };
}

const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

describe('rocket hero', () => {
  it('renders as an image with the Russian label', () => {
    render(<Hero fill={0.45} capacity={100} />);
    const img = screen.getByRole('img', { name: 'Ракета пролетела 45% пути' });
    expect(img.getAttribute('viewBox')).toBe('0 0 160 260');
  });

  it('renders every state and takes a custom label', () => {
    const { rerender } = render(<Hero fill={0} state="empty" />);
    expect(screen.getByRole('img', { name: 'Ракета пролетела 0% пути' })).toBeTruthy();
    rerender(<Hero fill={0.3} state="complete" />);
    expect(screen.getByRole('img', { name: 'Ракета пролетела 100% пути' })).toBeTruthy();
    rerender(<Hero fill={0.3} label="Полёт 2" motion="reduced" />);
    expect(screen.getByRole('img', { name: 'Полёт 2' })).toBeTruthy();
  });

  it('draws the Earth and the Moon on level 1, the last planet as the ground later on', () => {
    const { container } = render(<Hero fill={0.5} />);
    expect(container.querySelector('.rocket-earth')).toBeTruthy();
    expect(container.querySelector('.rocket-planet--moon')).toBeTruthy();
    const fresh = render(<Hero fill={0.5} level={6} />);
    expect(fresh.container.querySelector('.rocket-earth')).toBeNull();
    // The ground is planet 5 (its colour), the destination planet 6.
    const bases = [...fresh.container.querySelectorAll('.rk-pb')].map((el) => el.getAttribute('fill'));
    expect(bases).toContain(planetFor(5).base);
    expect(bases).toContain(planetFor(6).base);
  });

  it('captions the newest four marks as buttons and reports taps', () => {
    const onMarkTap = vi.fn();
    const marks = ['Первый', 'Пробный тест', 'Длинное название засечки', 'Экзамен', 'Финал'].map((label, i) => ({ id: `m${i}`, label, height: (i + 1) / 6 }));
    render(<Hero fill={0.6} marks={marks} onMarkTap={onMarkTap} level={3} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Пробный тест', 'Длинное наз…', 'Экзамен', 'Финал']);
    fireEvent.click(screen.getByRole('button', { name: 'Засечка: Длинное название засечки' }));
    expect(onMarkTap).toHaveBeenCalledWith('m2');
  });

  it('plays a level-up without WAAPI and still calls onOverflow once', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const { rerender } = render(<Hero ref={ref} fill={0.9} />);
    rerender(<Hero ref={ref} fill={0.2} level={3} />);
    const onOverflow = vi.fn();
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2, onOverflow }));
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(ref.current!.element()).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Ракета пролетела 20% пути' })).toBeTruthy();
  });

  it('holds the scene on screen while a new level waits for its level-up', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Hero fill={0.9} level={4} />);
    rerender(<Hero fill={0.1} level={5} />);
    expect(screen.getByRole('img', { name: 'Ракета пролетела 90% пути' })).toBeTruthy();
    // No play follows: the new level shows after a while.
    act(() => vi.advanceTimersByTime(LEVEL_HOLD_MS + 10));
    expect(screen.getByRole('img', { name: 'Ракета пролетела 10% пути' })).toBeTruthy();
  });

  for (const [levels, to] of [
    [1, 5],
    [3, 7],
  ] as const) {
    it(`ends a level-up of ${levels} on the scene of the new level, as a fresh render draws it (4 → ${to})`, async () => {
      const restore = instantAnimations();
      try {
        const ref = createRef<ProgressHeroHandle>();
        const played = render(<Hero ref={ref} fill={0.9} level={4} />);
        // The app renders the new level with its fill, then asks for the level-up.
        played.rerender(<Hero ref={ref} fill={0.1} level={to} />);
        const onOverflow = vi.fn();
        await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.1, levels, onOverflow }));
        await nextFrame();
        expect(onOverflow).toHaveBeenCalledTimes(1);
        const fresh = render(<Hero fill={0.1} level={to} />);
        expect(markup(played.container)).toBe(markup(fresh.container));
      } finally {
        restore();
      }
    });
  }

  it('crossfades a level-up under reduced motion and ends on the new level', async () => {
    const restore = instantAnimations();
    try {
      const ref = createRef<ProgressHeroHandle>();
      const played = render(<Hero ref={ref} fill={0.9} level={2} motion="reduced" />);
      played.rerender(<Hero ref={ref} fill={0.3} level={3} motion="reduced" />);
      const onOverflow = vi.fn();
      await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.3, levels: 1, onOverflow }));
      await nextFrame();
      expect(onOverflow).toHaveBeenCalledTimes(1);
      const fresh = render(<Hero fill={0.3} level={3} motion="reduced" />);
      expect(markup(played.container)).toBe(markup(fresh.container));
    } finally {
      restore();
    }
  });
});

describe('rocket mini', () => {
  it('renders at the given size with the label', () => {
    render(<Mini fill={0.25} size={28} />);
    const img = screen.getByRole('img', { name: 'Ракета пролетела 25% пути' });
    expect(img.getAttribute('width')).toBe('28');
    expect(img.getAttribute('viewBox')).toBe('0 0 40 40');
  });

  it('renders the complete and empty states', () => {
    render(
      <>
        <Mini fill={0.5} state="complete" />
        <Mini fill={0.5} state="empty" />
      </>,
    );
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('shows the destination of a later level', () => {
    const { container } = render(<RocketMini fill={0.5} level={7} />);
    const bases = [...container.querySelectorAll('.rk-pb')].map((el) => el.getAttribute('fill'));
    expect(bases).toContain(planetFor(7).base);
    expect(bases).toContain(planetFor(6).base);
  });
});
