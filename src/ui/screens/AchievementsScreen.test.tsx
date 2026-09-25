// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../data/db';
import { setClock } from '../../lib/clock';
import { addDays, localDate } from '../../lib/dates';
import { resetAchievementCache } from '../../services/achievements';
import { completeStep } from '../../services/completions';
import { createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { TabBar } from '../components/TabBar';
import { ToastProvider } from '../components/Toast';
import { AchievementsScreen } from './AchievementsScreen';

const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: 'B1',
  targetLabel: 'C1',
  milestoneName: 'Достичь C1',
  milestoneTarget: 10,
  capacityBase: 100,
  capacityIncrement: 0,
  manualCapacities: [],
};

installFreshDb();
beforeEach(() => {
  setClock(tickingClock(todayNoon()));
  resetAchievementCache();
});
afterEach(() => {
  cleanup();
  document.getElementById('sheets')?.remove();
});

function renderTab(entry = '/achievements') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Routes>
          <Route path="/achievements" element={<AchievementsScreen />} />
          <Route path="*" element={<p>другой экран</p>} />
        </Routes>
        <TabBar />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** Three days of practice: a record of two days in a row, then a gap, then one more day. */
async function history() {
  const skillId = await createSkill(input);
  const stepId = await createStep({ skillId, name: 'Разговор', points: 5 });
  const today = localDate();
  for (const date of [addDays(today, -5), addDays(today, -4), today]) await completeStep(stepId, { date });
  return skillId;
}

const ladder = (title: string) => screen.getByRole('article', { name: title });

describe('AchievementsScreen', () => {
  it('shows the summary, the filter, eight ladders and twelve badge tiles', async () => {
    await history();
    renderTab();
    const ring = await screen.findByRole('img', { name: 'Получено 3 из 49' });
    expect(ring.textContent).toBe('3');
    expect(screen.getByText('из 49')).toBeTruthy();
    // The last unlock: three active days.
    expect(screen.getByText('Дни с практикой · 3')).toBeTruthy();
    const chips = within(screen.getByRole('group', { name: 'Какие ачивки показать' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['Все', 'Получено', 'Впереди']);
    expect(screen.getAllByRole('article')).toHaveLength(8);
    expect(document.querySelectorAll('.ach-tile')).toHaveLength(12);
    expect(within(ladder('Действия')).getByText('Следующая: 10 · ещё 7')).toBeTruthy();
    expect(within(ladder('Дни с практикой')).getByText('Следующая: 10 · ещё 7')).toBeTruthy();
    // The tiers fold out with their dates; tiers ahead show a dash.
    const days = ladder('Дни с практикой');
    expect(within(days).getByText('Ступени · 1 из 7')).toBeTruthy();
    expect(within(days).getAllByText('—')).toHaveLength(6);
  });

  it('never shows a current streak: «Лучшая серия» is the record', async () => {
    await history();
    renderTab();
    const series = await screen.findByRole('article', { name: 'Лучшая серия' });
    // The record is two days (5 and 4 days ago), although today is a run of one.
    expect(series.querySelector('.ladder-number')?.textContent).toBe('2');
    expect(series.textContent).toContain('Следующая: 3 · ещё 1');
    expect(document.body.textContent).not.toMatch(/текущ|сгорел|пропущ|провал/i);
  });

  it('filters: «Получено» keeps the earned, «Впереди» the rest', async () => {
    await history();
    renderTab();
    await screen.findByRole('img', { name: 'Получено 3 из 49' });
    fireEvent.click(screen.getByRole('button', { name: 'Получено' }));
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Дни с практикой']);
    expect([...document.querySelectorAll('.ach-tile-title')].map((t) => t.textContent)).toEqual(['Первый навык', 'Первое действие']);
    fireEvent.click(screen.getByRole('button', { name: 'Впереди' }));
    expect(screen.getAllByRole('article')).toHaveLength(8);
    expect(document.querySelectorAll('.ach-tile')).toHaveLength(10);
    // A locked tile tells how to get it; a tile on its way shows the progress.
    expect(screen.getByRole('button', { name: 'Первый уровень: впереди' }).textContent).toContain('Наберите очки на целый уровень');
    expect(screen.getByRole('button', { name: 'Большой день: 1 из 5' }).textContent).toContain('1 из 5');
  });

  it('opens the detail sheet from a tile', async () => {
    await history();
    renderTab();
    await screen.findByRole('img', { name: 'Получено 3 из 49' });
    fireEvent.click(screen.getByRole('button', { name: /^Первое действие: получена/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Первое действие' });
    expect(within(sheet).getByText('Бронза')).toBeTruthy();
    expect(within(sheet).getByText('Отмечено первое выполнение')).toBeTruthy();
    expect(within(sheet).getByText('Как получить')).toBeTruthy();
    expect(within(sheet).getByText('1 из 1')).toBeTruthy();
    expect(within(sheet).getByText(/^Получена \d+ [а-я]+ · Английский$/)).toBeTruthy();
  });

  it('shows the dot on the tab until the unlocks were on screen for a moment', async () => {
    await history();
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <TabBar />
      </MemoryRouter>,
    );
    const tab = await screen.findByRole('link', { name: 'Ачивки, новых: 3' });
    expect(tab.querySelector('.tab-badge')).toBeTruthy();
    cleanup();

    renderTab();
    await screen.findByRole('img', { name: 'Получено 3 из 49' });
    // Still there right away; gone after the tab was on screen for 800 ms.
    expect(screen.getByRole('link', { name: 'Ачивки, новых: 3' })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.tab-badge')).toBeNull(), { timeout: 3000 });
    expect(screen.getByRole('link', { name: 'Ачивки' })).toBeTruthy();
    expect((await db.achievementUnlocks.toArray()).every((row) => row.seenAt !== null)).toBe(true);
  });

  it('brings ?focus=id into view and pulses it', async () => {
    await history();
    renderTab('/achievements?focus=days-3');
    await screen.findByRole('img', { name: 'Получено 3 из 49' });
    const days = ladder('Дни с практикой');
    expect(days.classList.contains('is-focus')).toBe(true);
    expect(days.querySelector('details')?.open).toBe(true);
    cleanup();
    renderTab('/achievements?focus=first-step');
    await screen.findByRole('img', { name: 'Получено 3 из 49' });
    expect(screen.getByRole('button', { name: /^Первое действие: получена/ }).classList.contains('is-focus')).toBe(true);
  });

  it('greets an empty start with the first achievement to come', async () => {
    renderTab();
    await screen.findByRole('img', { name: 'Получено 0 из 49' });
    expect(screen.getByText('Первая ачивка — за первый навык')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Получено' }));
    expect(screen.getByText('Полученные ачивки появятся здесь')).toBeTruthy();
  });
});
