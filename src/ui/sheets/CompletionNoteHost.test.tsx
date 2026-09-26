// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../data/db';
import { setClock } from '../../lib/clock';
import { setSetting } from '../../services/settings';
import { createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { CelebrationProvider } from '../celebrations/CelebrationProvider';
import { ASK_NOTE_KEY } from '../completionFeedback';
import { DialogHost } from '../components/DialogHost';
import { ToastProvider } from '../components/Toast';
import { SkillScreen } from '../screens/SkillScreen';
import { CompletionNoteHost } from './CompletionNoteHost';

// «Заметка» in the completion toast and «Спрашивать заметку после каждого действия» (v0.5
// package 17): both open the completion's own sheet with the note focused, through the host the
// app mounts once.

const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 10,
  capacityBase: 100,
  capacityIncrement: 0,
  manualCapacities: [],
};

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));
afterEach(cleanup);

async function setup() {
  const skillId = await createSkill(input);
  const stepId = await createStep({ skillId, name: 'Разговор', points: 5 });
  return { skillId, stepId };
}

function renderSkill(skillId: string) {
  return render(
    <MemoryRouter initialEntries={[`/skills/${skillId}`]}>
      <ToastProvider>
        <CelebrationProvider>
          <Routes>
            <Route path="/skills/:skillId" element={<SkillScreen />} />
          </Routes>
          <CompletionNoteHost />
          <DialogHost />
        </CelebrationProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const check = () => screen.findByRole('button', { name: 'Отметить: Разговор, +5 очков' });
const noteSheet = () => screen.findByRole('dialog', { name: 'Разговор' });
const completions = () => db.completions.toArray();

describe('the completion toast’s «Заметка»', () => {
  it('opens the completion’s sheet with the note focused and saves what was typed', async () => {
    const { skillId } = await setup();
    renderSkill(skillId);
    fireEvent.click(await check());
    const toast = await screen.findByRole('status');
    expect(within(toast).getByText('+5 · Разговор')).toBeTruthy();
    // Both actions are there, «Заметка» first.
    expect(within(toast).getAllByRole('button').map((b) => b.textContent)).toEqual(['Заметка', 'Отменить']);

    fireEvent.click(within(toast).getByRole('button', { name: 'Заметка' }));
    const sheet = await noteSheet();
    const field = within(sheet).getByRole('textbox');
    await waitFor(() => expect(document.activeElement).toBe(field));
    // The toast is gone; the completion is untouched until something is typed.
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull();

    fireEvent.change(field, { target: { value: 'Про погоду и планы' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByText('Заметка сохранена')).toBeTruthy();
    const [completion] = await completions();
    expect(completion).toMatchObject({ note: 'Про погоду и планы', status: 'ACTIVE' });
  });
});

describe('«Спрашивать заметку после каждого действия»', () => {
  it('stays closed while the setting is off (the default)', async () => {
    const { skillId } = await setup();
    renderSkill(skillId);
    fireEvent.click(await check());
    expect(await screen.findByRole('button', { name: 'Заметка' })).toBeTruthy();
    // Given the moment the sheet would have taken to open.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the sheet after a ✓, once for a double tap; closed empty it writes nothing', async () => {
    const { skillId } = await setup();
    await setSetting(ASK_NOTE_KEY, true);
    renderSkill(skillId);
    const button = await check();
    fireEvent.click(button);
    fireEvent.click(button); // the second tap of a double tap: swallowed by the busy ✓
    const sheet = await noteSheet();
    await waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole('textbox')));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(await completions()).toHaveLength(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Заметка сохранена')).toBeNull();
    const [completion] = await completions();
    expect(completion!.note).toBeNull();
    expect(completion!.updatedAt).toBe(completion!.createdAt);
  });

  it('does not open after «Отменить»', async () => {
    const { skillId } = await setup();
    await setSetting(ASK_NOTE_KEY, true);
    renderSkill(skillId);
    fireEvent.click(await check());
    await noteSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(await screen.findByText(/^Отменено · Колба 1/)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole('dialog')).toBeNull();
    const [completion] = await completions();
    expect(completion!.status).toBe('CANCELLED');
  });

  it('does not ask again after «Сколько минут?», which has its own note field', async () => {
    const skillId = await createSkill(input);
    await createStep({ skillId, name: 'Чтение', type: 'TIMED', pointsPerMinute: 1, defaultMinutes: 20 });
    await setSetting(ASK_NOTE_KEY, true);
    renderSkill(skillId);
    fireEvent.click(await screen.findByRole('button', { name: /^Отметить: Чтение/ }));
    const minutes = await screen.findByRole('dialog', { name: 'Сколько минут?' });
    fireEvent.change(within(minutes).getByLabelText('Заметка'), { target: { value: 'Глава 3' } });
    fireEvent.click(within(minutes).getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText('+20 · Чтение')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole('dialog')).toBeNull();
    const [completion] = await completions();
    expect(completion).toMatchObject({ note: 'Глава 3', durationMinutes: 20 });
    expect(completion!.updatedAt).toBe(completion!.createdAt);
  });
});
