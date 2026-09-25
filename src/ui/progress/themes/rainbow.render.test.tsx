// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { rainbowTheme } from './rainbow';

const { Hero, Mini } = rainbowTheme;

afterEach(cleanup);

describe('rainbow hero and mini', () => {
  it('renders the hero as an image with the Russian label', () => {
    render(<Hero fill={0.456} capacity={100} />);
    expect(screen.getByRole('img', { name: 'Радуга раскрашена на 45%' })).toBeTruthy();
  });

  it('renders every state and a custom label', () => {
    const { rerender } = render(<Hero fill={0} state="empty" />);
    expect(screen.getByRole('img', { name: 'Радуга раскрашена на 0%' })).toBeTruthy();
    rerender(<Hero fill={0.3} state="complete" />);
    expect(screen.getByRole('img', { name: 'Радуга раскрашена на 100%' })).toBeTruthy();
    rerender(<Hero fill={0.3} label="Радуга 2" motion="reduced" />);
    expect(screen.getByRole('img', { name: 'Радуга 2' })).toBeTruthy();
  });

  it('captions the newest four marks as buttons', () => {
    const onMarkTap = vi.fn();
    const marks = ['Первая', 'Пробный тест', 'Длинное название засечки', 'Экзамен', 'Финал'].map((label, i) => ({ id: `m${i}`, label, height: i / 5 }));
    render(<Hero fill={0.6} marks={marks} onMarkTap={onMarkTap} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Пробный тест', 'Длинное наз…', 'Экзамен', 'Финал']);
    fireEvent.click(screen.getByRole('button', { name: 'Засечка: Экзамен' }));
    expect(onMarkTap).toHaveBeenCalledWith('m3');
  });

  it('moves the caption of a mark near the right foot past its pennant, and only that one', () => {
    const marks = [
      { id: 'top', label: 'Вершина', height: 0.5 },
      { id: 'foot', label: 'Финиш', height: 0.97 },
    ];
    render(<Hero fill={0.6} marks={marks} />);
    const [top, foot] = screen.getAllByRole('button');
    expect(top!.style.left).toBe('95%');
    expect(top!.style.getPropertyValue('--rb-shift')).toBe('0.0px');
    expect(parseFloat(foot!.style.left)).toBeGreaterThan(95);
    expect(parseFloat(foot!.style.getPropertyValue('--rb-shift'))).toBeGreaterThan(0);
  });

  it('plays a level-up without WAAPI and still reports the beat', async () => {
    const ref = createRef<ProgressHeroHandle>();
    render(<Hero ref={ref} fill={0.9} />);
    const onOverflow = vi.fn();
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2, onOverflow }));
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(ref.current!.element()).toBeTruthy();
  });

  describe('after a level-up', () => {
    const original = Element.prototype.animate;
    beforeEach(() => {
      // A WAAPI stand-in whose animations finish at once.
      Element.prototype.animate = function () {
        return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
      };
    });
    afterEach(() => {
      Element.prototype.animate = original;
    });
    const frame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    for (const motion of ['full', 'reduced'] as const) {
      it(`follows the fill and the state again (${motion} motion)`, async () => {
        const ref = createRef<ProgressHeroHandle>();
        const { rerender } = render(<Hero ref={ref} fill={0.9} motion={motion} />);
        // The usual order: the prop already shows the new level when the beat plays.
        rerender(<Hero ref={ref} fill={0.2} motion={motion} />);
        await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 1 }));
        await frame();
        expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Радуга раскрашена на 20%');
        rerender(<Hero ref={ref} fill={0.6} motion={motion} />);
        expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Радуга раскрашена на 60%');
        rerender(<Hero ref={ref} fill={0.6} state="complete" motion={motion} />);
        expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Радуга раскрашена на 100%');
      });
    }

    it('follows the fill even before the frame after the beat', async () => {
      const ref = createRef<ProgressHeroHandle>();
      const { rerender } = render(<Hero ref={ref} fill={0.2} />);
      await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 1 }));
      rerender(<Hero ref={ref} fill={0.45} />);
      expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Радуга раскрашена на 45%');
    });

    it('moves on to a prop that differs from the end of the beat', async () => {
      const ref = createRef<ProgressHeroHandle>();
      render(<Hero ref={ref} fill={0.5} />);
      await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 1 }));
      expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Радуга раскрашена на 20%');
      await frame();
      expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Радуга раскрашена на 50%');
    });
  });

  it('turns the mini transition off under reduced motion', () => {
    const { container, rerender } = render(<Mini fill={0.5} motion="reduced" />);
    expect(container.querySelector('svg')!.classList.contains('rainbow-mini--reduced')).toBe(true);
    rerender(<Mini fill={0.5} motion="full" />);
    expect(container.querySelector('svg')!.classList.contains('rainbow-mini--reduced')).toBe(false);
  });

  it('renders the mini at its size', () => {
    render(<Mini fill={0.5} size={28} />);
    const img = screen.getByRole('img', { name: 'Радуга раскрашена на 50%' });
    expect(img.getAttribute('width')).toBe('28');
    render(<Mini fill={0} state="complete" label="Радуга 4 сияет" />);
    expect(screen.getByRole('img', { name: 'Радуга 4 сияет' })).toBeTruthy();
  });
});
