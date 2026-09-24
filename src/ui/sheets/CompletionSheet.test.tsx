// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../data/db';
import { setClock } from '../../lib/clock';
import { cancelCompletion, completeStep } from '../../services/completions';
import { createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { CompletionSheet } from './CompletionSheet';

const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 3,
  capacityBase: 100,
  capacityIncrement: 0,
  manualCapacities: [],
};

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));
afterEach(cleanup);

async function timedCompletion() {
  const skillId = await createSkill(input);
  const stepId = await createStep({ skillId, name: 'Практика', type: 'TIMED', pointsPerMinute: 0.5, defaultMinutes: 30 });
  const { completionId } = await completeStep(stepId, { minutes: 30 });
  return completionId;
}

function renderSheet(completionId: string) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <CompletionSheet completionId={completionId} onClose={() => {}} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('CompletionSheet for a TIMED completion', () => {
  it('corrects 30 → 45 minutes at 0.5 per minute with a CORRECTION of +7,5', async () => {
    const completionId = await timedCompletion();
    renderSheet(completionId);
    const sheet = await screen.findByRole('dialog', { name: 'Практика' });
    expect(within(sheet).getByText('30 мин · 0,5/мин')).toBeTruthy();
    const recalc = within(sheet).getByRole('button', { name: 'Пересчитать' }) as HTMLButtonElement;
    expect(recalc.disabled).toBe(true);

    const field = within(sheet).getByLabelText('Минуты') as HTMLInputElement;
    expect(field.value).toBe('30');
    fireEvent.change(field, { target: { value: '45' } });
    expect(within(sheet).getByText('Было 30 мин (15) → станет 45 мин (+7,5)')).toBeTruthy();
    await act(async () => void fireEvent.click(recalc));

    expect(await screen.findByText('Длительность изменена: +7,5 очка')).toBeTruthy();
    const rows = await db.transactions.where('completionId').equals(completionId).sortBy('createdAt');
    expect(rows.map((t) => [t.reason, t.delta])).toEqual([
      ['COMPLETION', 15],
      ['CORRECTION', 7.5],
    ]);
    expect(await db.completions.get(completionId)).toMatchObject({ durationMinutes: 45, pointsAwarded: 22.5 });
  });

  it('shows the minutes read-only for a cancelled completion', async () => {
    const completionId = await timedCompletion();
    await cancelCompletion(completionId);
    renderSheet(completionId);
    const sheet = await screen.findByRole('dialog', { name: 'Практика' });
    await waitFor(() => expect(within(sheet).getByText('30 мин · 0,5/мин')).toBeTruthy());
    expect(within(sheet).queryByLabelText('Минуты')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Пересчитать' })).toBeNull();
  });
});
