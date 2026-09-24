// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import { dialogs, registerDialogHost } from './dialogs';

let fake: FakeTelegram | undefined;
afterEach(() => {
  fake?.uninstall();
  fake = undefined;
});

describe('dialogs', () => {
  it('uses the in-app host below 6.2 and queues calls one after another', async () => {
    fake = installFakeTelegram('6.0');
    const log: string[] = [];
    let resolveFirst: (ok: boolean) => void = () => {};
    let n = 0;
    const unregister = registerDialogHost({
      confirm: (message) => {
        log.push(`open:${message}`);
        n += 1;
        return n === 1 ? new Promise((resolve) => (resolveFirst = resolve)) : Promise.resolve(false);
      },
      popup: (options) => {
        log.push(`popup:${options.title}`);
        return Promise.resolve(options.buttons[1]?.id);
      },
    });
    try {
      const first = dialogs.confirm('Первый');
      const second = dialogs.confirm('Второй');
      const third = dialogs.popup({ title: 'Меню', message: 'm', buttons: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] });
      // The first call opens synchronously inside the click handler; the rest wait.
      expect(log).toEqual(['open:Первый']);
      resolveFirst(true);
      expect(await first).toBe(true);
      expect(await second).toBe(false);
      expect(await third).toBe('b');
      expect(log).toEqual(['open:Первый', 'open:Второй', 'popup:Меню']);
      expect(fake.calls.some((c) => c.startsWith('showConfirm'))).toBe(false);
    } finally {
      unregister();
    }
  });

  it('uses showPopup from 6.2 and trims to three buttons', async () => {
    fake = installFakeTelegram('6.2');
    const id = await dialogs.popup({
      message: 'm',
      buttons: [
        { id: '1', text: 'A' },
        { id: '2', text: 'B' },
        { id: '3', text: 'C' },
        { id: '4', text: 'D' },
      ],
    });
    expect(id).toBe('1');
    expect(fake.calls).toContain('showPopup');
  });
});
