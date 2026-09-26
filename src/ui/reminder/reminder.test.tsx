// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock } from '../../lib/clock';
import { getSetting, setSetting } from '../../services/settings';
import { createSkill } from '../../services/skills';
import { createStep } from '../../services/steps';
import { installFakeTelegram, type FakeTelegram } from '../../test/fakeTelegram';
import { installFreshDb, tickingClock } from '../../test/harness';
import { parseIcs, props, unescapeText } from '../../test/ics';
import { ToastProvider } from '../components/Toast';
import { SkillScreen } from '../screens/SkillScreen';
import { ReminderForm } from './ReminderForm';

// «Напоминание в календаре» (v0.5 package 20): which buttons each platform gets, what each one
// hands to the calendar, and what the form remembers. Telegram's openLink is recorded by the fake;
// a link outside Telegram is an anchor click (spied: jsdom does not navigate).

const TODAY = '2026-09-26'; // a Saturday
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const realAgent = navigator.userAgent;

installFreshDb();
let fake: FakeTelegram | undefined;

beforeEach(() => {
  setClock(tickingClock(`${TODAY}T12:00:00`));
});
afterEach(() => {
  cleanup();
  fake?.uninstall();
  fake = undefined;
  Object.defineProperty(navigator, 'userAgent', { value: realAgent, configurable: true });
  vi.restoreAllMocks();
});

function userAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}

function renderForm() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ReminderForm skill={null} inCard />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** The URLs Telegram was asked to open. */
const opened = () => fake!.calls.filter((call) => call.startsWith('openLink(')).map((call) => JSON.parse(call.slice('openLink('.length, -1)) as string);

const presets = () => within(screen.getByRole('group', { name: 'Дни' }));

describe('the general reminder («Настройки»)', () => {
  it('Telegram iOS: three day sets, one «Добавить в Календарь» that opens the static https file', async () => {
    fake = installFakeTelegram('7.10', { platform: 'ios' });
    renderForm();
    expect(presets().getAllByRole('button').map((b) => b.textContent)).toEqual(['Каждый день', 'По будням', 'По выходным']);
    expect(screen.queryByRole('button', { name: 'Свои дни' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Файл .ics' })).toBeNull();
    // The honest note: the calendar does not know whether the user practised.
    expect(screen.getByText(/даже если вы уже позанимались/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Время'), { target: { value: '07:30' } });
    fireEvent.click(presets().getByRole('button', { name: 'По будням' }));
    expect(presets().getByRole('button', { name: 'По будням' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в Календарь' }));
    expect(opened()).toEqual([new URL('reminders/weekdays-0730.ics', document.baseURI).href]);
    // A second tap while the browser opens does not open it twice.
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в Календарь' }));
    expect(opened()).toHaveLength(1);
    // Remembered for the form (this device only).
    await waitFor(async () => expect(await getSetting('reminder', null)).toEqual({ time: '07:30', days: 'weekdays' }));
  });

  it('comes back with the last time and days', async () => {
    fake = installFakeTelegram('7.10', { platform: 'ios' });
    await setSetting('reminder', { time: '21:15', days: 'weekend' });
    renderForm();
    await waitFor(() => expect((screen.getByLabelText('Время') as HTMLSelectElement).value).toBe('21:15'));
    expect(presets().getByRole('button', { name: 'По выходным' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('Telegram iOS reads remembered weekdays (chosen on another platform) as every day', async () => {
    fake = installFakeTelegram('7.10', { platform: 'ios' });
    await setSetting('reminder', { time: '08:00', days: [1, 3] });
    renderForm();
    await waitFor(() => expect((screen.getByLabelText('Время') as HTMLSelectElement).value).toBe('08:00'));
    expect(presets().getByRole('button', { name: 'Каждый день' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в Календарь' }));
    expect(opened()[0]).toMatch(/\/reminders\/daily-0800\.ics$/);
  });

  it('Telegram Android: Google Calendar with any weekdays, the file for the day sets only', async () => {
    fake = installFakeTelegram('7.10', { platform: 'android' });
    renderForm();
    expect(screen.getByText(/как в Google Календаре настроено по умолчанию/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Файл .ics' }));
    expect(opened()).toEqual([new URL('reminders/daily-1900.ics', document.baseURI).href]);

    // «Свои дни» starts from the days shown (every day); Monday and Wednesday stay.
    fireEvent.click(presets().getByRole('button', { name: 'Свои дни' }));
    const week = within(screen.getByRole('group', { name: 'Дни недели' }));
    for (const day of ['Вторник', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']) fireEvent.click(week.getByRole('button', { name: day }));
    expect(screen.queryByRole('button', { name: 'Файл .ics' })).toBeNull();
    expect(screen.getByText('Файл .ics — для готовых наборов дней.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Google Календарь' }));
    const url = new URL(opened()[1]!);
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('text')).toBe('Skill Flask: время заниматься');
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
    // The first Monday from Saturday the 26th, floating local time.
    expect(url.searchParams.get('dates')).toBe('20260928T190000/20260928T191500');
    expect(url.searchParams.get('details')).toContain('https://t.me/SkillFlaskBot/app?startapp=today');
    await waitFor(async () => expect(await getSetting('reminder', null)).toEqual({ time: '19:00', days: [1, 3] }));

    // No day at all: nothing to add.
    fireEvent.click(week.getByRole('button', { name: 'Понедельник' }));
    fireEvent.click(week.getByRole('button', { name: 'Среда' }));
    expect(screen.getByText('Выберите хотя бы один день')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Google Календарь' }) as HTMLButtonElement).disabled).toBe(true);

    // Weekdays picked one by one are «По будням», and the file is back.
    for (const day of ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница']) fireEvent.click(week.getByRole('button', { name: day }));
    fireEvent.click(screen.getByRole('button', { name: 'Файл .ics' }));
    expect(opened()[2]).toMatch(/\/reminders\/weekdays-1900\.ics$/);
  });

  it('a browser on Android: Google in a new tab, the file made on the phone and downloaded', async () => {
    userAgent(ANDROID);
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:ics';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderForm();
    fireEvent.click(presets().getByRole('button', { name: 'По выходным' }));
    fireEvent.click(screen.getByRole('button', { name: 'Google Календарь' }));
    const google = click.mock.contexts[0] as HTMLAnchorElement;
    expect(google.href).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
    expect(google.target).toBe('_blank');
    // Outside Telegram the event opens this page on «Сегодня».
    expect(new URL(google.href).searchParams.get('details')).toContain('http://localhost:3000/#/today');

    fireEvent.click(screen.getByRole('button', { name: 'Файл .ics' }));
    const file = click.mock.contexts[1] as HTMLAnchorElement;
    expect(file.getAttribute('href')).toBe('blob:ics');
    expect(file.download).toBe('skill-flask-1900.ics');
    expect(blobs[0]!.type).toBe('text/calendar;charset=utf-8');
    const event = props(parseIcs(await blobs[0]!.text()), 'VEVENT');
    expect(event.RRULE).toBe('FREQ=WEEKLY;BYDAY=SA,SU');
    expect(event.DTSTART).toBe('20260926T190000');
    expect(event.URL).toBe('http://localhost:3000/#/today');
    expect(await screen.findByText('Файл сохранён — откройте его, чтобы добавить событие')).toBeTruthy();
  });

  it('Safari on iPhone: the static file in this tab, and a word about its Telegram link', () => {
    userAgent(IPHONE);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderForm();
    expect(screen.getByText('Ссылка в событии открывает Skill Flask в Telegram.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в Календарь' }));
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.href).toBe(new URL('reminders/daily-1900.ics', document.baseURI).href);
    expect(link.target).toBe('');
  });
});

describe('«Напоминание для навыка»', () => {
  async function skillScreen() {
    const id = await createSkill({
      name: 'Английский',
      description: '',
      startLabel: '',
      targetLabel: '',
      milestoneName: 'Цель',
      milestoneTarget: 3,
      capacityBase: 10,
      capacityIncrement: 0,
      manualCapacities: [],
    });
    await createStep({ skillId: id, name: 'Разговор', points: 5 });
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
    return { id, menu: within(await screen.findByRole('dialog')) };
  }

  it('Telegram Android: the skill’s title and link, Google Calendar only', async () => {
    fake = installFakeTelegram('7.10', { platform: 'android' });
    const { id, menu } = await skillScreen();
    fireEvent.click(menu.getByRole('button', { name: 'Напоминание для навыка' }));
    const sheet = within(await screen.findByRole('dialog', { name: 'Напоминание для навыка' }));
    expect(sheet.getByText('Событие «Английский — время заниматься» в календаре телефона.')).toBeTruthy();
    expect(sheet.queryByRole('button', { name: 'Файл .ics' })).toBeNull();
    expect(sheet.getByText('Файл .ics — только общее напоминание, в «Настройках».')).toBeTruthy();
    fireEvent.click(sheet.getByRole('button', { name: 'Google Календарь' }));
    const url = new URL(opened()[0]!);
    expect(url.searchParams.get('text')).toBe('Английский — время заниматься');
    expect(url.searchParams.get('details')).toContain(`https://t.me/SkillFlaskBot/app?startapp=skill_${id.replace(/-/g, '')}`);
    expect(unescapeText(url.searchParams.get('details')!)).toMatch(/^Откройте Skill Flask/);
  });

  it('Telegram iOS: no skill reminder in the menu (the static files carry the general title)', async () => {
    fake = installFakeTelegram('7.10', { platform: 'ios' });
    const { menu } = await skillScreen();
    expect(menu.getByRole('button', { name: 'Поделиться прогрессом' })).toBeTruthy();
    expect(menu.queryByRole('button', { name: 'Напоминание для навыка' })).toBeNull();
  });
});
