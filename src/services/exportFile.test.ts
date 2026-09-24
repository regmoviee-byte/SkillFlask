// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../data/fixtures/backup-v1.json';
import { db } from '../data/db';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import { installFreshDb } from '../test/harness';
import { resetCloudBackup } from './backupSync';
import { backupFileName, exportToFile, fileBackupReminder, importFromFile, parseBackupText } from './exportFile';
import { getSetting } from './settings';
import { createSkill } from './skills';

installFreshDb();

let fake: FakeTelegram | undefined;
const nav = navigator as unknown as Record<string, unknown>;
const urlStatics = URL as unknown as Record<string, unknown>;

beforeEach(async () => {
  await createSkill({
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
});
afterEach(() => {
  fake?.uninstall();
  fake = undefined;
  delete nav.share;
  delete nav.canShare;
  delete nav.clipboard;
  delete urlStatics.createObjectURL;
  delete urlStatics.revokeObjectURL;
  resetCloudBackup();
});

describe('exportToFile', () => {
  it('downloads a dated file in the browser', async () => {
    // jsdom has no object URLs.
    urlStatics.createObjectURL = vi.fn(() => 'blob:backup');
    urlStatics.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await exportToFile()).toEqual({ kind: 'download' });
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.contexts[0]).toMatchObject({ download: backupFileName() });
    expect(backupFileName('2026-09-24')).toBe('skill-flask-2026-09-24.json');
    expect(await getSetting('lastFileBackupAt', null)).not.toBeNull();
    click.mockRestore();
  });

  it('shares a file inside Telegram and never builds a blob link', async () => {
    fake = installFakeTelegram('7.10');
    const createObjectURL = vi.fn();
    urlStatics.createObjectURL = createObjectURL;
    const share = vi.fn(async (_data: ShareData) => {});
    nav.canShare = () => true;
    nav.share = share;
    expect(await exportToFile()).toEqual({ kind: 'share' });
    const shared = share.mock.calls[0][0].files![0];
    expect(shared.name).toMatch(/^skill-flask-\d{4}-\d{2}-\d{2}\.json$/);
    expect(parseBackupText(await shared.text()).tables.skills).toHaveLength(1);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('respects a closed share sheet', async () => {
    fake = installFakeTelegram('7.10');
    nav.canShare = () => true;
    nav.share = async () => {
      throw Object.assign(new Error('closed'), { name: 'AbortError' });
    };
    expect(await exportToFile()).toEqual({ kind: 'cancelled' });
    expect(await getSetting('lastFileBackupAt', null)).toBeNull();
  });

  it('falls back to the clipboard, then to the text itself', async () => {
    fake = installFakeTelegram('7.10');
    const writeText = vi.fn(async (_text: string) => {});
    nav.clipboard = { writeText };
    const copied = await exportToFile();
    expect(copied).toMatchObject({ kind: 'clipboard' });
    expect(parseBackupText(writeText.mock.calls[0][0]).tables.skills).toHaveLength(1);

    nav.clipboard = { writeText: async () => Promise.reject(new Error('denied')) };
    const text = await exportToFile();
    expect(text.kind).toBe('text');
    if (text.kind === 'text') expect(parseBackupText(text.text).tables.skills).toHaveLength(1);
  });
});

describe('importFromFile', () => {
  it('replaces the data with the parsed file', async () => {
    const file = parseBackupText(JSON.stringify(fixture));
    const stats = await importFromFile(file);
    expect(stats.skills).toBe(2);
    expect((await db.skills.toArray()).map((s) => s.name)).toEqual(['Английский', 'Тренировки']);
  });
});

describe('fileBackupReminder', () => {
  const at = (date: string) => new Date(`${date}T12:00:00`).toISOString();

  it('stays quiet within 7 days of the newer backup', () => {
    expect(fileBackupReminder(at('2026-09-17'), null, 5, '2026-09-24')).toBeNull();
    expect(fileBackupReminder(at('2026-09-01'), at('2026-09-20'), 5, '2026-09-24')).toBeNull();
  });

  it('counts the days once the newest copy is older', () => {
    expect(fileBackupReminder(at('2026-09-16'), null, 5, '2026-09-24')).toBe(8);
    expect(fileBackupReminder(at('2026-09-01'), at('2026-09-10'), 5, '2026-09-24')).toBe(14);
  });

  it('asks for a first copy only once there is something to keep', () => {
    expect(fileBackupReminder(null, null, 0, '2026-09-24')).toBeNull();
    expect(fileBackupReminder(null, null, 1, '2026-09-24')).toBe('never');
  });
});
