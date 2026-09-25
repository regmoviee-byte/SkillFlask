// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../data/db';
import { setClock } from '../../lib/clock';
import { createSkill, type SkillInput } from '../../services/skills';
import { createStep, getStep } from '../../services/steps';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { DialogHost } from '../components/DialogHost';
import { ToastProvider } from '../components/Toast';
import { StepFormScreen } from './StepFormScreen';

const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 2,
  capacityBase: 100,
  capacityIncrement: 0,
  manualCapacities: [],
};

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));
afterEach(cleanup);

function renderForm(path: string) {
  return render(
    <MemoryRouter initialEntries={['/skills/x', path]} initialIndex={1}>
      <ToastProvider>
        <Routes>
          <Route path="/skills/:skillId" element={<p>skill</p>} />
          <Route path="/steps/new" element={<StepFormScreen />} />
          <Route path="/steps/:stepId/edit" element={<StepFormScreen />} />
        </Routes>
        <DialogHost />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function submit() {
  const button = screen.getByRole('button', { name: /^(Создать действие|Сохранить)$/ }) as HTMLButtonElement;
  // Enabled once the skill list has loaded.
  await waitFor(() => expect(button.disabled).toBe(false));
  await act(async () => void fireEvent.click(button));
}

describe('StepFormScreen', () => {
  it('creates a timed step with a comma rate, usual minutes and weekdays', async () => {
    const skillId = await createSkill(input);
    renderForm(`/steps/new?skill=${skillId}`);
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Практика' } });
    const type = screen.getByRole('group', { name: 'Тип' });
    fireEvent.click(within(type).getByRole('button', { name: 'По времени' }));
    expect(within(type).getByRole('button', { name: 'По времени' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Очки за выполнение')).toBeNull();

    fireEvent.change(screen.getByLabelText('Очков за минуту'), { target: { value: '0,5' } });
    // Without usual minutes the preview assumes 30.
    expect(screen.getByText('30 мин → 15 очков')).toBeTruthy();
    const presets = screen.getByRole('group', { name: 'Частые значения' });
    fireEvent.click(within(presets).getByRole('button', { name: '45 мин' }));
    expect(screen.getByText('45 мин → 22,5 очка')).toBeTruthy();
    expect(await screen.findByText(/≈ 5 выполнений до колбы 1 · веха через ≈ 9/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Когда показывать на «Сегодня»'), { target: { value: 'WEEKDAYS' } });
    const days = screen.getByRole('group', { name: 'Дни недели' });
    expect(within(days).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['Пн', 'Ср', 'Пт']);
    fireEvent.click(within(days).getByRole('button', { name: 'Среда' }));
    fireEvent.click(within(days).getByRole('button', { name: 'Суббота' }));
    expect(screen.getByText('Появится в «Осталось» в эти дни. День без отметки ничего не отнимает.')).toBeTruthy();
    await submit();

    await screen.findByText('skill');
    const [step] = await db.steps.toArray();
    expect(step).toMatchObject({ name: 'Практика', type: 'TIMED', points: 0, pointsPerMinute: 0.5, defaultMinutes: 45, schedule: { kind: 'WEEKDAYS', days: [1, 5, 6] } });
  });

  it('accepts a dot in the rate, warns about a rate that rounds a minute to 0, and shows quota hints', async () => {
    const skillId = await createSkill(input);
    renderForm(`/steps/new?skill=${skillId}&name=${encodeURIComponent('Растяжка')}`);
    fireEvent.click(await screen.findByRole('button', { name: 'По времени' }));
    fireEvent.change(screen.getByLabelText('Очков за минуту'), { target: { value: '0.04' } });
    expect(screen.getByText('При одной минуте очки округлятся до 0')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Очков за минуту'), { target: { value: '0.25' } });
    expect(screen.queryByText('При одной минуте очки округлятся до 0')).toBeNull();

    fireEvent.change(screen.getByLabelText('Когда показывать на «Сегодня»'), { target: { value: 'TIMES_PER_WEEK' } });
    expect(screen.getByText('Покажем на экране «Сегодня» каждый день, пока не наберётся 3. Пропуски ничего не отнимают.')).toBeTruthy();
    const times = screen.getByLabelText('Сколько раз в неделю').closest('.stepper-field') as HTMLElement;
    fireEvent.click(within(times).getByRole('button', { name: 'Больше' }));
    fireEvent.change(screen.getByLabelText('Когда показывать на «Сегодня»'), { target: { value: 'TIMES_PER_MONTH' } });
    expect((screen.getByLabelText('Сколько раз в месяц') as HTMLInputElement).value).toBe('4');
    await submit();
    await screen.findByText('skill');
    expect((await db.steps.toArray())[0]).toMatchObject({ pointsPerMinute: 0.25, defaultMinutes: null, schedule: { kind: 'TIMES_PER_MONTH', times: 4 } });
  });

  it('shows the service message for a rate with three decimals', async () => {
    const skillId = await createSkill(input);
    renderForm(`/steps/new?skill=${skillId}&name=X`);
    fireEvent.click(await screen.findByRole('button', { name: 'По времени' }));
    fireEvent.change(screen.getByLabelText('Очков за минуту'), { target: { value: '0,125' } });
    await submit();
    expect(await screen.findByText('Очков за минуту: число с не более чем двумя знаками после запятой, например 0,25')).toBeTruthy();
    expect(await db.steps.count()).toBe(0);
  });

  it('keeps the type fixed when editing and saves a new schedule', async () => {
    const skillId = await createSkill(input);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 5 });
    renderForm(`/steps/${stepId}/edit`);
    const timedButton = await screen.findByRole('button', { name: 'По времени' });
    expect((timedButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Тип действия нельзя изменить; создайте новое действие')).toBeTruthy();
    expect((screen.getByLabelText('Очки за выполнение') as HTMLInputElement).value).toBe('5');
    fireEvent.click(screen.getByRole('button', { name: '10' }));
    fireEvent.change(screen.getByLabelText('Когда показывать на «Сегодня»'), { target: { value: 'DAILY' } });
    await submit();
    await screen.findByText('skill');
    expect(await getStep(stepId)).toMatchObject({ type: 'BOOLEAN', points: 10, schedule: { kind: 'DAILY' } });
  });

  it('saves pending edits before «Убрать из списка»', async () => {
    const skillId = await createSkill(input);
    const stepId = await createStep({ skillId, name: 'Чтение', points: 5 });
    renderForm(`/steps/${stepId}/edit`);
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Чтение книг' } });
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Убрать из списка' })));
    const confirm = await screen.findByRole('dialog');
    await act(async () => void fireEvent.click(within(confirm).getByRole('button', { name: 'Убрать' })));
    await waitFor(async () => expect(await getStep(stepId)).toMatchObject({ name: 'Чтение книг', isActive: false }));
  });
});
