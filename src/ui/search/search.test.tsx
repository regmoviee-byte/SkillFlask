// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../../lib/clock';
import { completeStep } from '../../services/completions';
import { createMark } from '../../services/marks';
import { createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { CelebrationProvider } from '../celebrations/CelebrationProvider';
import { ToastProvider } from '../components/Toast';
import { SkillScreen } from '../screens/SkillScreen';
import { SearchRoute } from './lazy';

// «Поиск по истории» (v0.5 package 17): the skill screen's search and the global one.

const input = (name: string): SkillInput => ({
  name,
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 10,
  capacityBase: 100,
  capacityIncrement: 0,
  manualCapacities: [],
});

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));
afterEach(cleanup);

async function setup() {
  const englishId = await createSkill(input('Английский'));
  const talk = await createStep({ skillId: englishId, name: 'Разговор', points: 5 });
  const read = await createStep({ skillId: englishId, name: 'Чтение', points: 3 });
  await completeStep(talk, { note: 'Говорили про путешествия' });
  await completeStep(read, { note: 'Ёжик в тумане' });
  await completeStep(talk);
  await createMark(englishId, { title: 'Пробный тест', description: 'Про путешествия и работу' });
  const guitarId = await createSkill(input('Гитара'));
  const chords = await createStep({ skillId: guitarId, name: 'Аккорды', points: 2 });
  await completeStep(chords, { note: 'Песня про путешествия' });
  return { englishId, guitarId };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={['/skills', path]} initialIndex={1}>
      <ToastProvider>
        <CelebrationProvider>
          <Routes>
            <Route path="/skills" element={<p>home</p>} />
            <Route path="/search" element={<SearchRoute />} />
            <Route path="/skills/:skillId" element={<SkillScreen />} />
          </Routes>
        </CelebrationProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const history = () => screen.findByRole('searchbox', { name: 'Поиск по истории' });
/** The texts inside <mark>, in order. */
const marks = (root: HTMLElement) => [...root.querySelectorAll('mark')].map((m) => m.textContent);

describe('the skill screen’s «Поиск по истории»', () => {
  it('finds by note with the match marked, keeps the day groups and opens the completion', async () => {
    const { englishId } = await setup();
    renderAt(`/skills/${englishId}`);
    const field = await history();
    fireEvent.change(field, { target: { value: 'ежик' } });
    expect(await screen.findByText('Найдено: 1')).toBeTruthy();
    const results = document.querySelector('.search-results') as HTMLElement;
    expect(marks(results)).toEqual(['Ёжик']);
    expect(within(results).getByText('Сегодня')).toBeTruthy();

    fireEvent.click(within(results).getByRole('button', { name: /Чтение/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Чтение' });
    expect((within(sheet).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Ёжик в тумане');
  });

  it('filters with the chips and says so neutrally when nothing is found', async () => {
    const { englishId } = await setup();
    renderAt(`/skills/${englishId}`);
    await history();
    const chips = screen.getByRole('group', { name: 'Что искать' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Все', 'С заметками', 'Засечки']);

    fireEvent.click(within(chips).getByRole('button', { name: 'С заметками' }));
    expect(await screen.findByText('Найдено: 2')).toBeTruthy();
    fireEvent.click(within(chips).getByRole('button', { name: 'Засечки' }));
    expect(await screen.findByText('Найдено: 1')).toBeTruthy();
    expect(within(document.querySelector('.search-results') as HTMLElement).getByText('Пробный тест')).toBeTruthy();

    fireEvent.change(await history(), { target: { value: 'футбол' } });
    expect(await screen.findByText('Ничего не нашлось')).toBeTruthy();
    // «Все» and a cleared field bring the plain history back.
    fireEvent.click(within(chips).getByRole('button', { name: 'Все' }));
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    await waitFor(() => expect(document.querySelector('.search-results')).toBeNull());
    expect(screen.getAllByText('Разговор').length).toBeGreaterThan(0);
  });
});

describe('the global search', () => {
  it('groups the results by skill and opens the completion on its skill', async () => {
    await setup();
    renderAt('/search');
    const field = await screen.findByRole('searchbox', { name: 'Поиск по всем навыкам' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(screen.getByText(/^Ищет в названиях действий, заметках и засечках/)).toBeTruthy();

    fireEvent.change(field, { target: { value: 'путешествия' } });
    expect(await screen.findByText('Найдено: 3')).toBeTruthy();
    const groups = [...document.querySelectorAll('.search-group')] as HTMLElement[];
    // The latest hit first: the guitar's completion was written last.
    expect(groups.map((g) => within(g).getByRole('heading', { level: 2 }).textContent)).toEqual(['Гитара', 'Английский']);
    expect(marks(groups[1]!)).toEqual(['путешествия', 'путешествия']);

    fireEvent.click(within(groups[0]!).getByRole('button', { name: /Аккорды/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Аккорды' });
    expect((within(sheet).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Песня про путешествия');
    expect(screen.getByRole('heading', { name: 'Гитара', level: 1 })).toBeTruthy();
  });

  it('opens a mark on its skill', async () => {
    await setup();
    renderAt('/search?q=пробный');
    expect(await screen.findByText('Найдено: 1')).toBeTruthy();
    fireEvent.click(within(document.querySelector('.search-results') as HTMLElement).getByRole('button', { name: /Пробный тест/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Пробный тест' });
    expect(within(sheet).getByText('Про путешествия и работу')).toBeTruthy();
  });
});
