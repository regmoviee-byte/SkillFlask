// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeTelegram, type FakeTelegram } from '../../test/fakeTelegram';
import { useTelegramBackButton } from '../../platform/telegram';
import { closeTopSheet, dropStaleSheetEntry, openSheetCount, Sheet, shouldClose } from './Sheet';
import { ConfirmSheet } from './ConfirmSheet';
import { ContextSheet } from './ContextSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let fake: FakeTelegram | undefined;

beforeEach(() => {
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.getElementById('sheets')?.remove();
  fake?.uninstall();
  fake = undefined;
  await tick();
});

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function Harness({ open, onClose, dismissible = true }: { open: boolean; onClose(): void; dismissible?: boolean }) {
  return (
    <Sheet open={open} onClose={onClose} title="Лист" dismissible={dismissible}>
      <p>Содержимое</p>
    </Sheet>
  );
}

async function render(open: boolean, onClose: () => void, dismissible?: boolean) {
  await act(async () => root.render(<Harness open={open} onClose={onClose} dismissible={dismissible} />));
  await act(tick);
}

describe('Sheet', () => {
  it('keeps the sheet stack balanced and locks the body while open', async () => {
    let closes = 0;
    expect(openSheetCount()).toBe(0);
    await render(true, () => closes++);
    expect(openSheetCount()).toBe(1);
    expect(document.querySelector('.sheet')?.getAttribute('data-state')).toBe('open');
    expect(document.body.classList.contains('sheet-lock')).toBe(true);
    expect(container.hasAttribute('inert')).toBe(true);
    expect(window.history.state?.sheet).toBeDefined();

    await render(false, () => closes++);
    expect(openSheetCount()).toBe(0);
    await act(() => tick(320));
    expect(document.querySelector('.sheet')).toBeNull();
    expect(document.body.classList.contains('sheet-lock')).toBe(false);
    expect(container.hasAttribute('inert')).toBe(false);
    // The parent closed the sheet itself: the history entry it pushed is popped again.
    expect(window.history.state?.sheet).toBeUndefined();
    expect(closes).toBe(0);
  });

  it('calls onClose on popstate (browser back)', async () => {
    let closes = 0;
    await render(true, () => closes++);
    await act(async () => {
      window.history.back();
      await tick(30);
    });
    expect(closes).toBe(1);
    expect(window.history.state?.sheet).toBeUndefined();
  });

  it('closes on scrim tap by popping its history entry', async () => {
    let closes = 0;
    await render(true, () => closes++);
    await act(async () => {
      document.querySelector<HTMLDivElement>('.sheet-scrim')!.click();
      await tick(30);
    });
    expect(closes).toBe(1);
    expect(window.history.state?.sheet).toBeUndefined();
  });

  it('closes once on a double tap: one onClose, one history entry popped', async () => {
    let closes = 0;
    function Stateful() {
      const [open, setOpen] = useState(true);
      return (
        <Harness
          open={open}
          onClose={() => {
            closes++;
            setOpen(false);
          }}
        />
      );
    }
    const before = window.history.state?.idx ?? 0;
    await act(async () => root.render(<Stateful />));
    await act(tick);
    expect(window.history.state?.idx).toBe(before + 1);
    await act(async () => {
      const scrim = document.querySelector<HTMLDivElement>('.sheet-scrim')!;
      scrim.click();
      scrim.click(); // history.back() is still in flight
      expect(closeTopSheet()).toBe(true); // BackButton path while closing: swallowed
      await tick(60);
    });
    expect(closes).toBe(1);
    expect(window.history.state?.idx ?? 0).toBe(before);
    expect(window.history.state?.sheet).toBeUndefined();
    expect(openSheetCount()).toBe(0);
  });

  it('ignores the scrim when not dismissible but still closes on back', async () => {
    let closes = 0;
    await render(true, () => closes++, false);
    await act(async () => {
      document.querySelector<HTMLDivElement>('.sheet-scrim')!.click();
      await tick(30);
    });
    expect(closes).toBe(0);
    expect(closeTopSheet()).toBe(true);
    await act(() => tick(30));
    expect(closes).toBe(1);
  });

  it('is closed by the Telegram BackButton before the screen handler', async () => {
    fake = installFakeTelegram('7.10');
    let closes = 0;
    let screenBacks = 0;
    function ScreenLike() {
      const [open, setOpen] = useState(true);
      useTelegramBackButton(() => screenBacks++);
      return (
        <Harness
          open={open}
          onClose={() => {
            closes++;
            setOpen(false);
          }}
        />
      );
    }
    await act(async () => root.render(<ScreenLike />));
    await act(tick);
    expect(fake.calls.some((c) => c.startsWith('BackButton.show'))).toBe(true);
    // First press: the sheet closes, the screen stays.
    await act(async () => {
      fake!.click('BackButton');
      await tick(30);
    });
    expect(closes).toBe(1);
    expect(screenBacks).toBe(0);
    expect(document.querySelector('.sheet')?.getAttribute('data-state')).toBe('closing');
    // Second press: no sheet left, the screen's own handler runs.
    await act(async () => {
      fake!.click('BackButton');
      await tick(30);
    });
    expect(closes).toBe(1);
    expect(screenBacks).toBe(1);
  });

  it('decides a drag release by distance or velocity', () => {
    expect(shouldClose(100, 300, 0)).toBe(true);
    expect(shouldClose(50, 300, 0.1)).toBe(false);
    expect(shouldClose(20, 300, 0.8)).toBe(true);
    expect(shouldClose(-50, 300, 2)).toBe(false);
  });

  it('names the dialog and describes it by its body', async () => {
    await render(true, () => {});
    const sheet = document.querySelector<HTMLDivElement>('.sheet')!;
    expect(document.getElementById(sheet.getAttribute('aria-labelledby')!)?.textContent).toBe('Лист');
    expect(document.getElementById(sheet.getAttribute('aria-describedby')!)?.className).toBe('sheet-body');
  });

  it('drops a stale sheet entry left by a reload', async () => {
    const idx = window.history.state?.idx ?? 0;
    window.history.pushState({ idx: idx + 1, sheet: 'ghost' }, '');
    dropStaleSheetEntry();
    expect(window.history.state?.sheet).toBeUndefined();
    await tick(30);
    expect(window.history.state?.idx ?? 0).toBe(idx);
    // Nothing to do when the entry is clean.
    dropStaleSheetEntry();
    await tick(30);
    expect(window.history.state?.idx ?? 0).toBe(idx);
  });

  it('closes on a pointer drag past the threshold', async () => {
    let closes = 0;
    await render(true, () => closes++);
    const handle = document.querySelector<HTMLDivElement>('.sheet-handle-area')!;
    const sheet = document.querySelector<HTMLDivElement>('.sheet')!;
    Object.defineProperty(sheet, 'offsetHeight', { configurable: true, value: 300 });
    const pointer = (type: string, clientY: number) => new MouseEvent(type, { bubbles: true, clientY, button: 0 });
    await act(async () => {
      handle.dispatchEvent(pointer('pointerdown', 100));
      handle.dispatchEvent(pointer('pointermove', 150));
      handle.dispatchEvent(pointer('pointermove', 250));
      expect(sheet.style.transform).toBe('translateY(150px)');
      handle.dispatchEvent(pointer('pointerup', 250));
      await tick(30);
    });
    expect(closes).toBe(1);
  });
});

describe('ContextSheet', () => {
  it('runs onSelect only after the sheet closed and reports the item to onClose', async () => {
    const events: string[] = [];
    function Menu({ open }: { open: boolean }) {
      return (
        <ContextSheet
          open={open}
          onClose={(item) => events.push(`close:${item?.label ?? '-'}`)}
          items={[{ label: 'Изменить', onSelect: () => events.push('select') }]}
        />
      );
    }
    await act(async () => root.render(<Menu open />));
    await act(tick);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.context-item')!.click();
      await tick(30);
    });
    expect(events).toEqual(['close:Изменить', 'select']);
    expect(window.history.state?.sheet).toBeUndefined();
  });

  it('shows a message above the items and uses it as the accessible name', async () => {
    await act(async () => root.render(<ContextSheet open onClose={() => {}} message="Что сделать с навыком?" items={[{ label: 'Изменить', onSelect: () => {} }]} />));
    await act(tick);
    const sheet = document.querySelector<HTMLDivElement>('.sheet')!;
    expect(sheet.querySelector('.confirm-message')?.textContent).toBe('Что сделать с навыком?');
    expect(sheet.getAttribute('aria-label')).toBe('Что сделать с навыком?');
  });
});

describe('ConfirmSheet', () => {
  it('reports the answer only after its history entry is gone', async () => {
    const events: string[] = [];
    await act(async () => root.render(<ConfirmSheet open message="Удалить навык?" okLabel="Удалить" onResult={(ok) => events.push(`result:${ok}:${String(window.history.state?.sheet)}`)} />));
    await act(tick);
    const sheet = document.querySelector<HTMLDivElement>('.sheet')!;
    expect(sheet.getAttribute('aria-label')).toBe('Подтверждение');
    expect(document.getElementById(sheet.getAttribute('aria-describedby')!)?.textContent).toBe('Удалить навык?');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.button-primary')!.click();
      await tick(30);
    });
    expect(events).toEqual(['result:true:undefined']);
  });

  it('keeps the first answer when a second button is tapped while closing', async () => {
    const events: boolean[] = [];
    await act(async () => root.render(<ConfirmSheet open message="Завершить?" onResult={(ok) => events.push(ok)} />));
    await act(tick);
    await act(async () => {
      const buttons = document.querySelectorAll<HTMLButtonElement>('.sheet-footer .button');
      buttons[0]!.click(); // «Отмена»
      buttons[1]!.click(); // «OK», too late
      await tick(30);
    });
    expect(events).toEqual([false]);
  });

  it('counts a dismissal as cancel', async () => {
    const events: boolean[] = [];
    await act(async () => root.render(<ConfirmSheet open message="Завершить?" onResult={(ok) => events.push(ok)} />));
    await act(tick);
    await act(async () => {
      document.querySelector<HTMLDivElement>('.sheet-scrim')!.click();
      await tick(30);
    });
    expect(events).toEqual([false]);
  });
});
