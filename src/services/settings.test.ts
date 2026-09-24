import { describe, expect, it } from 'vitest';
import { installFreshDb } from '../test/harness';
import { getSetting, setSetting } from './settings';

installFreshDb();

describe('settings', () => {
  it('returns the fallback for unknown keys and stores values', async () => {
    expect(await getSetting('motion', 'full')).toBe('full');
    await setSetting('motion', 'reduced');
    expect(await getSetting('motion', 'full')).toBe('reduced');
  });

  it('seeds installId on first read and keeps it', async () => {
    const first = await getSetting('installId', '');
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getSetting('installId', '')).toBe(first);
  });
});
