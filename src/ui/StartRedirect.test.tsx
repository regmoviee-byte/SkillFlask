// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { resetLaunchStartLink, skillStartParam } from '../platform/deeplink';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
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
let fake: FakeTelegram | undefined;
afterEach(() => {
  cleanup();
  fake?.uninstall();
  fake = undefined;
  resetLaunchStartLink();
  sessionStorage.clear();
});

/** Renders `entries` with the app's entry routes and resolves with the screen it landed on. */
async function landing(entry: string | string[] = '/'): Promise<string> {
  const entries = Array.isArray(entry) ? entry : [entry];
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>
        <Route path="/" element={<StartRedirect />} />
        <Route path="/today" element={<p>today</p>} />
        <Route path="/skills" element={<p>skills</p>} />
        <Route path="/recap" element={<p>recap</p>} />
        <Route path="/skills/:skillId" element={<p>skill</p>} />
        <Route path="/skills/:skillId/add" element={<p>add</p>} />
        <Route path="/skills/new" element={<p>chooser</p>} />
        <Route path="/skills/new/:templateKey" element={<Template />} />
        <Route path="*" element={<StartRedirect />} />
      </Routes>
    </MemoryRouter>,
  );
  return (await screen.findByText(/^(today|skills|recap|skill|add|chooser|template \w+)$/)).textContent!;
}

function Template() {
  return <p>template {useParams().templateKey}</p>;
}

/** A Telegram launch opened by `startapp=<param>`. */
function launchWith(param: string | null, hash = 'h1') {
  resetLaunchStartLink();
  fake?.uninstall();
  fake = installFakeTelegram('8.0', { initData: `auth_date=1&hash=${hash}`, initDataUnsafe: param ? { start_param: param } : {} } as never);
}

const launch = '/tgWebAppData=query_id%3DAA&tgWebAppVersion=8.0&tgWebAppPlatform=ios';

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

  describe('launch links (startapp)', () => {
    it('opens the linked skill, or its «Задним числом» with add_', async () => {
      const skillId = await createSkill(input);
      launchWith(skillStartParam(skillId));
      expect(await landing(launch)).toBe('skill');
      cleanup();
      launchWith(skillStartParam(skillId, true), 'h2');
      expect(await landing(launch)).toBe('add');
    });

    it('opens the linked screen', async () => {
      launchWith('recap');
      expect(await landing(launch)).toBe('recap');
    });

    it('opens the template chooser, or the form of a template, on an empty database too', async () => {
      launchWith('new');
      expect(await landing(launch)).toBe('chooser');
      cleanup();
      launchWith('new_running', 'h2');
      expect(await landing(launch)).toBe('template running');
      cleanup();
      // An unknown template decides as usual.
      launchWith('new_custom', 'h3');
      expect(await landing(launch)).toBe('skills');
    });

    it('a skill that is not on this device, or a malformed link, decides as usual', async () => {
      const skillId = await createSkill(input);
      await createStep({ skillId, name: 'Чтение', points: 1 });
      launchWith(skillStartParam(crypto.randomUUID()));
      expect(await landing(launch)).toBe('today');
      cleanup();
      launchWith('skill_../../settings', 'h2');
      expect(await landing(launch)).toBe('today');
      cleanup();
      launchWith('nonsense', 'h3');
      expect(await landing(launch)).toBe('today');
      // Names every object inherits (`?startapp=hasOwnProperty` in any chat) are no screen either.
      for (const [i, param] of ['hasOwnProperty', 'constructor', '__proto__', 'toString'].entries()) {
        cleanup();
        launchWith(param, `p${i}`);
        expect(await landing(launch), param).toBe('today');
      }
    });

    it('«Задним числом» of an archived skill opens the skill instead', async () => {
      const skillId = await createSkill(input);
      await archiveSkill(skillId);
      launchWith(skillStartParam(skillId, true));
      expect(await landing(launch)).toBe('skill');
    });

    it('only the first route of a launch follows it: not a later visit of `/`, not a reload', async () => {
      const skillId = await createSkill(input);
      launchWith(skillStartParam(skillId));
      // `/` reached by navigation (not the router's initial entry).
      expect(await landing(['/skills', '/'])).toBe('skills');
      cleanup();
      expect(await landing(launch)).toBe('skill');
      cleanup();
      // The same launch reloaded: a new document, the link already followed.
      resetLaunchStartLink();
      expect(await landing(launch)).toBe('skills');
    });
  });
});
