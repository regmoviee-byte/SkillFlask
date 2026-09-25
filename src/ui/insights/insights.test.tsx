// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock } from '../../lib/clock';
import { completeStep } from '../../services/completions';
import { createSkill, setSkillAppearance, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { SkillScreen } from '../screens/SkillScreen';
import { SkillsScreen } from '../screens/SkillsScreen';

// «Прогноз» and «Активность» on the screens (v0.5 package 14): the lazy line, its sheet with
// «А если к дате?», the heat maps and the day sheet. The clock is fixed on 24 September 2026.

const TODAY = '2026-09-24';
const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: 'B1',
  targetLabel: 'B2',
  milestoneName: 'Достичь B2',
  milestoneTarget: 3,
  capacityBase: 100,
  capacityIncrement: 50,
  manualCapacities: [],
};

installFreshDb();
beforeEach(() => setClock(tickingClock(`${TODAY}T12:00:00`)));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let location: ReturnType<typeof useLocation> | null = null;
function Where() {
  location = useLocation();
  return null;
}

function renderAt(entry: string | { pathname: string; state: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Routes>
          <Route path="/skills" element={<SkillsScreen />} />
          <Route path="/skills/:skillId" element={<SkillScreen />} />
        </Routes>
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** A skill practised on four days: 10 points each, 40 over ten days → 4 a day. */
async function practisedSkill() {
  const skillId = await createSkill(input);
  const stepId = await createStep({ skillId, name: 'Разговор', points: 10 });
  await createStep({ skillId, name: 'Чтение', type: 'TIMED', pointsPerMinute: 0.5, defaultMinutes: 30 });
  for (const date of ['2026-09-15', '2026-09-20', '2026-09-22', TODAY]) await completeStep(stepId, { date });
  return skillId;
}

describe('the forecast line', () => {
  it('says when the level fills, in the words of the theme, and opens «Прогноз»', async () => {
    const id = await practisedSkill();
    renderAt(`/skills/${id}`);
    const line = await screen.findByRole('button', { name: 'В таком темпе колба 1 заполнится ≈ 9 октября' });
    fireEvent.click(line);
    const sheet = await screen.findByRole('dialog', { name: 'Прогноз' });
    expect(within(sheet).getByText('≈ 28 очков в неделю за последние 10 дней')).toBeTruthy();
    expect(within(sheet).getByText('Колба 1')).toBeTruthy();
    expect(within(sheet).getByText('Цель «B2»')).toBeTruthy();
    expect(within(sheet).getByText('0 из 3 колб')).toBeTruthy();
    expect(within(sheet).getByText('примерно в январе 2027')).toBeTruthy();

    // «А если к дате?»: three months ahead by default, 410 points in 91 days.
    const field = within(sheet).getByLabelText('Дата') as HTMLInputElement;
    expect(field.value).toBe('2026-12-24');
    expect(field.min).toBe('2026-09-25');
    expect(
      within(sheet).getByText('Нужно ≈ 32 очка в неделю: например, «Разговор» 4 раза в неделю или «Чтение» по 30 мин 3 раза'),
    ).toBeTruthy();
    // Half a year ahead the current pace is enough.
    fireEvent.change(field, { target: { value: '2027-03-24' } });
    expect(within(sheet).getByText('В нынешнем темпе вы успеваете к этой дате')).toBeTruthy();
    fireEvent.change(field, { target: { value: TODAY } });
    expect(within(sheet).getByText('Выберите дату после сегодняшней')).toBeTruthy();
  });

  it('speaks the nouns of the skill’s theme', async () => {
    const id = await practisedSkill();
    await setSkillAppearance(id, { theme: 'pizza' });
    renderAt(`/skills/${id}`);
    expect(await screen.findByRole('button', { name: 'В таком темпе пицца 1 будет съедена ≈ 9 октября' })).toBeTruthy();
  });

  it('is not shown without enough practice, and a new skill’s map says what will appear', async () => {
    const id = await createSkill(input);
    const stepId = await createStep({ skillId: id, name: 'Разговор', points: 10 });
    await completeStep(stepId, { date: '2026-09-22' });
    await completeStep(stepId);
    renderAt(`/skills/${id}`);
    await screen.findByRole('group', { name: 'За полгода: 2 дня с занятиями' });
    expect(screen.queryByRole('button', { name: /В таком темпе/ })).toBeNull();

    cleanup();
    const fresh = await createSkill({ ...input, name: 'Гитара' });
    renderAt(`/skills/${fresh}`);
    expect(await screen.findByText('Здесь будут видны дни с занятиями')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'За полгода: 0 дней с занятиями' })).toBeTruthy();
  });
});

describe('the heat maps', () => {
  it('opens a day of the skill’s map with what was done, and steps to the day before', async () => {
    const id = await practisedSkill();
    renderAt(`/skills/${id}`);
    const map = await screen.findByRole('group', { name: 'За полгода: 4 дня с занятиями' });
    fireEvent.click(within(map).getByRole('button', { name: '22 сентября: 1 действие, 10 очков' }));
    const sheet = await screen.findByRole('dialog', { name: 'вторник, 22\u00a0сентября' });
    expect(within(sheet).getByText('1 действие · 10 очков')).toBeTruthy();
    expect(within(sheet).getByText('Разговор')).toBeTruthy();
    expect(within(sheet).getByText('+10')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'История навыка' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Предыдущий день' }));
    expect(await within(sheet).findByText('В этот день занятий не было')).toBeTruthy();
    expect(within(sheet).getByRole('heading', { name: 'понедельник, 21\u00a0сентября' })).toBeTruthy();
  });

  it('scrolls its own screen to the history once the day sheet has let go of the page', async () => {
    const id = await practisedSkill();
    renderAt(`/skills/${id}`);
    const map = await screen.findByRole('group', { name: 'За полгода: 4 дня с занятиями' });
    fireEvent.click(within(map).getByRole('button', { name: '22 сентября: 1 действие, 10 очков' }));
    const sheet = await screen.findByRole('dialog', { name: 'вторник, 22\u00a0сентября' });
    // Whether the sheet still held the page's scroll (which its unlock would undo) at the scroll.
    const lockedAtScroll: boolean[] = [];
    const history = document.querySelector('.history');
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      if (this === history) lockedAtScroll.push(document.body.classList.contains('sheet-lock'));
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'История навыка' }));
    await waitFor(() => expect(lockedAtScroll).toEqual([false]));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(location?.pathname).toBe(`/skills/${id}`);
  });

  it('shows every skill on the home screen once there is practice, and a day leads to a skill’s history', async () => {
    renderAt('/skills');
    await screen.findByText('Первый навык');
    expect(screen.queryByText('Активность · все навыки')).toBeNull();
    cleanup();

    const id = await practisedSkill();
    const other = await createSkill({ ...input, name: 'Гитара' });
    await completeStep(await createStep({ skillId: other, name: 'Аккорды', points: 3 }));
    renderAt('/skills');
    expect(await screen.findByText('Активность · все навыки')).toBeTruthy();
    const map = await screen.findByRole('group', { name: 'За полгода: 4 дня с занятиями' });
    fireEvent.click(within(map).getByRole('button', { name: '24 сентября: 2 действия, 13 очков' }));
    const sheet = await screen.findByRole('dialog', { name: 'четверг, 24\u00a0сентября' });
    expect(within(sheet).getByText('Аккорды')).toBeTruthy();

    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    fireEvent.click(within(sheet).getByRole('button', { name: 'История навыка «Английский»' }));
    await waitFor(() => expect(location?.pathname).toBe(`/skills/${id}`));
    await waitFor(() => expect(scrolled.mock.contexts.some((el) => (el as Element).classList.contains('history'))).toBe(true));
    // Once: the entry forgets it, so a later visit starts at the top.
    await waitFor(() => expect(location?.state).toBeNull());
    expect(location?.pathname).toBe(`/skills/${id}`);
  });

  it('is not on the home screen when nothing was done in its half year', async () => {
    // Practice long ago: written in January, nothing since.
    setClock(tickingClock('2026-01-12T12:00:00'));
    const id = await createSkill(input);
    const stepId = await createStep({ skillId: id, name: 'Разговор', points: 10 });
    await completeStep(stepId);
    setClock(tickingClock(`${TODAY}T12:00:00`));
    renderAt('/skills');
    await screen.findByText('Английский');
    expect(screen.queryByText('Активность · все навыки')).toBeNull();
    cleanup();

    // Written today, but back-dated past the half year: the map finds nothing and drops itself.
    await completeStep(stepId, { date: '2026-02-02' });
    renderAt('/skills');
    await screen.findByText('Английский');
    await waitFor(() => expect(screen.queryByText('Активность · все навыки')).toBeNull());
    expect(screen.queryByText('За полгода отметок нет')).toBeNull();
  });
});
