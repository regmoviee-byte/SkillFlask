// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { puzzleTheme } from './puzzle';
import { PICTURE_COUNT, PICTURES } from './puzzle-pictures';

const { Hero, Mini } = puzzleTheme;

afterEach(() => {
  cleanup();
  // The WAAPI stand-in of the level-up test (jsdom has no Element.animate).
  delete (Element.prototype as { animate?: unknown }).animate;
});

/** The picture index shown by the board's faint print and by the pieces. */
function shownPictures(container: HTMLElement) {
  const ref = (el: Element | null) => Number(el?.getAttribute('href')?.match(/-pic(\d+)$/)?.[1]);
  return { print: ref(container.querySelector('use.pz-ghost')), pieces: ref(container.querySelector('.pz-piece use')) };
}

describe('puzzle hero', () => {
  it('renders with role img and the Russian label', () => {
    render(<Hero fill={0.5} capacity={100} />);
    expect(screen.getByRole('img', { name: 'Пазл собран на 50%' })).toBeTruthy();
    expect(screen.getByText('6 / 12')).toBeTruthy();
  });

  it('renders every fill and the complete state without errors', () => {
    for (const fill of [0, 0.25, 0.5, 0.75, 0.999, 1]) {
      const { unmount } = render(<Hero fill={fill} />);
      unmount();
    }
    render(<Hero fill={1} state="complete" />);
    expect(screen.getByRole('img', { name: 'Пазл собран на 100%' })).toBeTruthy();
  });

  it('shows mark captions as buttons, the newest four, shortened', () => {
    const onMarkTap = vi.fn();
    const marks = [
      { id: 'a', label: 'Первая', height: 0.1 },
      { id: 'b', label: 'Пробный тест', height: 0.3 },
      { id: 'c', label: 'Длинное название засечки', height: 0.5 },
      { id: 'd', label: 'Четвёртая', height: 0.7 },
      { id: 'e', label: 'Экзамен', height: 0.9 },
    ];
    render(<Hero fill={0.6} marks={marks} onMarkTap={onMarkTap} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Засечка: Длинное название засечки' }).textContent).toBe('Длинное наз…');
    fireEvent.click(screen.getByRole('button', { name: 'Засечка: Экзамен' }));
    expect(onMarkTap).toHaveBeenCalledWith('e');
  });

  it('renders each of the twenty pictures without errors', () => {
    for (let level = 1; level <= PICTURE_COUNT; level++) {
      const { container, unmount } = render(<Hero fill={1} level={level} />);
      const picture = container.querySelector(`[id$="-pic${level - 1}"]`);
      expect(picture?.querySelectorAll('path')).toHaveLength(PICTURES[level - 1]!.shapes.length);
      expect(shownPictures(container)).toEqual({ print: level - 1, pieces: level - 1 });
      unmount();
    }
  });

  it('starts over after twenty levels and shows the first picture without a level', () => {
    const { container, rerender } = render(<Hero fill={0.3} level={21} />);
    expect(shownPictures(container)).toEqual({ print: 0, pieces: 0 });
    rerender(<Hero fill={0.3} level={20} />);
    expect(shownPictures(container)).toEqual({ print: 19, pieces: 19 });
    rerender(<Hero fill={0.3} />);
    expect(shownPictures(container)).toEqual({ print: 0, pieces: 0 });
  });

  it('plays a level-up onto the next picture and counts the pieces', async () => {
    // A WAAPI stand-in whose animations finish at once.
    const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }) as unknown as Animation);
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
    const ref = createRef<ProgressHeroHandle>();
    const onOverflow = vi.fn();
    const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={3} />);
    expect(screen.getByText('10 / 12')).toBeTruthy();
    // The app renders the new level with its fill first, then plays (the contract's level rule).
    await act(async () => {
      flushSync(() => rerender(<Hero ref={ref} fill={0.25} level={5} />));
      await ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.25, levels: 2, onOverflow });
    });
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalled();
    expect(shownPictures(container)).toEqual({ print: 4, pieces: 4 });
    expect(screen.getByText('3 / 12')).toBeTruthy();
  });

  it('still calls onOverflow when WAAPI is missing', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const onOverflow = vi.fn();
    render(<Hero ref={ref} fill={0.9} />);
    expect(ref.current?.element()).toBeTruthy();
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 1, onOverflow }));
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });
});

describe('puzzle mini', () => {
  it('renders a square with the label', () => {
    render(<Mini fill={0.25} size={28} />);
    const img = screen.getByRole('img', { name: 'Пазл собран на 25%' });
    expect(img.getAttribute('width')).toBe('28');
    expect(img.getAttribute('height')).toBe('28');
  });

  it('shows the picture of its level', () => {
    const { container } = render(<Mini fill={1} level={14} />);
    expect(container.querySelectorAll('g[clip-path] path')).toHaveLength(PICTURES[13]!.shapes.length);
  });
});
