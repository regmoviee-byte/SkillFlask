// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../data/db';
import { setClock } from '../../lib/clock';
import { addDays, localDate } from '../../lib/dates';
import * as pauses from '../../services/pauses';
import { pauseSkill } from '../../services/pauses';
import { createSkill, type SkillInput } from '../../services/skills';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { PauseReturns } from './PauseReturns';

const input = (name: string): SkillInput => ({
  name,
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 3,
  capacityBase: 100,
  capacityIncrement: 0,
  manualCapacities: [],
});

installFreshDb();
afterEach(() => {
  cleanup();
  setClock(null);
  vi.restoreAllMocks();
});

describe('PauseReturns', () => {
  it('says once, gently, which skills are back in the plan after their pause ran out', async () => {
    const today = localDate(new Date(todayNoon()));
    // A pause set three days ago for two days: its last day was yesterday.
    setClock(tickingClock(`${addDays(today, -3)}T12:00:00`));
    const guitar = await createSkill(input('Гитара'));
    const running = await createSkill(input('Бег'));
    await pauseSkill(guitar, addDays(today, -1));
    await pauseSkill(running, null);
    // The open happens today at noon (the injectable clock, so a run across midnight stays put).
    setClock(tickingClock(`${today}T12:00:00`, 1));

    const view = render(
      <StrictMode>
        <ToastProvider>
          <PauseReturns />
        </ToastProvider>
      </StrictMode>,
    );
    expect(await screen.findByText('Гитара снова в плане', undefined, { timeout: 4000 })).toBeTruthy();
    expect((await db.pauses.where('skillId').equals(guitar).first())!.endedAt).not.toBeNull();
    // «Бег» still rests; the next open says nothing more.
    view.unmount();
    render(
      <ToastProvider>
        <PauseReturns />
      </ToastProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(screen.queryByText(/снова в плане/)).toBeNull();
  });

  it('still says it when the check outlives the component (midnight, a remount): the pauses are already marked', async () => {
    let answer: (back: { id: string; name: string }[]) => void = () => {};
    const take = vi.spyOn(pauses, 'takeReturns').mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const Host = ({ on }: { on: boolean }) => <ToastProvider>{on && <PauseReturns />}</ToastProvider>;
    const view = render(<Host on />);
    await waitFor(() => expect(take).toHaveBeenCalledTimes(1), { timeout: 4000 });
    // The check has marked the pauses; the component goes before the answer arrives.
    view.rerender(<Host on={false} />);
    answer([{ id: 'reading', name: 'Чтение' }]);
    expect(await screen.findByText('Чтение снова в плане')).toBeTruthy();
  });
});
