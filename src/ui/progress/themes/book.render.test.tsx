// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { bookTheme } from './book';

const { Hero, Mini } = bookTheme;

afterEach(cleanup);

describe('book hero', () => {
  it('renders an open book with the Russian label and the page count', () => {
    const { container } = render(<Hero fill={0.45} capacity={100} />);
    expect(screen.getByRole('img', { name: 'Книга прочитана на 45%' })).toBeTruthy();
    expect(container.querySelector('.book-label')?.textContent).toBe('стр. 45 из 100');
  });

  it('shows a percentage without a capacity and takes a custom label', () => {
    const { container } = render(<Hero fill={0.5} label="Книга 3: 50%" />);
    expect(screen.getByRole('img', { name: 'Книга 3: 50%' })).toBeTruthy();
    expect(container.querySelector('.book-label')?.textContent).toBe('50 %');
  });

  it('draws a closed golden book when complete', () => {
    const { container } = render(<Hero fill={0.2} state="complete" capacity={100} />);
    expect(container.querySelector('.book-gold')).toBeTruthy();
    expect(container.querySelector('.book-body')).toBeNull();
    expect(screen.getByRole('img', { name: 'Книга прочитана на 100%' })).toBeTruthy();
  });

  it('captions the newest four marks as buttons and reports taps', () => {
    const onMarkTap = vi.fn();
    const marks = [0.1, 0.3, 0.5, 0.7, 0.9].map((height, i) => ({ id: `m${i}`, label: i === 4 ? 'Длинное название засечки' : `Засечка ${i}`, height }));
    render(<Hero fill={0.6} marks={marks} onMarkTap={onMarkTap} />);
    const captions = screen.getAllByRole('button');
    expect(captions).toHaveLength(4);
    expect(captions.at(-1)!.textContent).toBe('Длинное наз…');
    fireEvent.click(screen.getByRole('button', { name: 'Засечка: Длинное название засечки' }));
    expect(onMarkTap).toHaveBeenCalledWith('m4');
  });

  it('shows no shelf at level 1, a book per past level after that', () => {
    const { container, rerender } = render(<Hero fill={0.3} capacity={100} />);
    expect(container.querySelector('.book-plank')).toBeNull();
    rerender(<Hero fill={0.3} capacity={100} level={1} />);
    expect(container.querySelector('.book-plank')).toBeNull();
    rerender(<Hero fill={0.3} capacity={100} level={6} />);
    expect(container.querySelectorAll('[data-book]')).toHaveLength(5);
    expect(container.querySelector('[data-frame]')).toBeNull();
    rerender(<Hero fill={0.3} capacity={100} level={70} />);
    expect(container.querySelectorAll('[data-book]')).toHaveLength(69);
    expect(container.querySelector('[data-frame]')).toBeTruthy();
    expect(container.querySelectorAll('[data-row]')).toHaveLength(3);
    // The finished skill keeps its bookcase.
    rerender(<Hero fill={1} state="complete" capacity={100} level={70} />);
    expect(container.querySelectorAll('[data-book]')).toHaveLength(69);
  });

  it('counts the books from `level`, which the app moves on during the level-up', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const { container, rerender } = render(<Hero ref={ref} fill={0.9} level={4} />);
    expect(container.querySelectorAll('[data-book]')).toHaveLength(3);
    await act(async () => {
      await ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2, onOverflow: () => rerender(<Hero ref={ref} fill={0.2} level={6} />) });
    });
    expect(container.querySelectorAll('[data-book]')).toHaveLength(5);
    // A new level from outside (a restart) wins.
    rerender(<Hero ref={ref} fill={0} level={1} />);
    expect(container.querySelectorAll('[data-book]')).toHaveLength(0);
  });

  it('keeps the books shelved on screen when no level is given', async () => {
    const ref = createRef<ProgressHeroHandle>();
    const { container } = render(<Hero ref={ref} fill={0.9} />);
    expect(container.querySelector('.book-plank')).toBeNull();
    await act(async () => {
      await ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2 });
    });
    expect(container.querySelectorAll('[data-book]')).toHaveLength(2);
  });

  it('colours the marks the reading has passed', () => {
    const marks = [0.2, 0.5, 0.8].map((height, i) => ({ id: `m${i}`, label: `Засечка ${i}`, height }));
    const { container } = render(<Hero fill={0.5} marks={marks} />);
    expect(container.querySelectorAll('.book-mark--reached')).toHaveLength(2);
    expect(container.querySelectorAll('.book-mark-caption--reached')).toHaveLength(2);
  });

  it('plays a level-up without WAAPI and still calls onOverflow once', async () => {
    const ref = createRef<ProgressHeroHandle>();
    render(<Hero ref={ref} fill={0.9} />);
    const onOverflow = vi.fn();
    await act(async () => {
      await ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2, onOverflow });
    });
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(ref.current!.element()).toBeTruthy();
  });
});

describe('book mini', () => {
  it('renders at the given size with the Russian label', () => {
    render(<Mini fill={0.25} size={28} />);
    const img = screen.getByRole('img', { name: 'Книга прочитана на 25%' });
    expect(img.getAttribute('width')).toBe('28');
  });

  it('renders the golden book when complete', () => {
    const { container } = render(<Mini fill={1} state="complete" />);
    expect(container.querySelector('.book-mini-gold')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Книга прочитана на 100%' })).toBeTruthy();
  });
});
