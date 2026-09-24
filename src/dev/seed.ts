// Deterministic demo data for screenshots and manual testing. Written through the real
// services, so the journal is valid and every screen shows what a month of use looks like.

import { setClock } from '../lib/clock';
import { addDays, localDate } from '../lib/dates';
import { completeStep, createSkill, createStep, type SkillInput } from '../services/skills';

export interface SeedOptions {
  /** How many past days to fill, ending today. */
  days?: number;
  /** PRNG seed; the same seed always produces the same journal. */
  seed?: number;
}

/** Mulberry32: small, deterministic, good enough for demo data. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const skills: { input: SkillInput; steps: { name: string; points: number }[] }[] = [
  {
    input: {
      name: 'Английский',
      description: '',
      startLabel: 'B1',
      targetLabel: 'C1',
      milestoneName: 'Достичь C1',
      milestoneTarget: 10,
      capacityBase: 100,
      capacityIncrement: 50,
      manualCapacities: [],
    },
    steps: [
      { name: 'Разговорная практика', points: 5 },
      { name: 'Чтение', points: 3 },
      { name: 'Сериал без субтитров', points: 2 },
    ],
  },
  {
    input: {
      name: 'Тренировки',
      description: '',
      startLabel: '',
      targetLabel: '',
      milestoneName: 'Главная цель',
      milestoneTarget: 5,
      capacityBase: 60,
      capacityIncrement: 20,
      manualCapacities: [],
    },
    steps: [
      { name: 'Зал', points: 10 },
      { name: 'Пробежка', points: 6 },
    ],
  },
  {
    input: {
      name: 'Автотесты',
      description: 'Покрыть проект тестами',
      startLabel: '',
      targetLabel: '',
      milestoneName: 'Главная цель',
      milestoneTarget: 3,
      capacityBase: 40,
      capacityIncrement: 10,
      manualCapacities: [],
    },
    steps: [
      { name: 'Написать тест', points: 4 },
      { name: 'Разобрать нестабильный тест', points: 3 },
    ],
  },
];

export interface SeedSummary {
  skillIds: string[];
  stepIds: string[];
  completions: number;
}

/** Creates 3 skills with 7 steps and completions on ~60 % of the last `days` days (1–4 per day). */
export async function seedDemoData({ days = 45, seed = 7 }: SeedOptions = {}): Promise<SeedSummary> {
  const random = prng(seed);
  const today = localDate();
  const start = addDays(today, -(days - 1));
  const skillIds: string[] = [];
  const stepIds: string[] = [];
  let completions = 0;

  const at = (date: string, hour: number, minute: number) => {
    const fixed = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
    setClock(() => fixed);
  };

  try {
    at(start, 9, 0);
    for (const { input, steps } of skills) {
      const skillId = await createSkill(input);
      skillIds.push(skillId);
      for (const step of steps) stepIds.push(await createStep({ skillId, ...step }));
    }

    for (let i = 0; i < days; i++) {
      const date = addDays(start, i);
      if (random() > 0.6) continue;
      const count = 1 + Math.floor(random() * 4);
      for (let k = 0; k < count; k++) {
        at(date, 8 + Math.floor(random() * 13), Math.floor(random() * 60));
        await completeStep(stepIds[Math.floor(random() * stepIds.length)], { date });
        completions += 1;
      }
    }
  } finally {
    setClock(null);
  }
  return { skillIds, stepIds, completions };
}

declare global {
  interface Window {
    __skillFlask?: { seed: (options?: SeedOptions) => Promise<SeedSummary> };
  }
}

/** Exposes `window.__skillFlask.seed()`; called from main.tsx only in DEV builds. */
export function installDevTools(): void {
  window.__skillFlask = { seed: seedDemoData };
}
