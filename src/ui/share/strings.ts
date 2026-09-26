// The words of «Поделиться прогрессом» (v0.5 package 19), in its lazy chunk: the sheet and the
// card picture. The menu item and the chunk's fallback toast are in the first paint (copy.ts).
// copy.test.ts walks this object; the card speaks the skill's own level nouns (levelCopy).

import { formatDate } from '../../lib/dates';
import { formatNumber, formatPoints, plural } from '../../lib/format';
import { keepNumbers, type LevelCopy } from '../copy';

const RUN: [string, string, string] = ['день подряд', 'дня подряд', 'дней подряд'];
const RUN_WITH_PAUSE: [string, string, string] = ['день с паузой', 'дня с паузой', 'дней с паузой'];
const ACTIVE_DAYS: [string, string, string] = ['активный день', 'активных дня', 'активных дней'];

export const shareCopy = Object.freeze({
  title: 'Поделиться прогрессом',
  preparing: 'Готовим картинку…',
  failed: 'Картинка не получилась. Ссылку можно отправить и так.',
  /** The preview's accessible name. */
  imageLabel: (skillName: string) => `Карточка прогресса: ${skillName}`,
  /** The system share sheet with the picture (Web Share with files). */
  shareImage: 'Поделиться картинкой',
  /** A browser without Web Share: the picture is downloaded. */
  saveImage: 'Сохранить картинку',
  /** Telegram on iOS: the WebView's own menu of a long press saves the picture. */
  holdHint: 'Нажмите и удерживайте картинку, чтобы сохранить',
  /** Telegram on a computer (desktop apps, Telegram Web): the context menu saves the picture. */
  rightClickHint: 'Щёлкните картинку правой кнопкой мыши, чтобы сохранить',
  /** Telegram on Android: nothing in the mini app can save a picture without a server. */
  screenshotHint: 'Картинку отсюда не сохранить: сделайте снимок экрана или отправьте ссылку в чат',
  /** Telegram: the chat picker with the app's link (startapp to the skill) and one line about it. */
  sendLink: 'Отправить ссылку в чат',
  /** A browser with Web Share: the link and the line. */
  shareLink: 'Поделиться ссылкой',
  /** A browser without it. */
  copyLink: 'Скопировать ссылку',
  /** The clipboard refused: the link is shown to copy by hand (the app's, see appShareLink). */
  linkField: 'Ссылка на Skill Flask',
  shareFailed: 'Не получилось открыть «Поделиться» — сохраните картинку или отправьте ссылку',
  fileName: (date: string) => `skill-flask-${date}.png`,
  /** The one line that goes with the link or the picture. */
  message: (lc: LevelCopy, skillName: string, completed: boolean, levels: number, points: number) =>
    completed
      ? `Навык «${skillName}» достигнут: ${lc.levels(levels)}`
      : levels > 0
        ? `Уже ${lc.levels(levels)} в навыке «${skillName}»`
        : points > 0
          ? `Уже ${formatPoints(points)} в навыке «${skillName}»`
          : `Начинаю навык «${skillName}» в Skill Flask`,
  card: {
    /** The eyebrow over the number of a completed skill. */
    reached: 'Навык достигнут',
    /** Under the number of a completed skill: «5 колб · 12 сентября». */
    reachedDetail: (levels: string, date: string) => `${levels} · ${keepNumbers(formatDate(date))}`,
    capacity: (capacity: number) => ` / ${formatNumber(capacity)}`,
    total: (points: number) => `Всего ${formatPoints(points)}`,
    /** «2 из 5 колб до цели «B2»»: the target label when the skill has one, the milestone's name otherwise. */
    milestone: (progress: string, targetLabel: string, name: string) =>
      targetLabel ? `${progress} до цели «${targetLabel}»` : `${progress} до вехи «${name}»`,
    milestoneReached: (targetLabel: string, name: string) => (targetLabel ? `Цель «${targetLabel}» достигнута` : `Веха «${name}» достигнута`),
    /** The best run of days: a count, «дней подряд» (or «с паузой» across the skill's rest), «лучшая серия». */
    streak: (days: number, bridged: boolean) => plural(days, bridged ? RUN_WITH_PAUSE : RUN),
    streakNote: 'лучшая серия',
    activeDays: (days: number) => plural(days, ACTIVE_DAYS),
    last30: 'за последние 30 дней',
    allTime: 'за всё время',
    brand: 'Skill Flask',
  },
});
