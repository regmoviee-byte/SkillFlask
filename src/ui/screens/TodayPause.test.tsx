// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../../lib/clock';
import { addDays, formatDate, localDate, weekStart } from '../../lib/dates';
import { cancelCompletion, completeStep } from '../../services/completions';
import { db } from '../../data/db';
import { pauseSkill } from '../../services/pauses';
import { getSetting } from '../../services/settings';
import { createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock, todayNoon, withClock } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { COMPACT_SKILLS, TodayScreen } from './TodayScreen';

// «Сегодня» with pauses and many skills (v0.5 package 18): the paused skill leaves the plan and
// is named once at the end; from five skills «Сделано» folds into a line and «Осталось» goes
// skill by skill with colour dots and «Ещё N».

const input = (name: string): SkillInput => ({
  name,
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 3,
  capacityBase: 1000,
  capacityIncrement: 0,
  manualCapacities: [],
});

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));
afterEach(cleanup);
const monday = () => weekStart(localDate());

function renderToday() {
  return render(
    <MemoryRouter initialEntries={['/today']}>
      <ToastProvider>
        <TodayScreen />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** Skills created on Monday, each with daily actions of 5 points (planned every day of the week). */
async function skillsWithDaily(spec: Record<string, string[]>): Promise<Record<string, string>> {
  return withClock(
    `${monday()}T08:00:00`,
    async () => {
      const ids: Record<string, string> = {};
      for (const [name, steps] of Object.entries(spec)) {
        ids[name] = await createSkill(input(name));
        for (const step of steps) await createStep({ skillId: ids[name], name: step, points: 5, schedule: { kind: 'DAILY' } });
      }
      return ids;
    },
    2000,
  );
}

const rowNames = (section: HTMLElement) => [...section.querySelectorAll('.step-row-name')].map((n) => n.textContent);

describe('«Сегодня» with a skill on pause', () => {
  it('leaves the paused skill out of the plan and names it once at the end, with a link to it', async () => {
    const ids = await skillsWithDaily({ Английский: ['Разговор'], Гитара: ['Аккорды'], Бег: ['Пробежка'] });
    const until = addDays(localDate(), 7);
    await pauseSkill(ids['Гитара']!, until);
    await pauseSkill(ids['Бег']!, null);
    renderToday();
    const remaining = (await screen.findByText('Осталось')).closest('section')!;
    expect(rowNames(remaining)).toEqual(['Разговор']);
    expect(screen.queryByText('Аккорды')).toBeNull();
    expect(screen.getByText('Сделано 0 из 1')).toBeTruthy();
    const line = document.querySelector('.today-paused')!;
    // Oldest skill first, «до …» only for a pause with a last day.
    expect(line.textContent!.replace(/ /g, ' ')).toBe(`На паузе: Гитара до ${formatDate(until)}, Бег`);
    expect(within(line as HTMLElement).getByRole('link', { name: 'Гитара' }).getAttribute('href')).toBe(`/skills/${ids['Гитара']}`);
    expect(document.body.textContent).not.toMatch(/просроч|пропущ|штраф|отста/i);
  });

  it('has no pause line without a pause', async () => {
    await skillsWithDaily({ Английский: ['Разговор'] });
    renderToday();
    await screen.findByText('Осталось');
    expect(document.querySelector('.today-paused')).toBeNull();
  });

  it('says every skill rests when they all do, and still lists what was done', async () => {
    const ids = await skillsWithDaily({ Гитара: ['Аккорды'] });
    await pauseSkill(ids['Гитара']!, null);
    const [step] = await (await import('../../data/db')).db.steps.toArray();
    await completeStep(step!.id);
    renderToday();
    expect(await screen.findByText('Все навыки на паузе')).toBeTruthy();
    // «Пока не сниму» does not end by itself: the text does not promise a return.
    expect(screen.getByText('Снять паузу или отметить действие можно на экране навыка.')).toBeTruthy();
    expect(screen.queryByText('Добавьте первое действие')).toBeNull();
    expect(screen.queryByText('На сегодня ничего не запланировано — отметьте что-нибудь из списка ниже')).toBeNull();
    expect(screen.getByText('Сделано сегодня')).toBeTruthy();
    expect(document.querySelector('.today-paused')!.textContent).toBe('На паузе: Гитара');
  });

  it('promises the return only when every pause has a last day', async () => {
    const ids = await skillsWithDaily({ Гитара: ['Аккорды'], Бег: ['Пробежка'] });
    await pauseSkill(ids['Гитара']!, addDays(localDate(), 3));
    await pauseSkill(ids['Бег']!, addDays(localDate(), 6));
    renderToday();
    expect(await screen.findByText('Они вернутся в план сами. Отметить действие можно и на паузе — на экране навыка.')).toBeTruthy();
  });
});

describe('a busy «Сегодня» (5+ skills)', () => {
  const five = { Гитара: ['Аккорды', 'Гаммы', 'Песня', 'Ритм'], Английский: ['Разговор'], Бег: ['Пробежка'], Чтение: ['Глава'], Йога: ['Растяжка'] };

  it('groups «Осталось» by skill, the busiest first, with colour dots and «Ещё N» for a long skill', async () => {
    expect(Object.keys(five)).toHaveLength(COMPACT_SKILLS);
    await skillsWithDaily(five);
    renderToday();
    const remaining = (await screen.findByText('Осталось')).closest('section')!;
    const names = rowNames(remaining);
    expect(names.slice(0, 3)).toEqual(['Аккорды', 'Гаммы', 'Песня']);
    expect(names).not.toContain('Ритм');
    expect(names).toHaveLength(3 + 4);
    expect(remaining.querySelectorAll('.step-row .step-row-dot')).toHaveLength(7);
    const more = within(remaining).getByRole('button', { name: 'Показать ещё 1 действие: Гитара' });
    expect(more.textContent).toBe('Ещё 1');
    fireEvent.click(more);
    expect(rowNames(remaining).slice(0, 4)).toEqual(['Аккорды', 'Гаммы', 'Песня', 'Ритм']);
    expect(within(remaining).queryByRole('button', { name: /^Показать ещё/ })).toBeNull();
  });

  it('folds «Сделано» into one line, remembered on the device', async () => {
    await skillsWithDaily(five);
    renderToday();
    const remaining = (await screen.findByText('Осталось')).closest('section')!;
    for (const name of ['Разговор', 'Пробежка']) {
      await act(async () => {
        fireEvent.click(within(remaining).getByRole('button', { name: `Отметить: ${name}, +5 очков` }));
      });
    }
    const fold = await waitFor(() => {
      const el = document.querySelector('details.today-done-fold') as HTMLDetailsElement | null;
      expect(el?.querySelector('summary')?.textContent).toBe('Отмечено: 2 · +10 очков');
      return el!;
    });
    expect(fold.open).toBe(false);
    expect(screen.queryByText('Сделано сегодня')).toBeNull();
    // «Ещё» stays folded on a busy day, even with the plan partly done.
    expect((document.querySelector('details.today-more') as HTMLDetailsElement).open).toBe(false);

    await act(async () => {
      fold.open = true;
      fireEvent(fold, new Event('toggle'));
    });
    await waitFor(async () => expect(await getSetting('todayDoneOpen', false)).toBe(true));
    cleanup();
    renderToday();
    await waitFor(() => expect((document.querySelector('details.today-done-fold') as HTMLDetailsElement | null)?.open).toBe(true));
    expect(within(document.querySelector('details.today-done-fold') as HTMLElement).getAllByRole('button', { name: /Английский|Бег/ })).toHaveLength(2);
  });

  it('keeps the plain «Сделано сегодня» when the day’s only completion was cancelled: no «Отмечено: 0»', async () => {
    const ids = await skillsWithDaily(five);
    const step = (await db.steps.where('skillId').equals(ids['Бег']!).first())!;
    const { completionId } = await completeStep(step.id);
    await cancelCompletion(completionId);
    renderToday();
    expect(await screen.findByText('Сделано сегодня')).toBeTruthy();
    expect(document.querySelector('details.today-done-fold')).toBeNull();
    expect(document.body.textContent).not.toContain('Отмечено: 0');
  });

  it('changes nothing for four skills: no dots, «Сделано сегодня» as a section', async () => {
    const { Йога: _yoga, ...four } = five;
    await skillsWithDaily(four);
    renderToday();
    const remaining = (await screen.findByText('Осталось')).closest('section')!;
    expect(rowNames(remaining)).toContain('Ритм');
    expect(remaining.querySelector('.step-row-dot')).toBeNull();
    await act(async () => {
      fireEvent.click(within(remaining).getByRole('button', { name: 'Отметить: Разговор, +5 очков' }));
    });
    expect(await screen.findByText('Сделано сегодня')).toBeTruthy();
    expect(document.querySelector('details.today-done-fold')).toBeNull();
  });

  it('counts only the skills in the plan: a paused sixth one does not make a day busy', async () => {
    const { Йога: _yoga, ...four } = five;
    const ids = await skillsWithDaily({ ...four, Шахматы: ['Задача'] });
    await pauseSkill(ids['Шахматы']!, null);
    renderToday();
    const remaining = (await screen.findByText('Осталось')).closest('section')!;
    expect(remaining.querySelector('.step-row-dot')).toBeNull();
    expect(document.querySelector('.today-paused')!.textContent).toBe('На паузе: Шахматы');
  });
});
