// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../../lib/clock';
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
    expect(screen.getByText('Достигнутые вехи появятся здесь').closest('a')?.getAttribute('href')).toBe('/achievements');
    expect(document.querySelector('.dashed-card')?.getAttribute('href')).toBe('/skills/new');
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
    expect(screen.getByText(/^Последняя веха: Цель · Английский · /)).toBeTruthy();

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
