// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock } from '../../lib/clock';
import { completeStep } from '../../services/completions';
import { createSkill, type SkillInput } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFreshDb, tickingClock } from '../../test/harness';
import { installFakeTelegram, type FakeTelegram } from '../../test/fakeTelegram';
import { ToastProvider } from '../components/Toast';
import { SkillScreen } from '../screens/SkillScreen';
import type { CardModel } from './cardLayout';

// «Поделиться прогрессом» from the skill's ⋯ menu, with the canvas replaced (jsdom has none):
// which ways out the sheet offers in a browser with and without Web Share and inside Telegram,
// and what each one sends.

const made = vi.hoisted(() => ({ calls: [] as { model: CardModel; stage: HTMLElement; style: string }[] }));
vi.mock('./renderCard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderCard')>()),
  makeShareCard: vi.fn(async (model: CardModel, stage: HTMLElement, style: string) => {
    made.calls.push({ model, stage, style });
    return { blob: new Blob(['png'], { type: 'image/png' }), fallback: false };
  }),
}));

const TODAY = '2026-09-26';
const input: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: 'B1',
  targetLabel: 'B2',
  milestoneName: 'Цель',
  milestoneTarget: 5,
  capacityBase: 10,
  capacityIncrement: 0,
  manualCapacities: [],
};

installFreshDb();
let fake: FakeTelegram | undefined;
const stubbed: string[] = [];
function stubNavigator(name: 'share' | 'canShare' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
  stubbed.push(name);
}

beforeEach(() => {
  setClock(tickingClock(`${TODAY}T12:00:00`));
  made.calls.length = 0;
  URL.createObjectURL = vi.fn(() => 'blob:card');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  fake?.uninstall();
  fake = undefined;
  for (const name of stubbed.splice(0)) delete (navigator as unknown as Record<string, unknown>)[name];
  vi.restoreAllMocks();
});

/** A skill with two filled levels (capacity 10): «Уже 2 колбы в навыке «Английский»». */
async function skillWithProgress(): Promise<string> {
  const id = await createSkill(input);
  const step = await createStep({ skillId: id, name: 'Разговор', points: 10 });
  await completeStep(step, { date: '2026-09-25' });
  await completeStep(step, { date: TODAY });
  return id;
}

async function openShare(id: string) {
  render(
    <MemoryRouter initialEntries={['/skills', `/skills/${id}`]} initialIndex={1}>
      <ToastProvider>
        <Routes>
          <Route path="/skills" element={<p>home</p>} />
          <Route path="/skills/:skillId" element={<SkillScreen />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Меню навыка' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Поделиться прогрессом' }));
  const sheet = await screen.findByRole('dialog', { name: 'Поделиться прогрессом' });
  await within(sheet).findByRole('img', { name: 'Карточка прогресса: Английский' });
  return sheet;
}

describe('the share sheet', () => {
  it('draws the card from the skill’s progress on an off-screen stage in its theme', async () => {
    const id = await skillWithProgress();
    await openShare(id);
    expect(made.calls).toHaveLength(1);
    const { model, stage, style } = made.calls[0]!;
    expect(model).toMatchObject({ name: 'Английский', theme: 'flask', level: '3', status: 'B1 → B2', message: 'Уже 2 колбы в навыке «Английский»' });
    expect(model.milestone?.text).toBe('2 из 5 колб до цели «B2»');
    expect(model.tiles.map((tile) => tile.value)).toEqual(['2', '2']);
    expect(style).toBe('light');
    expect(stage.classList.contains('share-stage')).toBe(true);
    expect(stage.getAttribute('aria-hidden')).toBe('true');
    // The stage is gone once the picture is taken.
    await waitFor(() => expect(document.querySelector('.share-stage')).toBeNull());
  });

  it('in a browser without Web Share: saves the picture and copies the link', async () => {
    const id = await skillWithProgress();
    const sheet = await openShare(id);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить картинку' }));
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('blob:card');
    expect(anchor.download).toBe(`skill-flask-${TODAY}.png`);
    expect(within(sheet).queryByRole('button', { name: 'Поделиться картинкой' })).toBeNull();

    const writeText = vi.fn(async () => {});
    stubNavigator('clipboard', { writeText });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Скопировать ссылку' }));
    expect(await screen.findByText('Ссылка скопирована')).toBeTruthy();
    // The friend's phone has none of this skill: the link is the app's, not `#/skills/<id>`.
    expect(writeText).toHaveBeenCalledWith('https://t.me/SkillFlaskBot/app');
  });

  it('shows the link to copy by hand when the clipboard refuses', async () => {
    const id = await skillWithProgress();
    const sheet = await openShare(id);
    stubNavigator('clipboard', { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Скопировать ссылку' }));
    const field = await within(sheet).findByRole('textbox', { name: 'Ссылка на Skill Flask' });
    expect((field as HTMLTextAreaElement).value).toBe('https://t.me/SkillFlaskBot/app');
  });

  it('with Web Share for files: shares the picture with its line, the link through Web Share too', async () => {
    const share = vi.fn(async () => {});
    stubNavigator('share', share);
    stubNavigator('canShare', vi.fn((data: ShareData) => Boolean(data.files?.length)));
    const id = await skillWithProgress();
    const sheet = await openShare(id);
    expect(within(sheet).queryByRole('button', { name: 'Сохранить картинку' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Поделиться ссылкой' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Поделиться картинкой' }));
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    const data = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(data.text).toBe('Уже 2 колбы в навыке «Английский»');
    expect(data.files?.[0]?.name).toBe(`skill-flask-${TODAY}.png`);
    expect(data.files?.[0]?.type).toBe('image/png');
    // Shared: the sheet closes.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Поделиться прогрессом' })).toBeNull());
  });

  it('opens the system sheet once for a double tap, with no «не получилось» over it', async () => {
    let finish = () => {};
    const share = vi.fn(
      (data: ShareData) =>
        new Promise<void>((resolve, reject) => {
          if (!data.files) return resolve();
          // A second call while the first sheet is open rejects, as browsers do.
          if (share.mock.calls.length > 1) return reject(new DOMException('in progress', 'InvalidStateError'));
          finish = () => reject(new DOMException('closed', 'AbortError'));
        }),
    );
    stubNavigator('share', share);
    stubNavigator('canShare', vi.fn((data: ShareData) => Boolean(data.files?.length)));
    const id = await skillWithProgress();
    const sheet = await openShare(id);
    const button = within(sheet).getByRole('button', { name: 'Поделиться картинкой' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Поделиться ссылкой' }));
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    // The user closes the system sheet: the sheet stays as it was, and a new tap works again.
    await act(async () => {
      finish();
      // A macrotask: every promise of the closed share has settled by then.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Поделиться ссылкой' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect((share.mock.calls[1] as unknown as [ShareData])[0]).toEqual({ url: 'https://t.me/SkillFlaskBot/app', text: 'Уже 2 колбы в навыке «Английский»' });
    expect(screen.queryByText(/Не получилось открыть «Поделиться»/)).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Сохранить картинку' })).toBeNull();
  });

  it('offers the download instead once the system sheet refuses', async () => {
    stubNavigator('share', vi.fn(async () => Promise.reject(new DOMException('no gesture', 'NotAllowedError'))));
    stubNavigator('canShare', vi.fn(() => true));
    const id = await skillWithProgress();
    const sheet = await openShare(id);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Поделиться картинкой' }));
    expect(await screen.findByText(/Не получилось открыть «Поделиться»/)).toBeTruthy();
    expect(await within(sheet).findByRole('button', { name: 'Сохранить картинку' })).toBeTruthy();
  });

  it('in Telegram on iOS without Web Share: a long press saves, the link goes to the chat picker', async () => {
    fake = installFakeTelegram('7.10');
    const id = await skillWithProgress();
    const sheet = await openShare(id);
    expect(within(sheet).getByText('Нажмите и удерживайте картинку, чтобы сохранить')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Сохранить картинку' })).toBeNull();
    const send = within(sheet).getByRole('button', { name: 'Отправить ссылку в чат' });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(fake!.calls.some((call) => call.startsWith('openTelegramLink('))).toBe(true));
    // A double tap opens the chat picker once.
    expect(fake.calls.filter((c) => c.startsWith('openTelegramLink('))).toHaveLength(1);
    const call = fake.calls.find((c) => c.startsWith('openTelegramLink('))!;
    const url = new URL(JSON.parse(call.slice('openTelegramLink('.length, -1)) as string);
    expect(url.origin + url.pathname).toBe('https://t.me/share/url');
    expect(url.searchParams.get('url')).toBe(`https://t.me/SkillFlaskBot/app?startapp=skill_${id.replace(/-/g, '')}`);
    expect(url.searchParams.get('text')).toBe('Уже 2 колбы в навыке «Английский»');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Поделиться прогрессом' })).toBeNull());
  });

  it('in Telegram on Android: says that only a screenshot saves the picture', async () => {
    fake = installFakeTelegram('7.10', { platform: 'android' });
    const id = await skillWithProgress();
    const sheet = await openShare(id);
    expect(within(sheet).getByText(/сделайте снимок экрана или отправьте ссылку в чат/)).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Отправить ссылку в чат' }).className).toContain('button-primary');
  });

  it('in Telegram Desktop: the right-click menu saves the picture', async () => {
    fake = installFakeTelegram('7.10', { platform: 'tdesktop' });
    const id = await skillWithProgress();
    const sheet = await openShare(id);
    expect(within(sheet).getByText('Щёлкните картинку правой кнопкой мыши, чтобы сохранить')).toBeTruthy();
    expect(within(sheet).queryByText(/снимок экрана/)).toBeNull();
  });
});
