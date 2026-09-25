// Skill templates (v0.5 package 16): twelve ready skills with actions, points and schedules, so
// a new user gets a working skill in two taps instead of inventing capacities and points on an
// empty form. A template is only a starting point: the form opens prefilled, everything can be
// changed, and nothing about the template is stored on the skill (no templateId).
//
// Balance rule (templates.test.ts checks every template with the real capacity and points
// helpers): with the template's schedule done as planned — DAILY every day, WEEKDAYS on its
// days, «N раз в неделю» spread over the week (plannedWeekdays) — level 1 fills in 7–10 days,
// whatever weekday the skill starts on, and the milestone is reached in 2–4 months (60–122 days).
// Actions without a schedule (MANUAL) are extras and count for nothing in the plan. A TIMED
// action is planned at its usual minutes, so it must have them.
//
// This module is a lazy chunk (with the chooser and the form's «Действия из шаблона»); the keys
// alone are in the initial load (templateKeys.ts).

import type { ProgressThemeKey, SkillColor } from './appearance';
import { timedPoints, toDeci } from './points';
import { flaskCapacity, pointsToFill, type CapacityConfig } from './progression';
import type { StepSchedule, StepType, Weekday } from './types';
import { TEMPLATE_KEYS, type TemplateKey } from './templateKeys';

export { TEMPLATE_KEYS, type TemplateKey };

export interface TemplateStep {
  name: string;
  type: StepType;
  /** BOOLEAN: whole points per completion. */
  points?: number;
  /** TIMED: points per minute. */
  pointsPerMinute?: number;
  /** TIMED: the usual minutes, which the plan assumes. */
  defaultMinutes?: number;
  schedule: StepSchedule;
}

export interface SkillTemplate {
  key: TemplateKey;
  name: string;
  /** One line on the chooser's card. */
  description: string;
  startLabel: string;
  targetLabel: string;
  milestoneName: string;
  /** Levels to the milestone. */
  milestoneTarget: number;
  capacityBase: number;
  capacityIncrement: number;
  theme: ProgressThemeKey;
  color: SkillColor;
  /** 2–4 actions, all on by default in the form. */
  steps: readonly TemplateStep[];
}

const daily: StepSchedule = { kind: 'DAILY' };
const perWeek = (times: number): StepSchedule => ({ kind: 'TIMES_PER_WEEK', times });
const on = (...days: Weekday[]): StepSchedule => ({ kind: 'WEEKDAYS', days });
const manual: StepSchedule = { kind: 'MANUAL' };
const done = (name: string, points: number, schedule: StepSchedule): TemplateStep => ({ name, type: 'BOOLEAN', points, schedule });
const timed = (name: string, pointsPerMinute: number, defaultMinutes: number, schedule: StepSchedule): TemplateStep => ({
  name,
  type: 'TIMED',
  pointsPerMinute,
  defaultMinutes,
  schedule,
});

/** The catalogue, in the chooser's order (languages and music first, then body, mind, craft). */
export const TEMPLATES: readonly SkillTemplate[] = Object.freeze([
  {
    key: 'english',
    name: 'Английский',
    description: 'Или другой язык: слова, разговор, сериалы',
    startLabel: 'A2',
    targetLabel: 'B2',
    milestoneName: 'Уровень B2',
    milestoneTarget: 8,
    capacityBase: 100,
    capacityIncrement: 20,
    theme: 'puzzle',
    color: 'teal',
    steps: [
      done('Новые слова', 5, daily),
      timed('Разговорная практика', 0.5, 30, perWeek(2)),
      timed('Сериал или подкаст', 0.25, 40, perWeek(3)),
    ],
  },
  {
    key: 'guitar',
    name: 'Гитара',
    description: 'Аккорды, техника и любимые песни',
    startLabel: 'Первые аккорды',
    targetLabel: '10 песен',
    milestoneName: 'Сыграть 10 песен',
    milestoneTarget: 8,
    capacityBase: 110,
    capacityIncrement: 20,
    theme: 'flask',
    color: 'amber',
    steps: [
      timed('Практика', 0.5, 20, daily),
      done('Техника: переходы и бой', 5, on(1, 3, 5)),
      done('Разучить новую песню', 15, perWeek(1)),
    ],
  },
  {
    key: 'piano',
    name: 'Фортепиано',
    description: 'Гаммы, этюды и пьесы целиком',
    startLabel: 'Первые ноты',
    targetLabel: '5 пьес',
    milestoneName: 'Сыграть 5 пьес',
    milestoneTarget: 8,
    capacityBase: 110,
    capacityIncrement: 20,
    theme: 'pizza',
    color: 'rose',
    steps: [
      timed('Занятие за инструментом', 0.5, 30, perWeek(5)),
      done('Гаммы и арпеджио', 3, daily),
      done('Сыграть пьесу целиком', 10, perWeek(1)),
    ],
  },
  {
    key: 'vocal',
    name: 'Вокал',
    description: 'Дыхание, распевки и песни под запись',
    startLabel: '1 октава',
    targetLabel: '2 октавы',
    milestoneName: 'Две октавы',
    milestoneTarget: 8,
    capacityBase: 100,
    capacityIncrement: 20,
    theme: 'chick',
    color: 'coral',
    steps: [
      timed('Распевка', 0.5, 15, daily),
      done('Дыхательные упражнения', 3, daily),
      done('Спеть песню под запись', 10, perWeek(2)),
    ],
  },
  {
    key: 'running',
    name: 'Бег',
    description: 'Три пробежки в неделю и растяжка',
    startLabel: '5 км',
    targetLabel: '10 км',
    milestoneName: '10 км без остановки',
    milestoneTarget: 8,
    capacityBase: 100,
    capacityIncrement: 15,
    theme: 'car',
    color: 'sky',
    steps: [
      timed('Пробежка', 0.5, 30, perWeek(3)),
      done('Растяжка после бега', 5, perWeek(3)),
      timed('Длинная пробежка', 0.5, 60, on(6)),
    ],
  },
  {
    key: 'strength',
    name: 'Силовые тренировки',
    description: 'Тренировки, зарядка и шаги между ними',
    startLabel: '10 отжиманий',
    targetLabel: '30 отжиманий',
    milestoneName: '30 отжиманий подряд',
    milestoneTarget: 8,
    capacityBase: 100,
    capacityIncrement: 20,
    theme: 'climber',
    color: 'graphite',
    steps: [
      done('Тренировка', 20, perWeek(3)),
      done('Зарядка', 3, daily),
      done('10 000 шагов', 5, perWeek(3)),
    ],
  },
  {
    key: 'yoga',
    name: 'Йога и растяжка',
    description: 'Короткая практика каждый день',
    startLabel: 'Наклон до колен',
    targetLabel: 'Ладони на полу',
    milestoneName: 'Ладони на полу',
    milestoneTarget: 8,
    capacityBase: 100,
    capacityIncrement: 20,
    theme: 'flower',
    color: 'green',
    steps: [
      timed('Практика йоги', 0.5, 15, daily),
      done('Растяжка перед сном', 3, daily),
      timed('Длинная практика', 0.5, 45, on(7)),
    ],
  },
  {
    key: 'reading',
    name: 'Чтение',
    description: 'Немного страниц каждый день',
    startLabel: '0 книг',
    targetLabel: '6 книг',
    milestoneName: 'Прочитать 6 книг',
    milestoneTarget: 8,
    capacityBase: 90,
    capacityIncrement: 10,
    theme: 'book',
    color: 'violet',
    steps: [
      timed('Чтение', 0.5, 20, daily),
      done('Заметки о прочитанном', 5, perWeek(2)),
      done('Дочитать книгу', 20, manual),
    ],
  },
  {
    key: 'coding',
    name: 'Программирование',
    description: 'Практика, задачи и свой проект',
    startLabel: 'Основы',
    targetLabel: 'Свой проект',
    milestoneName: 'Запустить свой проект',
    milestoneTarget: 8,
    capacityBase: 100,
    capacityIncrement: 20,
    theme: 'rocket',
    color: 'sky',
    steps: [
      timed('Практика кода', 0.5, 30, perWeek(4)),
      done('Решить задачу', 5, perWeek(3)),
      done('Урок или глава курса', 10, perWeek(2)),
    ],
  },
  {
    key: 'drawing',
    name: 'Рисование',
    description: 'Наброски каждый день, рисунок на выходных',
    startLabel: 'Наброски',
    targetLabel: 'Портрет',
    milestoneName: 'Нарисовать портрет',
    milestoneTarget: 8,
    capacityBase: 100,
    capacityIncrement: 15,
    theme: 'rainbow',
    color: 'coral',
    steps: [
      done('Набросок', 5, daily),
      timed('Рисунок', 0.5, 30, perWeek(3)),
      done('Урок или разбор', 10, on(6)),
    ],
  },
  {
    key: 'meditation',
    name: 'Медитация',
    description: 'Несколько минут тишины каждый день',
    startLabel: '5 минут',
    targetLabel: '20 минут',
    milestoneName: '20 минут спокойно',
    milestoneTarget: 8,
    capacityBase: 100,
    capacityIncrement: 20,
    theme: 'moon',
    color: 'violet',
    steps: [
      timed('Медитация', 1, 10, daily),
      done('Три благодарности', 3, daily),
      done('Прогулка без телефона', 5, perWeek(1)),
    ],
  },
  {
    key: 'chess',
    name: 'Шахматы',
    description: 'Задачи, партии и теория',
    startLabel: 'Рейтинг 1000',
    targetLabel: 'Рейтинг 1400',
    milestoneName: 'Рейтинг 1400',
    milestoneTarget: 8,
    capacityBase: 100,
    capacityIncrement: 20,
    theme: 'tower',
    color: 'graphite',
    steps: [
      done('Шахматные задачи', 5, daily),
      done('Партия', 10, perWeek(4)),
      timed('Теория дебютов', 0.5, 20, perWeek(2)),
    ],
  },
] satisfies SkillTemplate[]);

export function templateByKey(key: string): SkillTemplate | null {
  return TEMPLATES.find((template) => template.key === key) ?? null;
}

// ---- Balance ----

/** What one completion of the step earns as planned: its points, or its usual minutes × rate. */
export function completionPoints(step: Pick<TemplateStep, 'type' | 'points' | 'pointsPerMinute' | 'defaultMinutes'>): number {
  if (step.type === 'BOOLEAN') return step.points ?? 0;
  return step.defaultMinutes && step.pointsPerMinute ? timedPoints(step.defaultMinutes, step.pointsPerMinute) : 0;
}

/**
 * The weekdays the planned week does a step on: the due days of DAILY and WEEKDAYS; a weekly
 * quota of N spread evenly from Monday (3 → пн, ср, пт; 2 → пн, чт); nothing for MANUAL and for a
 * monthly quota (no template uses one).
 */
export function plannedWeekdays(schedule: StepSchedule): Weekday[] {
  switch (schedule.kind) {
    case 'DAILY':
      return [1, 2, 3, 4, 5, 6, 7];
    case 'WEEKDAYS':
      return [...schedule.days];
    case 'TIMES_PER_WEEK': {
      const times = Math.min(schedule.times, 7);
      return Array.from({ length: times }, (_, i) => (1 + Math.floor((i * 7) / times)) as Weekday);
    }
    default:
      return [];
  }
}

export interface PlanBalance {
  /** Points of one planned week. */
  weekPoints: number;
  /** The day (1 = the start day) on which level 1 fills; Infinity when the plan earns nothing. */
  firstLevelDays: number;
  /** The day on which the milestone's last level fills. */
  milestoneDays: number;
}

/** Longer than any plan worth simulating: past it, the answer is Infinity. */
const HORIZON_DAYS = 3650;

/**
 * Days to level 1 and to the milestone when `steps` are done exactly as planned from a skill
 * started on `startWeekday`, with the skill's capacities, in exact tenths. The new-skill form
 * asks it too, with the checked actions as edited and the capacities as typed.
 */
export function planBalance(
  steps: readonly Pick<TemplateStep, 'type' | 'points' | 'pointsPerMinute' | 'defaultMinutes' | 'schedule'>[],
  config: CapacityConfig,
  milestoneTarget: number,
  startWeekday: Weekday = 1,
): PlanBalance {
  const byWeekday = Array<number>(8).fill(0);
  for (const step of steps) {
    const deci = toDeci(completionPoints(step));
    for (const day of plannedWeekdays(step.schedule)) byWeekday[day] += deci;
  }
  const weekDeci = byWeekday.reduce((sum, deci) => sum + deci, 0);
  const firstLevel = toDeci(flaskCapacity(1, config));
  const milestone = toDeci(pointsToFill(milestoneTarget, config));
  let firstLevelDays = Infinity;
  let milestoneDays = Infinity;
  let total = 0;
  if (weekDeci > 0) {
    for (let day = 1; day <= HORIZON_DAYS && milestoneDays === Infinity; day++) {
      total += byWeekday[((startWeekday - 1 + day - 1) % 7) + 1]!;
      if (firstLevelDays === Infinity && total >= firstLevel) firstLevelDays = day;
      if (total >= milestone) milestoneDays = day;
    }
  }
  return { weekPoints: weekDeci / 10, firstLevelDays, milestoneDays };
}

/** The capacities a template fills the form with. */
export function templateCapacities(template: SkillTemplate): CapacityConfig {
  return { base: template.capacityBase, increment: template.capacityIncrement, manual: [] };
}

/** planBalance of a whole template. */
export function templateBalance(template: SkillTemplate, startWeekday: Weekday = 1): PlanBalance {
  return planBalance(template.steps, templateCapacities(template), template.milestoneTarget, startWeekday);
}
