// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { MINI_MAX_EATEN, pizzaTheme, RULER_LABEL_MAX_W, RULER_LABEL_X } from './pizza';

const { Hero, Mini } = pizzaTheme;

afterEach(cleanup);

describe('pizza hero and mini', () => {
  it('renders the hero as an image with the Russian label', () => {
    render(<Hero fill={0.45} capacity={100} />);
    const img = screen.getByRole('img', { name: 'Пицца съедена на 45%' });
    expect(img.tagName).toBe('svg');
    // 0.45 · 8 = 3.6: three whole slices gone, the fourth bitten, five drawn.
    expect(img.querySelectorAll('.pizza-slice')).toHaveLength(5);
    expect(img.querySelectorAll('.pizza-bite').length).toBeGreaterThan(0);
    expect(img.querySelector('.pizza-ruler text:last-child')?.textContent).toBe('100');
  });

  it('keeps the capacity label inside the box for large capacities', () => {
    // jsdom has no layout: 8 units per character is what Chromium measures at 12.5 px
    // («10 000» is about 48 units wide).
    for (const [capacity, text] of [
      [1000, '1 000'],
      [10000, '10 000'],
    ] as const) {
      const { container, unmount } = render(<Hero fill={0.3} capacity={capacity} />);
      const label = container.querySelector('.pizza-ruler text:last-child')!;
      expect(label.textContent?.replace(/\s/g, ' ')).toBe(text);
      expect(Number(label.getAttribute('x')) + label.textContent!.length * 8).toBeLessThanOrEqual(160);
      expect(label.getAttribute('textLength')).toBeNull();
      unmount();
    }
    // Longer numbers are squeezed to a fixed width.
    const { container } = render(<Hero fill={0.3} capacity={1234567} />);
    const label = container.querySelector('.pizza-ruler text:last-child')!;
    expect(Number(label.getAttribute('textLength'))).toBe(RULER_LABEL_MAX_W);
    expect(RULER_LABEL_X + RULER_LABEL_MAX_W).toBeLessThanOrEqual(160);
  });

  it('shows a whole golden pizza with a chef hat for a completed skill', () => {
    const { container } = render(<Hero fill={1} state="complete" label="Все пиццы съедены" />);
    expect(screen.getByRole('img', { name: 'Все пиццы съедены' })).toBeTruthy();
    expect(container.querySelector('.pizza--complete')).toBeTruthy();
    expect(container.querySelectorAll('.pizza-slice')).toHaveLength(8);
    expect(container.querySelector('.pizza-hat')).toBeTruthy();
  });

  it('draws marks as pennants with at most four captions, tappable', () => {
    const onMarkTap = vi.fn();
    const marks = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, label: `Засечка ${id} с длинным названием`, height: 0.1 + i * 0.18 }));
    const { container } = render(<Hero fill={0.6} marks={marks} onMarkTap={onMarkTap} />);
    expect(container.querySelectorAll('.pizza-mark')).toHaveLength(5);
    const captions = screen.getAllByRole('button');
    expect(captions).toHaveLength(4);
    // Each caption starts with the number of its pennant on the rim.
    expect(captions[0]!.textContent).toBe('1Засечка b с…');
    expect(captions.map((c) => c.querySelector('.pizza-mark-caption-num')?.textContent)).toEqual(['1', '2', '3', '4']);
    expect(Array.from(container.querySelectorAll('.pizza-mark-num')).map((n) => n.textContent)).toEqual(['1', '2', '3', '4']);
    fireEvent.click(screen.getByRole('button', { name: 'Засечка: Засечка e с длинным названием' }));
    expect(onMarkTap).toHaveBeenCalledWith('e');
  });

  it('plays a level-up without WAAPI (jsdom): the beat still fires exactly once', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const onOverflow = vi.fn();
    render(<Hero ref={ref} fill={0.9} />);
    expect(ref.current?.element()?.tagName).toBe('svg');
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2, onOverflow }));
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });

  it('keeps a sliver of the last slice in the mini until the level is done', () => {
    const { container } = render(<Mini fill={0.999} />);
    const crust = container.querySelector('.pizza-crust');
    expect(crust).toBeTruthy();
    expect(MINI_MAX_EATEN).toBeLessThan(360);
  });

  it('renders the mini at any size', () => {
    const { container } = render(
      <>
        <Mini fill={0.3} size={28} />
        <Mini fill={1} state="complete" />
      </>,
    );
    const minis = container.querySelectorAll('svg');
    expect(minis).toHaveLength(2);
    expect(minis[0]!.getAttribute('width')).toBe('28');
    expect(minis[0]!.getAttribute('aria-label')).toBe('Пицца съедена на 30%');
    expect(minis[1]!.classList.contains('pizza--complete')).toBe(true);
    expect(minis[1]!.getAttribute('aria-label')).toBe('Пицца съедена на 100%');
  });
});
