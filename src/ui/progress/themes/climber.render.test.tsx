// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgressHeroHandle } from '../contract';
import { climberTheme } from './climber';

const { Hero, Mini } = climberTheme;

afterEach(cleanup);

describe('climber hero', () => {
  it('renders as an image with the Russian label', () => {
    render(<Hero fill={0.45} capacity={100} />);
    expect(screen.getByRole('img', { name: 'Альпинист прошёл 45% подъёма' })).toBeTruthy();
  });

  it('renders every state, and a golden summit when complete', () => {
    const { container, rerender } = render(<Hero fill={0} state="empty" />);
    expect(screen.getByRole('img', { name: 'Альпинист прошёл 0% подъёма' })).toBeTruthy();
    rerender(<Hero fill={0.999} />);
    rerender(<Hero fill={1} state="complete" />);
    expect(container.querySelector('.climber--complete')).toBeTruthy();
    expect(container.querySelector('.cl-flag')?.getAttribute('opacity')).toBe('1');
  });

  it('draws marks as pennants with at most four captions that tap through', () => {
    const onMarkTap = vi.fn();
    const marks = [0.1, 0.2, 0.3, 0.4, 0.5].map((height, i) => ({ id: `m${i}`, label: i === 4 ? 'Длинное название засечки' : `Засечка ${i}`, height }));
    const { container } = render(<Hero fill={0.6} marks={marks} onMarkTap={onMarkTap} />);
    expect(container.querySelectorAll('.cl-mark')).toHaveLength(5);
    const captions = screen.getAllByRole('button');
    expect(captions).toHaveLength(4);
    const long = screen.getByRole('button', { name: 'Засечка: Длинное название засечки' });
    expect(long.textContent).toBe('Длинное наз…');
    fireEvent.click(long);
    expect(onMarkTap).toHaveBeenCalledWith('m4');
    const hits = container.querySelectorAll('.cl-mark-hit');
    expect(hits).toHaveLength(5);
    expect(hits[0]!.getAttribute('width')).toBe('50');
    fireEvent.click(hits[0]!);
    expect(onMarkTap).toHaveBeenCalledWith('m0');
  });

  it('plays a level-up without WAAPI and still calls onOverflow once', async () => {
    const ref = createRef<ProgressHeroHandle>();
    render(<Hero ref={ref} fill={0.9} />);
    const onOverflow = vi.fn();
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 2, onOverflow }));
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(ref.current!.element()?.tagName.toLowerCase()).toBe('svg');
  });

  it('crossfades under reduced motion', async () => {
    const ref = createRef<ProgressHeroHandle>();
    render(<Hero ref={ref} fill={0.9} motion="reduced" />);
    const onOverflow = vi.fn();
    await act(() => ref.current!.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels: 1, onOverflow }));
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });
});

describe('climber mini', () => {
  it('renders at its size with the label', () => {
    const { container } = render(<Mini fill={0.5} size={28} />);
    const svg = screen.getByRole('img', { name: 'Альпинист прошёл 50% подъёма' });
    expect(svg.getAttribute('width')).toBe('28');
    expect(container.querySelector('.cl-dot')).toBeTruthy();
  });

  it('shows the golden flag when complete', () => {
    const { container } = render(<Mini fill={1} state="complete" label="Готово" />);
    expect(screen.getByRole('img', { name: 'Готово' })).toBeTruthy();
    expect(container.querySelector('.cl-flag')).toBeTruthy();
  });
});
