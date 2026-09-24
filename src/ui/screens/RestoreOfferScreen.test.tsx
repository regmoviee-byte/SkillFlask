// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, wipeAllData } from '../../data/backup';
import { db } from '../../data/db';
import { saveBackupToCloud } from '../../platform/cloud';
import { resetCloudBackup } from '../../services/backupSync';
import { getSetting } from '../../services/settings';
import { completeStep } from '../../services/completions';
import { createSkill } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFakeTelegram, type FakeTelegram } from '../../test/fakeTelegram';
import { installFreshDb } from '../../test/harness';
import { DbBoundary } from '../DbBoundary';

installFreshDb();

let fake: FakeTelegram;
beforeEach(() => {
  // 7.0: the MainButton is native, «Начать с чистого листа» stays an HTML button (< 7.10).
  fake = installFakeTelegram('7.0');
});
afterEach(() => {
  cleanup();
  resetCloudBackup();
  fake.uninstall();
});

async function seedCloudCopy({ withCompletion = false } = {}): Promise<void> {
  const skillId = await createSkill({
    name: 'Английский',
    description: '',
    startLabel: '',
    targetLabel: '',
    milestoneName: 'Главная цель',
    milestoneTarget: 3,
    capacityBase: 100,
    capacityIncrement: 50,
    manualCapacities: [],
  });
  if (withCompletion) await completeStep(await createStep({ skillId, name: 'Разговор', points: 5 }));
  await saveBackupToCloud(await exportBackup());
  await wipeAllData();
  db.close();
}

const app = () =>
  render(
    <DbBoundary>
      <p>приложение</p>
    </DbBoundary>,
  );

describe('restore offer on start', () => {
  it('appears on an empty database when the cloud holds a copy, and can be declined', async () => {
    await seedCloudCopy();
    app();
    expect(await screen.findByText(/^Найдена резервная копия от .+: 1 навык, 0 выполнений\. Восстановить\?$/)).toBeTruthy();
    // The native button is configured in an effect that may land after the text is on screen.
    await waitFor(() => expect(fake.calls.some((call) => call.startsWith('MainButton.setParams') && call.includes('Восстановить'))).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Начать с чистого листа' }));
    expect(await screen.findByText('приложение')).toBeTruthy();
    expect(await db.skills.count()).toBe(0);
    expect(await getSetting('restoreOfferShown', false)).toBe(true);
  });

  it('restores through the native main button', async () => {
    await seedCloudCopy();
    app();
    await screen.findByText(/^Найдена резервная копия/);
    fake.click('MainButton');
    expect(await screen.findByText('приложение')).toBeTruthy();
    expect((await db.skills.toArray()).map((s) => s.name)).toEqual(['Английский']);
  });

  it('asks before starting fresh over a copy with history', async () => {
    await seedCloudCopy({ withCompletion: true });
    app();
    await screen.findByText(/1 навык, 1 выполнение\. Восстановить\?$/);
    const answers = ['cancel', 'ok'];
    fake.tg.showPopup = (params, cb) => {
      fake.calls.push(`showPopup(${params.message})`);
      cb?.(answers.shift());
    };
    fireEvent.click(screen.getByRole('button', { name: 'Начать с чистого листа' }));
    await waitFor(() => expect(fake.calls.some((call) => call.startsWith('showPopup(Копия в облаке заменится'))).toBe(true));
    // «Назад»: still on the offer.
    expect(screen.queryByText('приложение')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Начать с чистого листа' }));
    expect(await screen.findByText('приложение')).toBeTruthy();
    expect(await db.skills.count()).toBe(0);
  });

  it('is skipped without a cloud copy', async () => {
    app();
    expect(await screen.findByText('приложение')).toBeTruthy();
  });
});
