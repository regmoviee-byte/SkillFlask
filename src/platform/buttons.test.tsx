// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Screen } from '../ui/components/Screen';
import { installFakeTelegram, type FakeTelegram } from '../test/fakeTelegram';
import { useBottomButtons, useUnsavedGuard } from './buttons';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let fake: FakeTelegram | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  fake?.uninstall();
  fake = undefined;
});

function Form({ disabled = false }: { disabled?: boolean }) {
  return (
    <MemoryRouter>
      <Screen title="Форма" back="/skills" primary={{ text: 'Сохранить', onClick: () => {}, disabled }} secondary={{ text: 'Отмена', onClick: () => {} }}>
        <p>Поля</p>
      </Screen>
    </MemoryRouter>
  );
}

describe('bottom buttons', () => {
  it('renders HTML footer buttons outside Telegram', async () => {
    await act(async () => root.render(<Form />));
    const buttons = [...container.querySelectorAll('.screen-footer button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Сохранить', 'Отмена']);
    expect(container.querySelector('.icon-button')).not.toBeNull();
  });

  it('binds MainButton and SecondaryButton in Telegram ≥ 7.10 and renders no footer', async () => {
    fake = installFakeTelegram('7.10');
    await act(async () => root.render(<Form />));
    expect(container.querySelector('.screen-footer')).toBeNull();
    expect(container.querySelector('.icon-button')).toBeNull();
    expect(fake.calls).toContain('MainButton.setParams({"text":"Сохранить","is_visible":true,"is_active":true})');
    expect(fake.calls).toContain('SecondaryButton.setParams({"text":"Отмена","is_visible":true,"is_active":true})');
    expect(fake.calls.filter((c) => c.startsWith('MainButton.onClick')).length).toBe(1);

    await act(async () => root.render(<Form disabled />));
    expect(fake.calls).toContain('MainButton.setParams({"text":"Сохранить","is_visible":true,"is_active":false})');

    await act(async () => root.unmount());
    expect(fake.calls).toContain('MainButton.hide()');
    expect(fake.calls).toContain('SecondaryButton.hide()');
  });

  it('lets a sheet take the MainButton over and hands it back to the screen', async () => {
    fake = installFakeTelegram('7.10');
    const clicks: string[] = [];
    function Sheet({ open }: { open: boolean }) {
      useBottomButtons({ main: open ? { text: 'Готово', onClick: () => clicks.push('sheet') } : undefined }, 1);
      return null;
    }
    function Page({ open }: { open: boolean }) {
      return (
        <MemoryRouter>
          <Screen title="Экран" primary={{ text: 'Сохранить', onClick: () => clicks.push('screen') }}>
            <Sheet open={open} />
          </Screen>
        </MemoryRouter>
      );
    }
    await act(async () => root.render(<Page open={false} />));
    await act(async () => root.render(<Page open />));
    expect(fake.calls.at(-1)).toBe('MainButton.hideProgress()');
    expect(fake.calls).toContain('MainButton.setParams({"text":"Готово","is_visible":true,"is_active":true})');
    fake.click('MainButton');
    await act(async () => root.render(<Page open={false} />));
    const last = fake.calls.filter((c) => c.startsWith('MainButton.setParams')).at(-1);
    expect(last).toBe('MainButton.setParams({"text":"Сохранить","is_visible":true,"is_active":true})');
    expect(fake.calls.slice(-3)).not.toContain('MainButton.hide()');
    fake.click('MainButton');
    expect(clicks).toEqual(['sheet', 'screen']);
    // One SDK listener for both owners.
    expect(fake.calls.filter((c) => c.startsWith('MainButton.onClick')).length).toBe(1);
  });

  it('keeps the secondary button in HTML on Telegram 6.1', async () => {
    fake = installFakeTelegram('6.1');
    await act(async () => root.render(<Form />));
    const buttons = [...container.querySelectorAll('.screen-footer button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Отмена']);
    expect(fake.calls.some((c) => c.startsWith('MainButton.setParams'))).toBe(true);
    expect(fake.calls.some((c) => c.startsWith('SecondaryButton.'))).toBe(false);
  });

  it('enables closing confirmation while a form is dirty', async () => {
    fake = installFakeTelegram('7.10');
    function Guard({ dirty }: { dirty: boolean }) {
      useUnsavedGuard(dirty);
      return null;
    }
    await act(async () => root.render(<Guard dirty />));
    expect(fake.calls).toContain('enableClosingConfirmation()');
    await act(async () => root.render(<Guard dirty={false} />));
    expect(fake.calls).toContain('disableClosingConfirmation()');
  });
});
