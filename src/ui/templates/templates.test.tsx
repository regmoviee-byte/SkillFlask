// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../data/db';
import { setClock } from '../../lib/clock';
import { installFakeTelegram, type FakeTelegram } from '../../test/fakeTelegram';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { standInTheme } from '../../test/standInTheme';
import { ToastProvider } from '../components/Toast';
import { PROGRESS_THEME_KEYS } from '../progress/contract';
import { registerTheme } from '../progress/registry';
import { SkillFormScreen } from '../screens/SkillFormScreen';
import { SkillScreen } from '../screens/SkillScreen';
import { SkillsScreen } from '../screens/SkillsScreen';
import { clearDrafts } from './drafts';
import { TemplateChooserRoute } from './lazy';

// The skill templates on the real screens (v0.5 package 16): the first run's empty state, the
// chooser, the prefilled form with «Действия из шаблона» and the skill it creates. The themes are
// stand-ins (src/test/standInTheme.tsx), so the minis do not load thirteen theme chunks.

installFreshDb();
let unregister: (() => void)[] = [];
let fake: FakeTelegram | undefined;
beforeEach(() => {
  setClock(tickingClock(todayNoon()));
  unregister = PROGRESS_THEME_KEYS.map((key) => registerTheme(standInTheme(key)));
});
afterEach(() => {
  cleanup();
  unregister.forEach((u) => u());
  fake?.uninstall();
  fake = undefined;
  clearDrafts();
});

let location = '';
function Where() {
  const { pathname, search } = useLocation();
  location = pathname + search;
  return null;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={['/skills', entry]} initialIndex={1}>
      <ToastProvider>
        <Routes>
          <Route path="/skills" element={<SkillsScreen />} />
          <Route path="/skills/new" element={<TemplateChooserRoute />} />
          <Route path="/skills/new/:templateKey" element={<SkillFormScreen />} />
          <Route path="/skills/:skillId" element={<SkillScreen />} />
        </Routes>
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const chooser = async () => screen.findByRole('list', { name: 'Шаблоны навыков' });
const card = async (name: string) => within(await chooser()).getByRole('link', { name: new RegExp(`^${name}`) });
const actionsSection = async () => (await screen.findByRole('heading', { name: 'Действия из шаблона' })).closest('section')!;
const checkbox = (section: HTMLElement, name: string) => within(section).getByRole('checkbox', { name: new RegExp(`^${name}`) }) as HTMLInputElement;
const field = (label: string) => (screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement).value;

describe('a new skill from a template', () => {
  it('goes from the first run through the chooser and the prefilled form to the skill with its actions', async () => {
    renderAt('/skills');
    fireEvent.click(await screen.findByRole('link', { name: 'Все шаблоны' }));
    // «Свой навык» first, then the twelve templates with their theme's mini at 40 % in their colour.
    const list = await chooser();
    const cards = within(list).getAllByRole('link');
    expect(cards).toHaveLength(13);
    expect(cards[0]!.textContent).toContain('Свой навык');
    const running = await card('Бег');
    expect(running.querySelector('[data-testid="car-mini"]')?.getAttribute('data-fill')).toBe('0.40');
    expect(running.closest('[data-liquid-color]')?.getAttribute('data-liquid-color')).toBe('sky');
    fireEvent.click(running);

    // The form, prefilled: name, labels, milestone, capacities, theme and colour.
    const section = await actionsSection();
    expect(location).toBe('/skills/new/running');
    expect(field('Название')).toBe('Бег');
    expect(field('Сейчас')).toBe('5 км');
    expect(field('Цель')).toBe('10 км');
    expect(screen.getByText(/^Веха: 8 поездок · 100 · 115 · 130 · … · 205/)).toBeTruthy();
    expect((within(screen.getByRole('group', { name: 'Образ' })).getByRole('radio', { name: /^Машинка\./ }) as HTMLInputElement).checked).toBe(true);
    expect((within(screen.getByRole('group', { name: 'Цвет' })).getByRole('radio', { name: 'Голубой' }) as HTMLInputElement).checked).toBe(true);
    // The actions, all on, with what they bring as planned in the theme's words.
    expect(within(section).getAllByRole('checkbox').map((c) => [(c as HTMLInputElement).checked, c.closest('li')!.querySelector('.template-action-name')!.textContent])).toEqual([
      [true, 'Пробежка'],
      [true, 'Растяжка после бега'],
      [true, 'Длинная пробежка'],
    ]);
    expect(section.querySelector('.template-actions-plan')!.textContent!.replace(/\u00a0/g, ' ')).toMatch(/^По плану поездка 1 завершится примерно за \d+ дней, веха — примерно за 3 месяца$/);

    // One action off; another edited through the step form's own fields in a sheet.
    fireEvent.click(checkbox(section, 'Растяжка после бега'));
    expect(checkbox(section, 'Растяжка после бега').checked).toBe(false);
    fireEvent.click(within(section).getByRole('button', { name: 'Изменить: Пробежка' }));
    const sheet = await screen.findByRole('dialog', { name: 'Действие' });
    expect((within(sheet).getByLabelText('Название') as HTMLInputElement).value).toBe('Пробежка');
    expect((within(sheet).getByLabelText('Очков за минуту') as HTMLInputElement).value).toBe('0,5');
    // The estimate compares against the capacities typed in the form: 100 for level 1.
    expect(within(sheet).getByText(/≈ 7 выполнений до\s+поездки\s+1/)).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText('Очков за минуту'), { target: { value: '1' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Действие' })).toBeNull());
    expect(checkbox(section, 'Пробежка').closest('li')!.textContent).toContain('1/мин · 30 мин · 3 раза в неделю');

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Создать навык' })));
    // The skill screen with its actions; the history replaced the form (and the chooser).
    await screen.findByRole('img', { name: /^Поездка 1/ });
    const skill = (await db.skills.toArray())[0]!;
    expect(location).toBe(`/skills/${skill.id}`);
    expect(skill).toMatchObject({ name: 'Бег', startLabel: '5 км', targetLabel: '10 км', capacityBase: 100, capacityIncrement: 15, theme: 'car', color: 'sky' });
    const steps = (await db.steps.toArray()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    expect(steps.map((s) => [s.name, s.pointsPerMinute, s.defaultMinutes, s.schedule])).toEqual([
      ['Пробежка', 1, 30, { kind: 'TIMES_PER_WEEK', times: 3 }],
      ['Длинная пробежка', 0.5, 60, { kind: 'WEEKDAYS', days: [6] }],
    ]);
    expect(await screen.findByText('Длинная пробежка')).toBeTruthy();
  });

  it('keeps a sheet’s invalid edit out of the list', async () => {
    renderAt('/skills/new/reading');
    const section = await actionsSection();
    fireEvent.click(within(section).getByRole('button', { name: 'Изменить: Чтение' }));
    const sheet = await screen.findByRole('dialog', { name: 'Действие' });
    fireEvent.change(within(sheet).getByLabelText('Название'), { target: { value: '  ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Готово' }));
    expect(await within(sheet).findByText('Укажите название действия')).toBeTruthy();
    expect(checkbox(section, 'Чтение')).toBeTruthy();
  });

  it('says so when no action is checked, and creates the skill without actions', async () => {
    renderAt('/skills/new/chess');
    const section = await actionsSection();
    for (const name of ['Шахматные задачи', 'Партия', 'Теория дебютов']) fireEvent.click(checkbox(section, name));
    expect(within(section).getByText('Навык создастся без действий — их можно добавить потом')).toBeTruthy();
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Создать навык' })));
    await waitFor(async () => expect(await db.skills.count()).toBe(1));
    expect(await db.steps.count()).toBe(0);
  });

  it('opens the empty form for «Свой навык», and «Назад» returns to the chooser with the card marked', async () => {
    renderAt('/skills/new');
    fireEvent.click(await card('Свой навык'));
    await screen.findByRole('heading', { name: 'Оформление' });
    expect(location).toBe('/skills/new/custom');
    expect(field('Название')).toBe('');
    expect(screen.queryByRole('heading', { name: 'Действия из шаблона' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    const marked = await card('Свой навык');
    expect(location).toBe('/skills/new?chosen=custom');
    expect(marked.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(marked);

    fireEvent.click(await card('Шахматы'));
    await actionsSection();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect((await card('Шахматы')).getAttribute('aria-current')).toBe('true');
    expect((await card('Свой навык')).getAttribute('aria-current')).toBeNull();
    // The chooser's own «Назад» goes home.
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByText('Первый навык')).toBeTruthy();
  });

  it('brings the form’s edits back when the same card is chosen again, and starts afresh from a new «Новый навык»', async () => {
    renderAt('/skills/new');
    fireEvent.click(await card('Бег'));
    let section = await actionsSection();
    fireEvent.click(checkbox(section, 'Растяжка после бега'));
    fireEvent.change(screen.getByLabelText('Цель', { selector: 'input' }), { target: { value: '21 км' } });
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));

    // Another card is its own template; «Бег» again is the form as the owner left it.
    fireEvent.click(await card('Шахматы'));
    section = await actionsSection();
    expect(within(section).getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(await card('Бег'));
    section = await actionsSection();
    expect(field('Цель')).toBe('21 км');
    expect(checkbox(section, 'Растяжка после бега').checked).toBe(false);
    expect(checkbox(section, 'Пробежка').checked).toBe(true);

    // Home and «Новый навык» again: the template as it is.
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    await card('Бег');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Все шаблоны' }));
    fireEvent.click(await card('Бег'));
    section = await actionsSection();
    expect(field('Цель')).toBe('10 км');
    expect(checkbox(section, 'Растяжка после бега').checked).toBe(true);
  });

  it('sends an unknown template back to the chooser', async () => {
    renderAt('/skills/new/juggling');
    await chooser();
    expect(location).toBe('/skills/new');
  });

  it('uses the Telegram buttons like the other forms: MainButton creates, the sheet takes it over, BackButton returns', async () => {
    fake = installFakeTelegram('7.10');
    const mainTexts = () => fake!.calls.filter((call) => call.startsWith('MainButton.setParams')).map((call) => /"text":"([^"]*)"/.exec(call)?.[1]);
    renderAt('/skills/new/meditation');
    const section = await actionsSection();
    await waitFor(() => expect(mainTexts().at(-1)).toBe('Создать навык'));
    fireEvent.click(within(section).getByRole('button', { name: 'Изменить: Медитация' }));
    const sheet = await screen.findByRole('dialog', { name: 'Действие' });
    // The sheet's «Готово» is the MainButton: no HTML button in it.
    await waitFor(() => expect(mainTexts().at(-1)).toBe('Готово'));
    expect(within(sheet).queryByRole('button', { name: 'Готово' })).toBeNull();
    fireEvent.change(within(sheet).getByLabelText('Название'), { target: { value: 'Тишина' } });
    await waitFor(() => expect(mainTexts().at(-1)).toBe('Готово'));
    act(() => fake!.click('MainButton'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Действие' })).toBeNull());
    expect(checkbox(section, 'Тишина').checked).toBe(true);
    await waitFor(() => expect(mainTexts().at(-1)).toBe('Создать навык'));
    // Telegram's BackButton returns to the chooser, the card marked.
    act(() => fake!.click('BackButton'));
    expect((await card('Медитация')).getAttribute('aria-current')).toBe('true');
    expect(await db.skills.count()).toBe(0);
  });
});
