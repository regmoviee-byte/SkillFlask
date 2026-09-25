// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { towerTheme } from './tower';

const { Hero, Mini } = towerTheme;

afterEach(cleanup);

describe('tower hero', () => {
  it('renders an image with the Russian label', () => {
    render(<Hero fill={0.45} capacity={100} />);
    const img = screen.getByRole('img', { name: 'Башня построена на 45%' });
    expect(img.tagName.toLowerCase()).toBe('svg');
    // floor(0.45 × 8) = 3 blocks in place, one more on the crane.
    expect(img.querySelectorAll('.tower-stack > g:not(.tower-next) .tower-block')).toHaveLength(3);
    expect(img.querySelector('.tower-next .tower-block')).toBeTruthy();
  });

  it('renders the empty and complete states', () => {
    const { container } = render(
      <>
        <Hero fill={0} state="empty" />
        <Hero fill={1} state="complete" label="Готово" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Башня построена на 0%' })).toBeTruthy();
    const done = screen.getByRole('img', { name: 'Готово' });
    expect(done.querySelectorAll('.tower-block')).toHaveLength(8);
    expect(done.querySelector('.tower-flag-cloth')).toBeTruthy();
    expect(container.querySelectorAll('.tower-bird')).toHaveLength(1);
  });

  it('draws marks with captions that are buttons', () => {
    const onMarkTap = vi.fn();
    render(
      <Hero
        fill={0.6}
        marks={[
          { id: 'a', label: 'Пробный тест', height: 0.2 },
          { id: 'b', label: 'Длинное название засечки', height: 0.5 },
        ]}
        onMarkTap={onMarkTap}
      />,
    );
    expect(screen.getByRole('button', { name: 'Засечка: Пробный тест' }).textContent).toBe('Пробный тест');
    const long = screen.getByRole('button', { name: 'Засечка: Длинное название засечки' });
    expect(long.textContent).toBe('Длинное наз…');
    fireEvent.click(long);
    expect(onMarkTap).toHaveBeenCalledWith('b');
  });

  it('plays a level-up without WAAPI and still calls onOverflow', async () => {
    const ref = createRef<ProgressHeroHandle>();
    render(<Hero ref={ref} fill={0.9} />);
    const onOverflow = vi.fn();
    await ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 1, onOverflow });
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(ref.current!.element()?.tagName.toLowerCase()).toBe('svg');
  });
});

describe('tower city', () => {
  it('stands level − 1 finished towers behind the tower, with calm lamps', () => {
    const { container } = render(
      <>
        <Hero fill={0.3} />
        <Hero fill={0.3} level={5} />
        <Hero fill={0.3} level={40} />
      </>,
    );
    const [first, fifth, fortieth] = Array.from(container.querySelectorAll('.tower--hero'));
    expect(first!.querySelectorAll('.tower-bld')).toHaveLength(0);
    expect(fifth!.querySelectorAll('.tower-bld')).toHaveLength(4);
    expect(fifth!.querySelector('.tower-haze')).toBeNull();
    expect(fortieth!.querySelectorAll('.tower-bld')).toHaveLength(12);
    expect(fortieth!.querySelector('.tower-haze')).toBeTruthy();
    // The city stands behind the ground and the tower.
    const svg = fortieth!.querySelector('svg')!;
    const order = Array.from(svg.querySelectorAll('.tower-city, .tower-ground, .tower-stack'));
    expect(order.map((el) => el.getAttribute('class'))).toEqual(['tower-city', 'tower-ground', 'tower-stack']);
    const live = fortieth!.querySelectorAll('.tower-lamp.anim-decor');
    expect(live.length).toBeGreaterThan(20);
    expect(live.length).toBeLessThanOrEqual(150);
    for (const lamp of Array.from(live)) expect((lamp as SVGElement).style.animationDelay).toMatch(/^-[\d.]+s$/);
  });

  it('adds the finished towers to the city at a level-up the app renders first (the level rule)', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={5} />);
    const count = () => container.querySelectorAll('.tower-bld').length;
    expect(count()).toBe(4);
    await act(async () => {
      flushSync(() => rerender(<Hero ref={ref} fill={0.2} level={7} />));
      await ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2 });
    });
    expect(count()).toBe(6);
    // An undone write takes its towers back.
    rerender(<Hero ref={ref} fill={0.9} level={5} />);
    expect(count()).toBe(4);
  });

  it('keeps the towers of this visit when no level is passed', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const { container } = render(<Hero ref={ref} fill={0.9} />);
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.1, levels: 1 }));
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.1, levels: 1 }));
    expect(container.querySelectorAll('.tower-bld')).toHaveLength(2);
  });
});

describe('tower mini', () => {
  it('renders at the given size with a label', () => {
    render(<Mini fill={0.5} size={28} />);
    const img = screen.getByRole('img', { name: 'Башня построена на 50%' });
    expect(img.getAttribute('width')).toBe('28');
    expect(img.querySelectorAll('.tower-mini-block')).toHaveLength(4);
  });

  it('shows a full golden tower with a flag when complete', () => {
    render(<Mini fill={0.3} state="complete" label="Готово" />);
    const img = screen.getByRole('img', { name: 'Готово' });
    expect(img.querySelectorAll('.tower-mini-block')).toHaveLength(8);
    expect(img.querySelector('.tower-mini-flag')).toBeTruthy();
    expect(img.classList.contains('tower--complete')).toBe(true);
  });
});
