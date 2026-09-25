// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../data/db';
import { setClock } from '../../lib/clock';
import { completeStep } from '../../services/completions';
import { createMark } from '../../services/marks';
import { createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { standInTheme } from '../../test/standInTheme';
import { ToastProvider } from '../components/Toast';
import { SkillFormScreen } from '../screens/SkillFormScreen';
import { SkillScreen } from '../screens/SkillScreen';
import { SkillsScreen } from '../screens/SkillsScreen';
import { registerTheme } from './registry';

// The theme engine on the real screens (package 11): the skill screen draws the skill's theme
// through the contract and speaks its nouns, the home card shows its mini in its colour, the
// form and the ⋯ sheet choose them. «Пицца» is a stand-in drawing (src/test/standInTheme.tsx)
// with the pizza's real texts, so these tests do not depend on which theme files ship.

const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 3,
  capacityBase: 10,
  capacityIncrement: 0,
  manualCapacities: [],
};

installFreshDb();
let unregister: () => void = () => {};
beforeEach(() => {
  setClock(tickingClock(todayNoon()));
  unregister = registerTheme(standInTheme('pizza'));
});
afterEach(() => {
  cleanup();
  unregister();
});

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={['/skills', entry]} initialIndex={1}>
      <ToastProvider>
        <Routes>
          <Route path="/skills" element={<SkillsScreen />} />
          <Route path="/skills/new/:templateKey" element={<SkillFormScreen />} />
          <Route path="/skills/:skillId" element={<SkillScreen />} />
          <Route path="/skills/:skillId/edit" element={<SkillFormScreen />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** A pizza skill in coral with 12 points: pizza 1 eaten, 2 of 10 into pizza 2, a mark on it. */
async function pizzaSkill() {
  const id = await createSkill({ ...input, theme: 'pizza', color: 'coral' });
  const step = await createStep({ skillId: id, name: 'Разговор', points: 6 });
  await completeStep(step);
  await completeStep(step);
  await completeStep(step);
  await createMark(id, { title: 'Пробный тест' });
  return id;
}

describe('the skill screen', () => {
  it('draws the skill’s theme through the contract, in its colour, and names its levels in its nouns', async () => {
    const id = await pizzaSkill();
    renderAt(`/skills/${id}`);
    const hero = await screen.findByTestId('pizza-hero');
    expect(hero.dataset).toMatchObject({ fill: '0.80', state: 'active', level: '2', marks: '1' });
    expect(hero.getAttribute('aria-label')).toBe('Пицца 2: 8 из 10, 80%');
    expect(hero.closest('[data-liquid-color]')?.getAttribute('data-liquid-color')).toBe('coral');
    expect(document.querySelector('.flask')).toBeNull();
    expect(screen.getByText('Пицца', { selector: '.hero-eyebrow' })).toBeTruthy();
    expect(screen.getByText('80% · ещё 2 до пиццы 3')).toBeTruthy();
    // The milestone rack: the theme's minis, one per level up to the target.
    const rack = screen.getByRole('img', { name: '1 из 3 пицц' });
    expect(within(rack).getAllByTestId('pizza-mini').map((m) => [m.dataset.fill, m.dataset.level])).toEqual([
      ['1.00', '1'],
      ['0.80', '2'],
      ['0.00', '3'],
    ]);
    // The history and the marks list.
    expect(await screen.findByText('Пицца 1 съедена')).toBeTruthy();
    expect(screen.getByText('Пицца 2', { selector: '.mark-row-flask' })).toBeTruthy();
    expect(screen.getAllByText('Пицца 1: 6/10').length).toBeGreaterThan(0);
  });

  it('draws a stored theme this build cannot draw (a newer release’s) as the flask, in its nouns', async () => {
    const id = await pizzaSkill();
    await db.skills.update(id, { theme: 'comet' as never, color: 'ultramarine' as never });
    renderAt(`/skills/${id}`);
    await screen.findByText('Колба 1 заполнена');
    expect(screen.queryByTestId('pizza-hero')).toBeNull();
    expect(document.querySelector('.flask--hero')).not.toBeNull();
    expect(document.querySelector('[data-liquid-color]')).toBeNull();
  });

  it('changes the appearance from the ⋯ sheet, saved at once', async () => {
    const id = await createSkill(input);
    renderAt(`/skills/${id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Меню навыка' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Оформление' }));
    const sheet = await screen.findByRole('dialog', { name: 'Оформление' });
    // The picker offers every shipped theme; the flask is chosen.
    expect((within(sheet).getByRole('radio', { name: /^Колба\./ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Пицца\./ }));
    expect(await screen.findByText('Оформление сохранено')).toBeTruthy();
    await waitFor(async () => expect(await db.skills.get(id)).toMatchObject({ theme: 'pizza', color: null }));
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Бирюзовый' }));
    await waitFor(async () => expect(await db.skills.get(id)).toMatchObject({ theme: 'pizza', color: 'teal' }));
    // The screen behind follows: the pizza in teal.
    await waitFor(() => expect(document.querySelector('.hero [data-testid="pizza-hero"]')?.closest('[data-liquid-color]')?.getAttribute('data-liquid-color')).toBe('teal'));
  });
});

describe('the home card', () => {
  it('shows the theme’s mini with the level, in the skill’s colour', async () => {
    const id = await pizzaSkill();
    await createSkill({ ...input, name: 'Бег' });
    renderAt('/skills');
    await screen.findByText('Английский', { selector: '.skill-card-name' });
    const card = document.querySelector(`.skill-card[href="/skills/${id}"]`)!;
    const mini = within(card as HTMLElement).getByTestId('pizza-mini');
    expect(card.getAttribute('href')).toBe(`/skills/${id}`);
    expect(card.getAttribute('data-liquid-color')).toBe('coral');
    expect(mini.dataset).toMatchObject({ fill: '0.80', level: '2', state: 'active' });
    expect(within(card as HTMLElement).getByRole('img', { name: 'Пицца 2, 80%' })).toBeTruthy();
    // The other skill keeps the flask and the Telegram accent.
    const other = [...document.querySelectorAll('.skill-card')].find((c) => c.textContent?.includes('Бег'))!;
    expect(other.querySelector('.mini-flask')).not.toBeNull();
    expect(other.hasAttribute('data-liquid-color')).toBe(false);
    // «Пройдено» counts the levels of every skill, drawn in their own themes.
    const tile = screen.getByText('Пройдено').closest('.tile')!;
    expect(within(tile as HTMLElement).getAllByTestId('pizza-mini').map((m) => m.dataset.state)).toEqual(['complete']);
  });
});

describe('the skill form', () => {
  it('creates a skill with the chosen theme and colour; the milestone field follows the theme', async () => {
    renderAt('/skills/new/custom');
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Гитара' } });
    const themes = screen.getByRole('group', { name: 'Образ' });
    expect((within(themes).getByRole('radio', { name: /^Колба\./ }) as HTMLInputElement).checked).toBe(true);
    expect((within(screen.getByRole('group', { name: 'Цвет' })).getByRole('radio', { name: 'Как в теме' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(themes).getByRole('radio', { name: /^Пицца\./ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Цвет' })).getByRole('radio', { name: 'Янтарный' }));
    // The live preview: the chosen theme at 45 % in the chosen colour.
    const preview = screen.getByRole('img', { name: 'Предпросмотр: Пицца, янтарный' });
    expect(preview.dataset.fill).toBe('0.45');
    expect(preview.closest('[data-liquid-color]')?.getAttribute('data-liquid-color')).toBe('amber');
    expect(screen.getByLabelText('Пицц')).toBeTruthy();
    expect(screen.getByText(/^Веха: 10 пицц/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Создать навык' }));
    await waitFor(async () => expect((await db.skills.toArray())[0]).toMatchObject({ name: 'Гитара', theme: 'pizza', color: 'amber' }));
    // The new skill's screen: its pizza, in amber.
    const hero = await screen.findByRole('img', { name: 'Пицца 1: 0 из 100, 0%' });
    expect(hero.closest('[data-liquid-color]')?.getAttribute('data-liquid-color')).toBe('amber');
  });

  it('keeps a stored theme this build cannot draw when only the colour changes', async () => {
    const id = await createSkill(input);
    await db.skills.update(id, { theme: 'comet' as never });
    renderAt(`/skills/${id}/edit`);
    fireEvent.click(within(await screen.findByRole('group', { name: 'Цвет' })).getByRole('radio', { name: 'Янтарный' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect(await db.skills.get(id)).toMatchObject({ theme: 'comet', color: 'amber' }));
  });
});
