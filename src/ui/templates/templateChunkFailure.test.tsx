// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock } from '../../lib/clock';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { SkillFormScreen } from '../screens/SkillFormScreen';

// A template whose chunk does not load (offline, or a hashed file gone after a deploy): the form
// opens empty, and a toast says why instead of leaving a blank form after a tap on «Бег».

vi.mock('./TemplateActions', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));
afterEach(cleanup);

describe('a template chunk that fails to load', () => {
  it('opens the empty form and says the template did not load', async () => {
    render(
      <MemoryRouter initialEntries={['/skills/new/running']}>
        <ToastProvider>
          <Routes>
            <Route path="/skills/new/:templateKey" element={<SkillFormScreen />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Шаблон не загрузился — заполните форму сами или попробуйте ещё раз')).toBeTruthy();
    expect((screen.getByLabelText('Название') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Действия из шаблона')).toBeNull();
  });
});
