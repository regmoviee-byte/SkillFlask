// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../../lib/clock';
import { resetAchievementCache } from '../../services/achievements';
import { completeStep } from '../../services/completions';
import { createSkill } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { AchievementsScreen } from './AchievementsScreen';
import { RecapScreen } from './RecapScreen';
import { SkillsScreen } from './SkillsScreen';

// Thursday, 24 September 2026: the current week is 21–27, the last completed one 14–20.
installFreshDb();
beforeEach(() => {
  setClock(tickingClock('2026-09-24T12:00:00'));
  resetAchievementCache();
});
afterEach(() => {
  cleanup();
  document.getElementById('sheets')?.remove();
});

let path = '';
function Path() {
  const location = useLocation();
  path = location.pathname + location.search;
  return null;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Routes>
          <Route path="/recap" element={<RecapScreen />} />
          <Route path="/recap/:weekStart" element={<RecapScreen />} />
          <Route path="/achievements" element={<AchievementsScreen />} />
          <Route path="/skills" element={<SkillsScreen />} />
          <Route path="*" element={<p>другой экран</p>} />
        </Routes>
        <Path />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function seed() {
  const skillId = await createSkill({
    name: 'Английский',
    description: '',
    startLabel: '',
    targetLabel: '',
    milestoneName: 'Веха',
    milestoneTarget: 10,
    capacityBase: 20,
    capacityIncrement: 0,
    manualCapacities: [],
  });
  const stepId = await createStep({ skillId, name: 'Разговорная практика', points: 10 });
  // The week of the 7th: one completion; the 14th–20th: four on three days; this week: one.
  for (const date of ['2026-09-08', '2026-09-14', '2026-09-14', '2026-09-16', '2026-09-20', '2026-09-22']) {
    await completeStep(stepId, { date });
  }
  return { skillId, stepId };
}

const switcher = () => screen.getByRole('group', { name: 'Неделя' });

describe('RecapScreen', () => {
  it('opens on the last completed week with its tiles, the best of the week and only favourable comparisons', async () => {
    const { skillId } = await seed();
    renderAt('/recap');
    expect(within(switcher()).getByText('14–20 сентября')).toBeTruthy();
    expect(await screen.findByText('Лучшее за неделю')).toBeTruthy();
    const tile = (label: string) => screen.getByText(label, { selector: '.tile-label' }).closest('.tile')!;
    expect(tile('Активные дни').querySelectorAll('.week-day.is-active')).toHaveLength(3);
    // A past week outlines no day as today.
    expect(tile('Активные дни').querySelector('.week-day.is-today')).toBeNull();
    expect(screen.getByText('Больше очков, чем на прошлой неделе')).toBeTruthy();
    const best = screen.getByText('Больше всего очков').closest('a')!;
    expect(best.getAttribute('href')).toBe(`/skills/${skillId}`);
    expect(within(best).getByText('40 очков')).toBeTruthy();
    expect(screen.getByText('Чаще всего').closest('.info-row')!.textContent).toBe('Чаще всего×4 · Разговорная практика · Английский');
    // Records set this week carry the laurel and «Рекорд · …».
    expect(screen.getByText('Лучший день').closest('.info-row')!.textContent).toContain('Рекорд · 14\u00a0сентября');
    expect(document.body.textContent).not.toMatch(/меньше|хуже|пропущ/i);
  });

  it('switches weeks without passing the current one, which is still going', async () => {
    await seed();
    renderAt('/recap/2026-09-16');
    expect(within(switcher()).getByText('14–20 сентября')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }));
    expect(path).toBe('/recap/2026-09-21');
    expect(await within(switcher()).findByText('Неделя ещё идёт')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Следующая неделя' }).hasAttribute('disabled')).toBe(true);
    // The first week with a completion is as far back as it goes.
    cleanup();
    renderAt('/recap/2026-09-07');
    expect(within(switcher()).getByText('7–13 сентября')).toBeTruthy();
    await screen.findByText('Лучшее за неделю');
    expect(screen.getByRole('button', { name: 'Предыдущая неделя' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }));
    expect(path).toBe('/recap/2026-09-14');
    expect(screen.getByRole('button', { name: 'Предыдущая неделя' }).hasAttribute('disabled')).toBe(false);
  });

  it('says plainly that a week had no completions, and clamps a week in the future', async () => {
    await seed();
    renderAt('/recap/2026-09-01');
    expect(await screen.findByText('В эту неделю отметок нет')).toBeTruthy();
    cleanup();
    renderAt('/recap/2026-12-01');
    expect(within(switcher()).getByText('21–27 сентября')).toBeTruthy();
    expect(within(switcher()).getByText('Неделя ещё идёт')).toBeTruthy();
  });

  it('lists the achievements of the week, each opening its place on the tab', async () => {
    const skillId = await createSkill({
      name: 'Чтение',
      description: '',
      startLabel: '',
      targetLabel: '',
      milestoneName: 'Веха',
      milestoneTarget: 10,
      capacityBase: 100,
      capacityIncrement: 0,
      manualCapacities: [],
    });
    await completeStep(await createStep({ skillId, name: 'Глава', points: 5 }));
    renderAt('/recap/2026-09-21');
    const chip = (await screen.findByText('Первое действие')).closest('a')!;
    expect(chip.getAttribute('href')).toBe('/achievements?focus=first-step');
  });
});

describe('Entry points', () => {
  it('shows «Итоги недели» on home for the previous week, when it had a completion', async () => {
    await seed();
    renderAt('/skills');
    const label = await screen.findByText(/^Итоги недели · 14–/);
    // The range never breaks inside «20 сентября».
    expect(label.textContent).toBe('Итоги недели · 14–\u206020\u00a0сентября');
    const tile = label.closest('a')!;
    expect(tile.getAttribute('href')).toBe('/recap');
    expect(tile.textContent).toContain('40\u00a0очков · 3\u00a0активных дня');
  });

  it('has no home row after a week without completions', async () => {
    const skillId = await createSkill({
      name: 'Чтение',
      description: '',
      startLabel: '',
      targetLabel: '',
      milestoneName: 'Веха',
      milestoneTarget: 10,
      capacityBase: 100,
      capacityIncrement: 0,
      manualCapacities: [],
    });
    await completeStep(await createStep({ skillId, name: 'Глава', points: 5 }));
    renderAt('/skills');
    await screen.findByText('Чтение');
    expect(screen.queryByText(/^Итоги недели/)).toBeNull();
  });

  it('lists the records on «Ачивки», each opening its week or its skill', async () => {
    const { skillId, stepId } = await seed();
    await completeStep(stepId, { date: '2026-09-23' });
    renderAt('/achievements');
    const section = (await screen.findByRole('heading', { name: 'Рекорды' })).closest('section')!;
    const row = (title: string) => within(section).getByText(title).closest('a')!;
    expect(row('Лучший день').getAttribute('href')).toBe('/recap/2026-09-14');
    expect(within(row('Лучший день')).getByText('20 очков')).toBeTruthy();
    expect(row('Лучшая неделя').getAttribute('href')).toBe('/recap/2026-09-14');
    // 22nd and 23rd in a row.
    expect(within(row('Лучшая серия')).getByText('2 дня подряд')).toBeTruthy();
    expect(row('Самая быстрая колба').getAttribute('href')).toBe(`/skills/${skillId}`);
    // No timed action: no «Самое длинное занятие».
    expect(within(section).queryByText('Самое длинное занятие')).toBeNull();
  });
});
