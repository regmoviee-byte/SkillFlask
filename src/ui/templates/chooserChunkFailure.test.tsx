// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock } from '../../lib/clock';
import { installFreshDb, tickingClock, todayNoon } from '../../test/harness';
import { ToastProvider } from '../components/Toast';
import { SkillFormScreen } from '../screens/SkillFormScreen';
import { TemplateChooserRoute } from './lazy';

// A chooser chunk that does not load (offline, or a hashed file gone after a deploy): «Новый
// навык» opens the empty form, and the form's «Назад» leads to the skills — not into a loop
// between the missing chooser and the form, which has no tab bar to leave by.

vi.mock('./TemplateChooser', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));
afterEach(cleanup);

let location = '';
function Where() {
  const { pathname, search } = useLocation();
  location = pathname + search;
  return null;
}

describe('a chooser chunk that fails to load', () => {
  it('opens the empty form, and «Назад» goes to the skills', async () => {
    render(
      <MemoryRouter initialEntries={['/skills', '/skills/new']} initialIndex={1}>
        <ToastProvider>
          <Routes>
            <Route path="/skills" element={<p>Навыки</p>} />
            <Route path="/skills/new" element={<TemplateChooserRoute />} />
            <Route path="/skills/new/:templateKey" element={<SkillFormScreen />} />
          </Routes>
          <Where />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Оформление' });
    expect(location).toBe('/skills/new/custom');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByText('Навыки')).toBeTruthy();
    expect(location).toBe('/skills');
  });
});
