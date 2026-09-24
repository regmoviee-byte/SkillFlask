// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../../lib/clock';
import { addDays, localDate } from '../../lib/dates';
import { completeStep } from '../../services/completions';
import { archiveSkill } from '../../services/lifecycle';
import { completeSkill, createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { SkillsScreen } from './SkillsScreen';

const input = (name: string, milestoneTarget = 3): SkillInput => ({
  name,
  description: '',
  startLabel: 'B1',
  targetLabel: 'C1',
  milestoneName: 'Цель',
  milestoneTarget,
  capacityBase: 10,
  capacityIncrement: 0,
  manualCapacities: [],
});

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));
afterEach(cleanup);

let search = '';
function Search() {
  search = useLocation().search;
  return null;
}

function renderHome(entry = '/skills') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <SkillsScreen />
        <Search />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const filterGroup = () => screen.queryByRole('group', { name: 'Какие навыки показать' });
const chips = async () => within(await screen.findByRole('group', { name: 'Какие навыки показать' })).getAllByRole('button');
const chip = (name: string) => within(filterGroup()!).getByRole('button', { name });

const cardNames = () => [...document.querySelectorAll('.skill-card .skill-card-name')].map((n) => n.textContent);

describe('SkillsScreen', () => {
  it('starts with one skill and the template example', async () => {
    renderHome();
    expect(await screen.findByText('Первый навык')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Пример: Английский B1 → C1' }).getAttribute('href')).toBe('/skills/new?template=english');
    expect(filterGroup()).toBeNull();
  });

  it('draws the filled flasks so that the picture adds up to the number', async () => {
    const id = await createSkill(input('Английский', 10));
    const step = await createStep({ skillId: id, name: 'Разговор', points: 10 });
    const tileFlasks = async () => {
      const tile = (await screen.findByText('Заполнено')).closest('.tile')!;
      return { drawn: tile.querySelectorAll('.tile-flasks .flask').length, more: tile.querySelector('.tile-flasks-more')?.textContent ?? null };
    };
    for (let i = 0; i < 4; i++) await completeStep(step);
    renderHome();
    expect(await tileFlasks()).toEqual({ drawn: 4, more: null });
    cleanup();
    for (let i = 0; i < 2; i++) await completeStep(step);
    renderHome();
    // Six: three flasks and «+3», never five flasks under «6».
    expect(await tileFlasks()).toEqual({ drawn: 3, more: '+3' });
  });

  it('shows the bento row and the active skills by last activity, without filter chips', async () => {
    const a = await createSkill(input('Английский'));
    const b = await createSkill(input('Бег'));
    await createSkill(input('Гитара'));
    const speak = await createStep({ skillId: a, name: 'Разговор', points: 12 });
    const run = await createStep({ skillId: b, name: 'Пробежка', points: 4 });
    await completeStep(speak);
    await completeStep(run);

    renderHome();
    await screen.findByText('Заполнено');
    // Бег was worked on last, Гитара never.
    expect(cardNames()).toEqual(['Бег', 'Английский', 'Гитара']);
    expect(filterGroup()).toBeNull();
    const english = document.querySelectorAll('.skill-card')[1]!;
    expect(english.textContent).toContain('B1 → C1');
    expect(english.textContent).toContain('2 / 10');
    expect(english.textContent).toContain('+12 сегодня');
    expect(english.querySelectorAll('.milestone-dot')).toHaveLength(3);
    expect(english.querySelectorAll('.milestone-dot.is-done')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Сегодня/ }).getAttribute('href')).toBe('/today');
    // The wide tile: the last achievement — two skills on one day.
    const tile = screen.getByText(/^Последняя ачивка · /).closest('a')!;
    expect(tile.getAttribute('href')).toBe('/achievements');
    expect(tile.textContent).toContain('Два фронта');
    expect(tile.querySelector('.ach-badge.is-unlocked')).toBeTruthy();
    expect(document.querySelector('.dashed-card')?.getAttribute('href')).toBe('/skills/new');
  });

  it('keeps a milestone reached after the last achievement as a caption of the wide tile', async () => {
    const a = await createSkill(input('Английский', 1));
    await completeStep(await createStep({ skillId: a, name: 'Разговор', points: 10 }));
    const b = await createSkill(input('Бег', 1));
    const run = await createStep({ skillId: b, name: 'Пробежка', points: 10 });
    // Another date, so nothing new is earned: only the milestone of «Бег» is newer.
    await completeStep(run, { date: addDays(localDate(), -1) });

    renderHome();
    const tile = (await screen.findByText(/^Последняя ачивка · /)).closest('a')!;
    expect(tile.querySelector('.tile-ach-caption')?.textContent).toMatch(/^Веха «Цель» · Бег · /);
  });

  it('offers only the segments that have skills', async () => {
    const a = await createSkill(input('Английский', 1));
    const speak = await createStep({ skillId: a, name: 'Разговор', points: 10 });
    await completeStep(speak);
    const b = await createSkill(input('Бег'));
    await archiveSkill(b);
    await createSkill(input('Гитара'));

    renderHome();
    const tabs = await chips();
    expect(tabs.map((t) => t.textContent)).toEqual(['Активные', 'Архив']);
    expect(chip('Активные').getAttribute('aria-pressed')).toBe('true');
    expect(cardNames()).toEqual(['Английский', 'Гитара']);
    // The reached milestone of an active skill wears the laurel chip.
    expect(document.querySelector('.skill-card')?.textContent).toContain('веха достигнута');
    // The milestone came with «Вехи · 1» at the same moment: no separate milestone caption.
    const tile = screen.getByText(/^Последняя ачивка · /).closest('a')!;
    expect(tile.textContent).toContain('Вехи · 1');
    expect(tile.querySelector('.tile-ach-caption')).toBeNull();

    fireEvent.click(chip('Архив'));
    expect(cardNames()).toEqual(['Бег']);
    // The segment is kept in the URL, so «Назад» from a card returns to it.
    expect(search).toBe('?filter=archived');
    expect(chip('Архив').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.skill-card')?.textContent).toMatch(/в архиве с \d+ \S+/);
    expect(document.querySelector('.skill-card .liquid-bar')).toBeNull();
    expect(document.querySelector('.dashed-card')).toBeNull();

    cleanup();
    await completeSkill(a);
    renderHome();
    const next = await chips();
    expect(next.map((t) => t.textContent)).toEqual(['Активные', 'Достигнутые', 'Архив']);
    fireEvent.click(chip('Достигнутые'));
    expect(cardNames()).toEqual(['Английский']);
    expect(document.querySelector('.skill-card')?.textContent).toContain('1 колба');
    expect(screen.getByRole('img', { name: 'Навык достигнут: 1 колба' })).toBeTruthy();
  });

  it('offers no filter with a single segment: only completed skills are shown as they are', async () => {
    const a = await createSkill(input('Английский', 1));
    await completeStep(await createStep({ skillId: a, name: 'Разговор', points: 10 }));
    await completeSkill(a);
    renderHome();
    await screen.findByText('Заполнено');
    expect(cardNames()).toEqual(['Английский']);
    expect(filterGroup()).toBeNull();
  });

  it('opens the segment named in the URL and falls back when it is empty', async () => {
    await createSkill(input('Английский'));
    const b = await createSkill(input('Бег'));
    await archiveSkill(b);

    renderHome('/skills?filter=archived');
    await chips();
    expect(cardNames()).toEqual(['Бег']);
    fireEvent.click(chip('Активные'));
    expect(cardNames()).toEqual(['Английский']);
    expect(search).toBe('');

    cleanup();
    // No completed skill: the segment does not exist, the active one is shown.
    renderHome('/skills?filter=completed');
    await chips();
    expect(cardNames()).toEqual(['Английский']);
  });
});
