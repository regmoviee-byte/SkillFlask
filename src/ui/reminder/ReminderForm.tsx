import { useId, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { buildIcs, googleCalendarUrl } from '../../domain/ics';
import {
  daysKey,
  daysOf,
  DEFAULT_REMINDER,
  normalizeDays,
  parseReminderChoice,
  REMINDER_PRESETS,
  REMINDER_TIMES,
  reminderEvent,
  staticReminderPath,
  type ReminderChoice,
  type ReminderPreset,
} from '../../domain/reminder';
import type { Weekday } from '../../domain/types';
import { localDate, nowDate } from '../../lib/clock';
import { logError } from '../../platform/errorLog';
import { haptics } from '../../platform/haptics';
import { isStaticWay, reminderEnv, reminderPlan, type ReminderWay } from '../../platform/reminders';
import { getSetting, setSetting } from '../../services/settings';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { appFileUrl, downloadIcs, openOutside, reminderLink } from './deliver';
import { reminderCopy as t } from './strings';
import './reminder.css';

// «Напоминание в календаре» (v0.5 package 20, a lazy chunk): the time (15-minute steps), the
// days (three presets, or chosen weekdays where some way makes the event on the phone) and the
// buttons this platform really has (platform/reminders.ts). «Настройки» shows it for the app's
// general reminder, the skill's sheet for that skill. The last time and days are remembered
// (the `reminder` setting, this device only) when a button is tapped: the app never learns
// whether the calendar kept the event.

export interface ReminderFormProps {
  /** Whose reminder: a skill's own title and link, or null for the app's general one. */
  skill: { id: string; name: string } | null;
  /** In a card on the page («Настройки») or bare in a sheet. */
  inCard?: boolean;
}

type Mode = ReminderPreset | 'custom';

/** The same button tapped again this soon, for the same time and days, is the same request (the browser is still opening). */
const DOUBLE_TAP_MS = 1000;

const WAY_LABEL: Record<ReminderWay, string> = { calendar: t.calendar, google: t.google, fileLink: t.file, download: t.file };
const WAY_HINT: Partial<Record<ReminderWay, string>> = { google: t.googleHint, fileLink: t.fileLinkHint, download: t.downloadHint };

export function ReminderForm({ skill, inCard = false }: ReminderFormProps) {
  const env = reminderEnv();
  const plan = reminderPlan(env);
  const stored = useLiveQuery(() => getSetting<unknown>('reminder', null).then(parseReminderChoice), []);
  // What the user picked here; until then the remembered choice (or the default while it loads).
  const [picked, setPicked] = useState<{ time: string; mode: Mode; custom: Weekday[] } | null>(null);
  const lastTap = useRef<{ key: string; at: number } | null>(null);
  const { showToast } = useToast();
  const timeId = useId();
  const daysId = useId();

  const base = stored ?? DEFAULT_REMINDER;
  // A remembered choice of weekdays where only the presets exist reads as «Каждый день».
  const baseMode: Mode = typeof base.days === 'string' ? base.days : plan.custom ? 'custom' : 'daily';
  const form = picked ?? { time: base.time, mode: baseMode, custom: daysOf(base.days) };
  const days = form.mode === 'custom' ? normalizeDays(form.custom) : form.mode;
  const valid = daysOf(days).length > 0;
  // The static file: the three day sets and the general title only.
  const staticOk = typeof days === 'string' && skill === null;
  const ways = plan.ways.filter((way) => !isStaticWay(way) || staticOk);
  const hidden = plan.ways.some(isStaticWay) && !staticOk ? (skill !== null ? t.fileOnlyGeneral : t.fileOnlyPresets) : null;

  const update = (next: Partial<typeof form>) => setPicked({ ...form, ...next });

  function pickMode(mode: Mode) {
    if (mode === form.mode) return;
    haptics.select();
    // «Свои дни» starts from the days shown so far.
    update(mode === 'custom' ? { mode, custom: daysOf(form.mode === 'custom' ? form.custom : form.mode) } : { mode });
  }

  function toggleDay(day: Weekday) {
    haptics.select();
    update({ custom: form.custom.includes(day) ? form.custom.filter((d) => d !== day) : [...form.custom, day].sort((a, b) => a - b) });
  }

  function add(way: ReminderWay) {
    if (!valid) return;
    const at = Date.now();
    const key = `${way} ${form.time} ${daysKey(days)}`;
    if (lastTap.current?.key === key && at - lastTap.current.at < DOUBLE_TAP_MS) return;
    lastTap.current = { key, at };
    const choice: ReminderChoice = { time: form.time, days };
    setSetting('reminder', choice).catch((error: unknown) => logError(error, 'reminder setting'));
    if (isStaticWay(way)) {
      // Only reachable with a preset (staticOk).
      openOutside(appFileUrl(staticReminderPath(days as ReminderPreset, form.time)), env.telegram, false);
      haptics.success();
      return;
    }
    const link = reminderLink(skill?.id ?? null, env.telegram, window.location.href);
    const event = reminderEvent({
      days,
      time: form.time,
      from: localDate(),
      title: skill ? t.event.skillTitle(skill.name) : t.event.title,
      description: t.event.description(link),
      link,
      skillId: skill?.id ?? null,
    });
    if (way === 'google') {
      openOutside(googleCalendarUrl(event), env.telegram, true);
    } else {
      downloadIcs(buildIcs(event, nowDate()), t.fileName(form.time));
      showToast(t.downloaded, { icon: 'download' });
    }
    haptics.success();
  }

  return (
    <div className="reminder-form">
      <div className={inCard ? 'card reminder-card' : 'reminder-fields'}>
        <label className="reminder-row" htmlFor={timeId}>
          <span className="reminder-label">{t.time}</span>
          <select
            id={timeId}
            className="input reminder-time"
            value={form.time}
            onChange={(event) => {
              haptics.select();
              update({ time: event.target.value });
            }}
          >
            {REMINDER_TIMES.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
        <div className="reminder-days">
          <span className="reminder-label" id={daysId}>
            {t.days}
          </span>
          <div className="chips reminder-presets" role="group" aria-labelledby={daysId}>
            {[...REMINDER_PRESETS, ...(plan.custom ? (['custom'] as const) : [])].map((mode) => (
              <button key={mode} type="button" className="chip" aria-pressed={form.mode === mode} onClick={() => pickMode(mode)}>
                {mode === 'custom' ? t.custom : t.preset[mode]}
              </button>
            ))}
          </div>
          {form.mode === 'custom' && (
            <div className="weekday-chips" role="group" aria-label={t.weekdays}>
              {copy.today.weekdaysShort.map((short, i) => {
                const day = (i + 1) as Weekday;
                return (
                  <button
                    key={day}
                    type="button"
                    className="weekday-chip"
                    aria-pressed={form.custom.includes(day)}
                    aria-label={copy.stepForm.weekdayNames[i]}
                    onClick={() => toggleDay(day)}
                  >
                    {short}
                  </button>
                );
              })}
            </div>
          )}
          {!valid && (
            <p className="hint small field-hint is-warning" aria-live="polite">
              {t.noDays}
            </p>
          )}
        </div>
      </div>
      <div className="reminder-ways">
        {ways.map((way, i) => (
          <div key={way} className="reminder-way">
            <button type="button" className={`button button-block ${i === 0 ? 'button-primary' : 'button-secondary'}`} disabled={!valid} onClick={() => add(way)}>
              <Icon name={way === 'fileLink' || way === 'download' ? 'download' : 'calendar'} size={20} />
              {WAY_LABEL[way]}
            </button>
            {WAY_HINT[way] && <p className="reminder-hint">{WAY_HINT[way]}</p>}
          </div>
        ))}
        {hidden && <p className="reminder-hint">{hidden}</p>}
        {env.os === 'ios' && !env.telegram && <p className="reminder-hint">{t.linkTelegram}</p>}
      </div>
      <p className="reminder-note">{t.note}</p>
    </div>
  );
}
