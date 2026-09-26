// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock } from '../../lib/clock';
import { getErrors } from '../../platform/errorLog';
import { createSkill } from '../../services/skills';
import { installFreshDb, tickingClock } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { SkillScreen } from '../screens/SkillScreen';

// The share sheet's chunk fails to load (a redeploy removed the old hashed files): the menu
// item says so in a toast instead of doing nothing, and the error is logged (ui/lazySafe.ts).

vi.mock('./ShareSheet', () => {
  throw new Error('Failed to fetch dynamically imported module: ShareSheet');
});

installFreshDb();
beforeEach(() => setClock(tickingClock('2026-09-26T12:00:00')));
afterEach(cleanup);

describe('a share sheet chunk that fails to load', () => {
  it('answers «Поделиться прогрессом» with a toast', async () => {
    const id = await createSkill({
      name: 'Английский',
      description: '',
      startLabel: '',
      targetLabel: '',
      milestoneName: 'Цель',
      milestoneTarget: 3,
      capacityBase: 100,
      capacityIncrement: 0,
      manualCapacities: [],
    });
    render(
      <MemoryRouter initialEntries={[`/skills/${id}`]}>
        <ToastProvider>
          <Routes>
            <Route path="/skills/:skillId" element={<SkillScreen />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Меню навыка' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Поделиться прогрессом' }));
    expect(await screen.findByText('Не удалось открыть — перезапустите приложение')).toBeTruthy();
    expect(getErrors().some((entry) => entry.message.includes('chunk ShareSheet'))).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Поделиться прогрессом' })).toBeNull();
  });
});
