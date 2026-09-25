// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock } from '../../lib/clock';
import { getErrors } from '../../platform/errorLog';
import { completeStep } from '../../services/completions';
import { createSkill } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock } from '../../test/harness';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ToastProvider } from '../components/Toast';
import { SkillScreen } from '../screens/SkillScreen';
import { SkillsScreen } from '../screens/SkillsScreen';

// A lazy chunk that fails to load (a flaky network, or a redeploy that removed the old hashed
// files) leaves its place empty and is logged; it never takes the screen down to the app's
// «Что-то пошло не так» (ui/lazySafe.ts). Every lazy chunk of the two screens fails here.

vi.mock('./ForecastLine', () => {
  throw new Error('Failed to fetch dynamically imported module: ForecastLine');
});
vi.mock('./ActivityCard', () => {
  throw new Error('Failed to fetch dynamically imported module: ActivityCard');
});
vi.mock('../sheets/LinkSheet', () => {
  throw new Error('Failed to fetch dynamically imported module: LinkSheet');
});

const TODAY = '2026-09-24';

installFreshDb();
beforeEach(() => setClock(tickingClock(`${TODAY}T12:00:00`)));
afterEach(cleanup);

function renderAt(path: string) {
  return render(
    <ErrorBoundary>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/skills" element={<SkillsScreen />} />
            <Route path="/skills/:skillId" element={<SkillScreen />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </ErrorBoundary>,
  );
}

describe('a lazy chunk that fails to load', () => {
  it('leaves the skill screen and the home screen working', async () => {
    const skillId = await createSkill({
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
    const stepId = await createStep({ skillId, name: 'Разговор', points: 10 });
    for (const date of ['2026-09-15', '2026-09-20', '2026-09-22', TODAY]) await completeStep(stepId, { date });

    renderAt(`/skills/${skillId}`);
    await screen.findByRole('heading', { name: 'История' });
    await waitFor(() => expect(getErrors().map((e) => e.message)).toEqual(expect.arrayContaining([expect.stringMatching(/^chunk ForecastLine/)])));
    await waitFor(() => expect(document.querySelector('.activity')).toBeNull());
    expect(document.querySelector('.forecast-line')).toBeNull();
    expect(screen.getAllByText('Разговор').length).toBeGreaterThan(0);
    expect(screen.queryByText('Что-то пошло не так')).toBeNull();
    cleanup();

    renderAt('/skills');
    await screen.findByText('Английский');
    await waitFor(() => expect(screen.queryByText('Активность · все навыки')).toBeNull());
    expect(screen.queryByText('Что-то пошло не так')).toBeNull();
  });
});
