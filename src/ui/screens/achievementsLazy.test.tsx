// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getErrors } from '../../platform/errorLog';
import { installFreshDb } from '../../test/harness';
import { AchievementsRoute, prefetchAchievements } from './achievementsLazy';

// The «Ачивки» tab is a lazy chunk (v0.5 package 19). Here the chunk fails to load (a redeploy
// removed the old hashed files): the prefetch stays silent, the tab keeps its header while it
// loads and then says to restart instead of the app-wide «Что-то пошло не так».

vi.mock('./AchievementsScreen', () => {
  throw new Error('Failed to fetch dynamically imported module: AchievementsScreen');
});

installFreshDb();
afterEach(cleanup);

describe('an «Ачивки» chunk that fails to load', () => {
  it('keeps the header, then says to restart, and logs the chunk', async () => {
    // The prefetch fails quietly (vitest fails the run on an unhandled rejection); the route
    // tries again on its own.
    prefetchAchievements();
    render(
      <MemoryRouter>
        <AchievementsRoute />
      </MemoryRouter>,
    );
    // While the chunk loads: the tab's header, nothing under it.
    expect(screen.getByRole('heading', { name: 'Ачивки' })).toBeTruthy();
    expect(await screen.findByText('Не удалось открыть — перезапустите приложение')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ачивки' })).toBeTruthy();
    expect(getErrors().some((entry) => entry.message.includes('chunk AchievementsScreen'))).toBe(true);
  });
});
