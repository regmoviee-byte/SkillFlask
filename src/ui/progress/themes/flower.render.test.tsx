// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { flowerFor, flowerTheme } from './flower';

const { Hero, Mini } = flowerTheme;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Flowers standing in the garden rows (the meadow is drawn as grouped dots). */
const rowFlowers = (root: ParentNode) => root.querySelectorAll('.flower-row > g').length;
/** The plant in the pot: its species class. */
const potSpecies = (root: ParentNode) => [...(root.querySelector('.flower-plant')?.classList ?? [])].find((c) => c.startsWith('fsp-'));

/** Element.animate that finishes at once, so a choreography runs through without a clock. */
function stubAnimate() {
  const animate = vi.fn(function (this: Element) {
    return { finished: Promise.resolve(), cancel: vi.fn(), pause: vi.fn(), play: vi.fn() } as unknown as Animation;
  });
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
  return {
    animate,
    restore: () => {
      delete (Element.prototype as { animate?: unknown }).animate;
    },
  };
}

/** The markup without the per-instance ids of the lawn gradients. */
const markup = (el: Element) => el.innerHTML.replace(/flower-lawn[\w-]*/g, 'ID');

describe('flower hero', () => {
  it('renders as an image with the Russian label', () => {
    render(<Hero fill={0.45} capacity={100} />);
    const img = screen.getByRole('img', { name: 'Цветок вырос на 45%' });
    expect(img.tagName).toBe('svg');
    expect(img.getAttribute('viewBox')).toBe('0 0 160 260');
    // The capacity scale labels the ticks.
    expect(img.textContent).toContain('50');
  });

  it('takes a custom label and the complete state', () => {
    render(<Hero fill={1} state="complete" label="Все цветки распустились" />);
    const img = screen.getByRole('img', { name: 'Все цветки распустились' });
    expect(img.closest('.flower--complete')).not.toBeNull();
  });

  it('draws marks as captions with a tap handler', () => {
    const onMarkTap = vi.fn();
    const marks = [
      { id: 'a', label: 'Пробный тест', height: 0.2 },
      { id: 'b', label: 'Длинное название засечки', height: 0.45 },
      { id: 'c', label: 'Экзамен', height: 0.5 },
    ];
    const { container } = render(<Hero fill={0.6} capacity={100} marks={marks} onMarkTap={onMarkTap} />);
    const long = screen.getByRole('button', { name: 'Засечка: Длинное название засечки' });
    expect(long.textContent).toBe('Длинное наз…');
    fireEvent.click(long);
    expect(onMarkTap).toHaveBeenCalledWith('b');
    expect(screen.getAllByRole('button')).toHaveLength(3);
    // Close marks do not crowd: their pennants stand at least 18 units apart.
    const ys = [...container.querySelectorAll('.flower-mark-pole')].map((l) => Number(l.getAttribute('y1'))).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(18);
  });

  it('grows the species of its level', () => {
    const { container, rerender } = render(<Hero fill={0.5} />);
    expect(potSpecies(container)).toBe('fsp-daisy');
    rerender(<Hero fill={0.5} level={3} />);
    expect(potSpecies(container)).toBe('fsp-sunflower');
    rerender(<Hero fill={0.5} level={40} />);
    expect(potSpecies(container)).toBe(`fsp-${flowerFor(40).key}`);
  });

  it('plants a flower in the garden for every past level', () => {
    const { container, rerender } = render(<Hero fill={0.5} />);
    expect(container.querySelector('.flower-garden')).toBeNull();
    rerender(<Hero fill={0.5} level={1} />);
    expect(container.querySelector('.flower-garden')).toBeNull();
    rerender(<Hero fill={0.5} level={2} />);
    expect(rowFlowers(container)).toBe(1);
    rerender(<Hero fill={0.5} level={6} />);
    expect(rowFlowers(container)).toBe(5);
    expect(container.querySelectorAll('.flower-row')).toHaveLength(3);
    expect(container.querySelector('.flower-fence')).toBeNull();
    rerender(<Hero fill={0.5} level={14} />);
    expect(rowFlowers(container)).toBe(13);
    expect(container.querySelector('.flower-fence')).not.toBeNull();
    expect(container.querySelector('.flower-meadow')).toBeNull();
    rerender(<Hero fill={0.5} level={70} />);
    expect(rowFlowers(container)).toBe(24);
    expect(container.querySelector('.flower-meadow')).not.toBeNull();
    expect(container.querySelector('.flower-can')).not.toBeNull();
    // The garden flowers are the species of their levels, the first a daisy.
    expect(container.querySelector('.flower-row--0 > g .fsp')?.classList.contains('fsp-daisy')).toBe(true);
    // A finished skill keeps its garden; its own flower blooms golden.
    rerender(<Hero fill={1} level={70} state="complete" />);
    expect(rowFlowers(container)).toBe(24);
    expect(container.querySelector('.flower--complete .flower-plant .fl-a')).not.toBeNull();
  });

  it('keeps the idle motion to the sway and the butterfly, still under reduced motion', () => {
    const { container, rerender } = render(<Hero fill={0.9} level={70} motion="full" />);
    expect(container.querySelectorAll('.anim-decor').length).toBeLessThanOrEqual(20);
    expect(container.querySelector('.flower-butterfly.anim-decor')).not.toBeNull();
    rerender(<Hero fill={0.9} level={70} motion="reduced" />);
    expect(container.querySelectorAll('.anim-decor')).toHaveLength(0);
    expect(container.querySelector('.flower-butterfly')).not.toBeNull();
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

describe('flower level-up with the new level already rendered', () => {
  /** Renders `from`, then the app's new level and fill, then plays; returns the hero's container. */
  async function levelUp(from: { level: number; fill: number }, to: { level: number; fill: number }, levels: number, motion: 'full' | 'reduced' = 'full') {
    const stub = stubAnimate();
    const ref = createRef<ProgressHeroHandle>();
    const { container, rerender } = render(<Hero ref={ref} fill={from.fill} level={from.level} motion={motion} />);
    rerender(<Hero ref={ref} fill={to.fill} level={to.level} motion={motion} />);
    const seen: { garden: number; species?: string }[] = [];
    await act(async () => {
      await ref.current!.playLevelUp({
        fromFill: from.fill,
        toFill: to.fill,
        levels,
        onOverflow: () => seen.push({ garden: rowFlowers(container), species: potSpecies(container) }),
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    stub.restore();
    return { container, seen, animate: stub.animate };
  }

  it('blooms the completed flower, then lands exactly on the new props (one level)', async () => {
    const { container, seen, animate } = await levelUp({ level: 4, fill: 0.9 }, { level: 5, fill: 0.1 }, 1);
    // At the beat: level 4's flower in the pot, the garden of levels 1–3.
    expect(seen).toEqual([{ garden: 3, species: `fsp-${flowerFor(4).key}` }]);
    expect(animate).toHaveBeenCalled();
    const fresh = render(<Hero fill={0.1} level={5} motion="full" />);
    expect(markup(container)).toBe(markup(fresh.container));
    expect(rowFlowers(container)).toBe(4);
    expect(potSpecies(container)).toBe(`fsp-${flowerFor(5).key}`);
  });

  it('transplants three flowers and lands on the new props (levels 4 → 7)', async () => {
    const { container, seen } = await levelUp({ level: 4, fill: 0.9 }, { level: 7, fill: 0.1 }, 3);
    expect(seen).toEqual([{ garden: 3, species: `fsp-${flowerFor(4).key}` }]);
    const fresh = render(<Hero fill={0.1} level={7} motion="full" />);
    expect(markup(container)).toBe(markup(fresh.container));
    expect(rowFlowers(container)).toBe(6);
  });

  it('jumps a long run and still lands on the new props (levels 20 → 31)', async () => {
    const { container } = await levelUp({ level: 20, fill: 0.5 }, { level: 31, fill: 0.3 }, 11);
    const fresh = render(<Hero fill={0.3} level={31} motion="full" />);
    expect(markup(container)).toBe(markup(fresh.container));
  });

  it('crossfades straight to the new props under reduced motion', async () => {
    const { container, seen } = await levelUp({ level: 4, fill: 0.9 }, { level: 5, fill: 0.1 }, 1, 'reduced');
    expect(seen).toHaveLength(1);
    const fresh = render(<Hero fill={0.1} level={5} motion="reduced" />);
    expect(markup(container)).toBe(markup(fresh.container));
  });

  it('keeps an empty garden when no level is given', async () => {
    const { container, seen } = await levelUp({ level: 1, fill: 0.9 }, { level: 1, fill: 0.2 }, 1);
    expect(seen).toEqual([{ garden: 0, species: 'fsp-daisy' }]);
    expect(container.querySelector('.flower-garden')).toBeNull();
  });
});

describe('flower mini', () => {
  it('renders a square image with the label', () => {
    render(<Mini fill={0.5} size={28} />);
    const img = screen.getByRole('img', { name: 'Цветок вырос на 50%' });
    expect(img.getAttribute('width')).toBe('28');
    expect(img.getAttribute('height')).toBe('28');
  });

  it('grows the species of its level', () => {
    const { container } = render(<Mini fill={1} level={3} />);
    expect(container.querySelector('.fsp-sunflower')).not.toBeNull();
  });

  it('opens a golden flower when complete', () => {
    const { container } = render(<Mini fill={1} state="complete" />);
    expect(container.querySelector('.flower--complete .flower-plant .fl-a')).not.toBeNull();
  });
});
