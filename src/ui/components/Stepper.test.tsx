// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Stepper } from './Stepper';

afterEach(cleanup);

function Harness({ initial = 5 as number | null, optional = false, step = 1, presets = [1, 5, 10] }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <Stepper label="Очки" value={value} onChange={setValue} min={1} max={20} step={step} presets={presets} optional={optional} />
      <output data-testid="value">{String(value)}</output>
    </>
  );
}

const value = () => screen.getByTestId('value').textContent;
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

describe('Stepper', () => {
  it('steps with − and +, snaps to the step grid and stops at the ends', () => {
    render(<Harness initial={7} step={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Больше' }));
    expect(value()).toBe('10');
    fireEvent.click(screen.getByRole('button', { name: 'Меньше' }));
    fireEvent.click(screen.getByRole('button', { name: 'Меньше' }));
    expect(value()).toBe('1');
    expect((screen.getByRole('button', { name: 'Меньше' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('repeats while held: after 400 ms, every 120 ms, and not once more on release', async () => {
    render(<Harness initial={5} />);
    const more = screen.getByRole('button', { name: 'Больше' });
    fireEvent.pointerDown(more, { pointerType: 'touch' });
    await wait(400 + 120 * 2 + 60);
    fireEvent.pointerUp(more);
    fireEvent.click(more);
    expect(value()).toBe('8');
    await wait(300);
    expect(value()).toBe('8');
  });

  it('stops repeating at the end of the range', async () => {
    render(<Harness initial={19} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Больше' }), { pointerType: 'touch' });
    await wait(700);
    expect(value()).toBe('20');
    // No pointerup reached the now disabled button; − must not be undone by a stale repeat.
    fireEvent.click(screen.getByRole('button', { name: 'Меньше' }));
    await wait(300);
    expect(value()).toBe('19');
  });

  it('takes a typed number, clamps it on blur, and picks presets', () => {
    render(<Harness />);
    const field = screen.getByLabelText('Очки') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '15а' } });
    expect(value()).toBe('15');
    fireEvent.change(field, { target: { value: '99' } });
    fireEvent.blur(field);
    expect(value()).toBe('20');
    fireEvent.click(screen.getByRole('button', { name: '10' }));
    expect(value()).toBe('10');
    expect(screen.getByRole('button', { name: '10' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('may be emptied when optional, and keeps its value otherwise', () => {
    const { unmount } = render(<Harness optional />);
    fireEvent.change(screen.getByLabelText('Очки'), { target: { value: '' } });
    expect(value()).toBe('null');
    unmount();
    render(<Harness />);
    const field = screen.getByLabelText('Очки') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(value()).toBe('5');
    expect(field.value).toBe('5');
  });

  it('starts an empty field from the first preset with +, and disables − while empty', () => {
    render(<Harness initial={null} optional presets={[10, 5]} />);
    const less = screen.getByRole('button', { name: 'Меньше' }) as HTMLButtonElement;
    expect(less.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Больше' }));
    expect(value()).toBe('10');
    expect(less.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Больше' }));
    expect(value()).toBe('11');
  });
});
