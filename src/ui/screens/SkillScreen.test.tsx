// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../data/db';
import { setClock } from '../../lib/clock';
import { completeStep } from '../../services/completions';
import { archiveSkill } from '../../services/lifecycle';
import { completeSkill, createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { SkillScreen } from './SkillScreen';

const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 1,
  capacityBase: 10,
  capacityIncrement: 0,
  manualCapacities: [],
};

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSkill(id: string) {
  return render(
    <MemoryRouter initialEntries={['/skills', `/skills/${id}`]} initialIndex={1}>
      <ToastProvider>
        <Routes>
          <Route path="/skills" element={<p>home</p>} />
          <Route path="/skills/:skillId" element={<SkillScreen />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('SkillScreen lifecycle', () => {
  it('offers «Удалить навык» on an archived skill, which has no form to open', async () => {
    const id = await createSkill(input);
    const step = await createStep({ skillId: id, name: 'Разговор', points: 3 });
    await completeStep(step);
    await archiveSkill(id);
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);

    renderSkill(id);
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить навык' }));
    expect(await screen.findByText('home', undefined, { timeout: 5000 })).toBeTruthy();
    expect(confirm).toHaveBeenCalledOnce();
    expect(await db.skills.get(id)).toBeUndefined();
    expect(await db.completions.where('skillId').equals(id).count()).toBe(0);
  });

  it('offers it on a completed skill too, and keeps the skill when the answer is no', async () => {
    const id = await createSkill(input);
    const step = await createStep({ skillId: id, name: 'Разговор', points: 10 });
    await completeStep(step);
    await completeSkill(id);
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);

    renderSkill(id);
    const remove = await screen.findByRole('button', { name: 'Удалить навык' });
    fireEvent.click(remove);
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(false));
    expect(await db.skills.get(id)).toBeDefined();
  });

  it('keeps deleting in the form for an active skill', async () => {
    const id = await createSkill(input);
    renderSkill(id);
    await screen.findByRole('link', { name: 'Изменить навык' });
    expect(screen.queryByRole('button', { name: 'Удалить навык' })).toBeNull();
  });
});
