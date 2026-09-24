// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../data/db';
import { setClock } from '../../lib/clock';
import { completeStep } from '../../services/completions';
import { archiveSkill } from '../../services/lifecycle';
import { completeSkill, createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { createMark } from '../../services/marks';
import { addDays, localDate } from '../../lib/dates';
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

  it('keeps deleting in the form for an active skill, reached through the ⋯ menu', async () => {
    const id = await createSkill(input);
    renderSkill(id);
    fireEvent.click(await screen.findByRole('button', { name: 'Меню навыка' }));
    const menu = await screen.findByRole('dialog');
    expect(within(menu).getByRole('button', { name: 'Изменить навык' })).toBeTruthy();
    expect(within(menu).getByRole('button', { name: 'Добавить засечку' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Удалить навык' })).toBeNull();
  });
});

describe('SkillScreen marks', () => {
  /** 10-point flasks: 3 completions of 3 put 9 points into flask 1. */
  async function skillWithProgress() {
    const id = await createSkill(input);
    const step = await createStep({ skillId: id, name: 'Разговор', points: 3 });
    for (let i = 0; i < 3; i++) await completeStep(step);
    return id;
  }

  it('invites the first mark and creates one from the sheet', async () => {
    const id = await skillWithProgress();
    renderSkill(id);
    expect(await screen.findByText('Отмечайте важные события на пути: экзамен, конкурс, новый проект.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить засечку' }));
    const sheet = await screen.findByRole('dialog', { name: 'Новая засечка' });
    // An empty title is refused inline, nothing is written.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    expect(await within(sheet).findByText('Укажите название засечки')).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText('Название'), { target: { value: 'Пробный тест' } });
    fireEvent.change(within(sheet).getByLabelText('Описание'), { target: { value: '72 из 100' } });
    expect((within(sheet).getByLabelText('Дата') as HTMLInputElement).value).toBe(localDate());
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Засечка добавлена')).toBeTruthy();
    const mark = (await db.marks.toArray())[0]!;
    expect(mark).toMatchObject({ title: 'Пробный тест', description: '72 из 100', flaskNumber: 1, pointsInFlask: 9 });

    // The list row, the caption on the flask and the history row.
    expect(await screen.findByRole('button', { name: /Пробный тест.*Колба 1/ })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Засечка: Пробный тест' })).toBeTruthy();
    expect(await screen.findByText('Колба 1 · 9 очков')).toBeTruthy();
  });

  it('keeps a brand-new skill to its first action: no invitation until there is one', async () => {
    const id = await createSkill(input);
    renderSkill(id);
    await screen.findByRole('button', { name: 'Меню навыка' });
    expect(screen.queryByText('Засечки')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Меню навыка' }));
    const menu = await screen.findByRole('dialog');
    expect(within(menu).getByRole('button', { name: 'Добавить засечку' })).toBeTruthy();
  });

  it('shows a mark, edits it and deletes it after a confirmation', async () => {
    const id = await skillWithProgress();
    const markId = await createMark(id, { title: 'Экзамен', description: 'Устная часть', date: addDays(localDate(), -1) });
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    renderSkill(id);

    fireEvent.click(await screen.findByRole('button', { name: 'Засечка: Экзамен' }));
    let sheet = await screen.findByRole('dialog', { name: 'Экзамен' });
    expect(within(sheet).getByText('Колба 1, 9 из 10 очков')).toBeTruthy();
    expect(within(sheet).getByText('Устная часть')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Изменить' }));
    sheet = await screen.findByRole('dialog', { name: 'Изменить засечку' });
    const title = within(sheet).getByLabelText('Название') as HTMLInputElement;
    expect(title.value).toBe('Экзамен');
    fireEvent.change(title, { target: { value: 'Экзамен B2' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Засечка сохранена')).toBeTruthy();
    await waitFor(async () => expect((await db.marks.get(markId))?.title).toBe('Экзамен B2'));

    fireEvent.click(await screen.findByRole('button', { name: /Экзамен B2.*Колба 1/ }));
    sheet = await screen.findByRole('dialog', { name: 'Экзамен B2' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Засечка удалена')).toBeTruthy();
    expect(confirm).toHaveBeenCalledWith('Удалить засечку «Экзамен B2»?');
    expect(await db.marks.count()).toBe(0);
  });

  it('captions at most four marks of the current flask; the list has them all', async () => {
    const id = await skillWithProgress();
    for (const title of ['Первая', 'Вторая', 'Третья', 'Четвёртая', 'Пятая']) await createMark(id, { title });
    // A mark of another flask is listed but not drawn on this one.
    const step = await createStep({ skillId: id, name: 'Чтение', points: 5 });
    await completeStep(step); // 14 points: flask 2 now
    await createMark(id, { title: 'Во второй' });
    renderSkill(id);
    await screen.findByRole('button', { name: /Во второй.*Колба 2/ });
    expect(screen.getAllByRole('button', { name: /^Засечка: / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Засечка: Во второй']);
    expect(document.querySelectorAll('.mark-row')).toHaveLength(6);
    cleanup();

    const other = await skillWithProgress();
    for (const title of ['Первая', 'Вторая', 'Третья', 'Четвёртая', 'Пятая']) await createMark(other, { title });
    const { container } = renderSkill(other);
    await screen.findByRole('button', { name: /Пятая.*Колба 1/ });
    // Five ticks, four captions: the newest ones.
    expect(container.querySelectorAll('.flask-mark')).toHaveLength(5);
    expect(screen.getAllByRole('button', { name: /^Засечка: / }).map((b) => b.textContent)).toEqual(['Вторая', 'Третья', 'Четвёртая', 'Пятая']);
  });

  it('lists the marks of a completed skill read-only, without the invitation', async () => {
    const id = await createSkill(input);
    const step = await createStep({ skillId: id, name: 'Разговор', points: 10 });
    await completeStep(step);
    await createMark(id, { title: 'Финал' });
    await completeSkill(id);
    renderSkill(id);
    fireEvent.click(await screen.findByRole('button', { name: /Финал.*Колба 2/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Финал' });
    expect(within(sheet).queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Удалить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить засечку' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Меню навыка' })).toBeNull();
  });
});
