import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../../lib/clock';
import type { Milestone, Skill } from '../../domain/types';
import type { ShareCardData } from '../../services/shareCard';
import { cardModel, ellipsize, fitLines, printedLink, wrapLines, type Measure } from './cardLayout';

/** Every character is 10 px wide; a no-break space too. */
const mono: Measure = (text) => text.length * 10;
/** The same font, `size / 10` times larger. */
const monoAt = (size: number): Measure => (text) => text.length * size;

const skill = (over: Partial<Skill> = {}): Skill => ({
  id: 'skill-1',
  name: 'Английский',
  description: '',
  status: 'ACTIVE',
  startLabel: '',
  targetLabel: '',
  capacityBase: 100,
  capacityIncrement: 50,
  completedAt: null,
  archivedAt: null,
  originSkillId: null,
  theme: 'flask',
  color: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  ...over,
});

const milestone = (over: Partial<Milestone> = {}): Milestone => ({
  id: 'ms-1',
  skillId: 'skill-1',
  name: 'Свободный разговор',
  targetFlaskNumber: 5,
  reachedAt: null,
  decision: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  ...over,
});

const data = (over: Partial<ShareCardData> = {}): ShareCardData => ({
  skill: skill(),
  milestone: milestone(),
  // Two levels done (100 + 150), 45 of 200 in the third.
  progress: { totalPoints: 1295, completedFlasks: 2, currentFlask: 3, pointsInCurrentFlask: 45, currentCapacity: 200, fill: 0.225 },
  bestStreak: { days: 12, bridged: false },
  activeDays30: 18,
  activeDaysTotal: 40,
  pause: null,
  ...over,
});

const plain = (text: string) => text.replace(/\u00a0/g, ' ');

beforeEach(() => setClock(() => new Date('2026-09-26T12:00:00')));
afterEach(() => setClock(null));

describe('wrapLines', () => {
  it('breaks at spaces and keeps what fits on one line', () => {
    expect(wrapLines('Английский язык', 200, mono)).toEqual(['Английский язык']);
    expect(wrapLines('Английский язык для работы', 160, mono)).toEqual(['Английский язык', 'для работы']);
  });

  it('cuts a long name to two lines, the second ending with «…»', () => {
    const lines = wrapLines('Разговорный английский для путешествий и работы в команде', 200, mono, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Разговорный');
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(lines.every((line) => mono(line) <= 200)).toBe(true);
  });

  it('breaks a word wider than a line between its characters', () => {
    expect(wrapLines('Электрогитаростроение', 100, mono)).toEqual(['Электрогит', 'аростроени', 'е']);
    const cut = wrapLines('Электрогитаростроение', 100, mono, 2);
    expect(cut).toEqual(['Электрогит', 'аростроен…']);
  });

  it('never breaks at a no-break space («17 сентября» stays together)', () => {
    expect(wrapLines('с 17\u00a0сентября', 110, mono)).toEqual(['с', '17\u00a0сентября']);
  });

  it('returns nothing for an empty text', () => {
    expect(wrapLines('   ', 100, mono)).toEqual([]);
  });

  it('ellipsizes a line to its width', () => {
    expect(ellipsize('Шахматы вслепую', 80, mono)).toBe('Шахматы…');
    expect(ellipsize('Шахматы вслепую', 70, mono)).toBe('Шахмат…');
    expect(mono(ellipsize('Шахматы вслепую', 80, mono))).toBeLessThanOrEqual(80);
  });
});

describe('fitLines', () => {
  it('takes the largest size at which the text fits without «…»', () => {
    // 14 characters: two lines at 20 px per character, one line only at 10.
    expect(fitLines('Игра на гитаре', 200, 2, [20, 15, 10], monoAt)).toEqual({ size: 20, lines: ['Игра на', 'гитаре'] });
    expect(fitLines('Игра на гитаре', 200, 1, [20, 15, 10], monoAt)).toEqual({ size: 10, lines: ['Игра на гитаре'] });
    expect(fitLines('Бег', 200, 2, [20, 15, 10], monoAt)).toEqual({ size: 20, lines: ['Бег'] });
  });

  it('cuts at the smallest size when nothing fits', () => {
    const fit = fitLines('Очень длинное название навыка, которое не помещается никак', 100, 2, [20, 10], monoAt);
    expect(fit.size).toBe(10);
    expect(fit.lines).toHaveLength(2);
    expect(fit.lines[1]!.endsWith('…')).toBe(true);
  });
});

describe('cardModel', () => {
  it('speaks the skill’s level in its theme’s nouns, with the numbers formatted', () => {
    const model = cardModel(data({ skill: skill({ theme: 'pizza' }) }), 'https://t.me/SkillFlaskBot/app');
    expect(model.theme).toBe('pizza');
    expect(model.eyebrow).toBe('Пицца');
    expect(model.level).toBe('3');
    expect(model.points).toEqual({ value: '45', capacity: ' / 200' });
    expect(plain(model.detail)).toBe('22% · ещё 155 до пиццы 4');
    expect(plain(model.total)).toBe('Всего 1 295 очков');
    expect(model.total).toContain('1\u00a0295');
    expect(model.hero).toEqual({ fill: 0.225, level: 3, state: 'active', capacity: 200 });
    expect(model.link).toBe('t.me/SkillFlaskBot/app');
    expect(model.brand).toBe('Skill Flask');
  });

  it('shows the milestone: the target label when there is one, the milestone’s name otherwise', () => {
    expect(cardModel(data({ skill: skill({ targetLabel: 'B2' }) }), '').milestone).toEqual({ text: '2 из 5 колб до цели «B2»', share: 0.4 });
    expect(cardModel(data(), '').milestone).toEqual({ text: '2 из 5 колб до вехи «Свободный разговор»', share: 0.4 });
    const reached = cardModel(data({ milestone: milestone({ targetFlaskNumber: 2, reachedAt: '2026-09-20T10:00:00.000Z' }) }), '');
    expect(reached.milestone).toEqual({ text: 'Веха «Свободный разговор» достигнута', share: 1 });
    expect(cardModel(data({ milestone: undefined }), '').milestone).toBeNull();
  });

  it('shows the best run and the active days of the last month as tiles', () => {
    const model = cardModel(data({ bestStreak: { days: 1240, bridged: false } }), '');
    expect(model.tiles).toEqual([
      { value: '1\u00a0240', caption: 'дней подряд', note: 'лучшая серия' },
      { value: '18', caption: 'активных дней', note: 'за последние 30 дней' },
    ]);
    expect(cardModel(data({ bestStreak: { days: 3, bridged: true }, activeDays30: 1 }), '').tiles).toEqual([
      { value: '3', caption: 'дня с паузой', note: 'лучшая серия' },
      { value: '1', caption: 'активный день', note: 'за последние 30 дней' },
    ]);
  });

  it('describes the past by what happened: all-time days when the month had none, no tile of zeros', () => {
    expect(cardModel(data({ bestStreak: null, activeDays30: 0, activeDaysTotal: 21 }), '').tiles).toEqual([
      { value: '21', caption: 'активный день', note: 'за всё время' },
    ]);
    expect(cardModel(data({ bestStreak: null, activeDays30: 0, activeDaysTotal: 0 }), '').tiles).toEqual([]);
  });

  it('names the pause or the labels under the name', () => {
    expect(plain(cardModel(data({ pause: { id: 'p', skillId: 'skill-1', from: '2026-09-25', until: '2026-10-10', createdAt: '', endedAt: null } }), '').status!)).toBe(
      'На паузе до 10 октября',
    );
    expect(cardModel(data({ skill: skill({ startLabel: 'B1', targetLabel: 'B2' }) }), '').status).toBe('B1 → B2');
    expect(cardModel(data(), '').status).toBeNull();
  });

  it('shows a completed skill with its levels and its date, in gold', () => {
    const model = cardModel(
      data({
        skill: skill({ status: 'COMPLETED', completedAt: '2026-09-12T10:00:00.000Z', theme: 'book' }),
        progress: { totalPoints: 1000, completedFlasks: 5, currentFlask: 6, pointsInCurrentFlask: 0, currentCapacity: 350, fill: 0 },
      }),
      '',
    );
    expect(model.eyebrow).toBe('Навык достигнут');
    expect(model.level).toBe('5');
    expect(model.points).toBeNull();
    expect(plain(model.detail)).toBe('5 книг · 12 сентября');
    expect(model.milestone).toBeNull();
    expect(model.hero.state).toBe('complete');
    expect(model.message).toBe('Навык «Английский» достигнут: 5 книг');
  });

  it('writes the one line of the message from the levels or the points', () => {
    expect(cardModel(data(), '').message).toBe('Уже 2 колбы в навыке «Английский»');
    expect(cardModel(data({ skill: skill({ theme: 'car' }) }), '').message).toBe('Уже 2 поездки в навыке «Английский»');
    const first = { totalPoints: 45, completedFlasks: 0, currentFlask: 1, pointsInCurrentFlask: 45, currentCapacity: 100, fill: 0.45 };
    expect(cardModel(data({ progress: first }), '').message).toBe('Уже 45 очков в навыке «Английский»');
    const none = { ...first, totalPoints: 0, pointsInCurrentFlask: 0, fill: 0 };
    const empty = cardModel(data({ progress: none }), '');
    expect(empty.message).toBe('Начинаю навык «Английский» в Skill Flask');
    expect(empty.hero.state).toBe('empty');
  });
});

describe('printedLink', () => {
  it('drops the scheme and a trailing slash', () => {
    expect(printedLink('https://t.me/SkillFlaskBot/app')).toBe('t.me/SkillFlaskBot/app');
    expect(printedLink('https://t.me/other_bot/')).toBe('t.me/other_bot');
  });
});
