// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveSkill } from '../services/lifecycle';
import { createSkill, type SkillInput } from '../services/skills';
import { createStep, setStepActive } from '../services/steps';
import { installFreshDb } from '../test/harness';
import { StartRedirect } from './StartRedirect';

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
afterEach(cleanup);

/** Renders `entry` with the app's entry routes and resolves with the screen it landed on. */
async function landing(entry = '/'): Promise<string> {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<StartRedirect />} />
        <Route path="/today" element={<p>today</p>} />
        <Route path="/skills" element={<p>skills</p>} />
        <Route path="*" element={<StartRedirect />} />
      </Routes>
    </MemoryRouter>,
  );
  return (await screen.findByText(/^(today|skills)$/)).textContent!;
}

describe('StartRedirect', () => {
  it('opens the skills on an empty database', async () => {
    expect(await landing()).toBe('skills');
  });

  it('opens the skills while no skill has an action yet', async () => {
    await createSkill(input);
    expect(await landing()).toBe('skills');
  });

  it('opens «Сегодня» once an active skill has an action', async () => {
    const skillId = await createSkill(input);
    await createStep({ skillId, name: 'Чтение', points: 1 });
    expect(await landing()).toBe('today');
  });

  it('decides the same way for a Telegram launch hash', async () => {
    // HashRouter reads `#tgWebAppData=…` as an unknown path; it must not skip the decision.
    const launch = '/tgWebAppData=query_id%3DAA&tgWebAppVersion=7.10&tgWebAppPlatform=ios';
    expect(await landing(launch)).toBe('skills');
    cleanup();
    const skillId = await createSkill(input);
    await createStep({ skillId, name: 'Чтение', points: 1 });
    expect(await landing(launch)).toBe('today');
  });

  it('ignores hidden actions and archived skills', async () => {
    const skillId = await createSkill(input);
    const step = await createStep({ skillId, name: 'Чтение', points: 1 });
    await setStepActive(step, false);
    expect(await landing()).toBe('skills');
    cleanup();
    await setStepActive(step, true);
    await archiveSkill(skillId);
    expect(await landing()).toBe('skills');
  });
});
