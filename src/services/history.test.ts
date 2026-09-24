import { beforeEach, describe, expect, it } from 'vitest';
import { isTransactionEvent } from '../domain/events';
import { setClock } from '../lib/clock';
import { installFreshDb, tickingClock, todayNoon } from '../test/harness';
import { completeStep } from './completions';
import { getSkillHistory } from './history';
import { createSkill } from './skills';
import { createStep } from './steps';

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));

async function skillWith(completions: number) {
  const skillId = await createSkill({
    name: 'Чтение',
    description: '',
    startLabel: '',
    targetLabel: '',
    milestoneName: 'Главная цель',
    milestoneTarget: 2,
    capacityBase: 10,
    capacityIncrement: 0,
    manualCapacities: [],
  });
  const stepId = await createStep({ skillId, name: 'Глава', points: 5 });
  for (let i = 0; i < completions; i++) await completeStep(stepId);
  return skillId;
}

describe('getSkillHistory', () => {
  it('pages by 20 operations and keeps the moments an operation caused with it', async () => {
    const skillId = await skillWith(25);
    const page = (await getSkillHistory(skillId))!;
    expect(page.operations).toBe(25);
    expect(page.hasMore).toBe(true);
    expect(page.events.filter(isTransactionEvent)).toHaveLength(20);
    // Newest first: every separator sits right above the operation that caused it.
    page.events.forEach((event, i) => {
      if (!isTransactionEvent(event)) expect(page.events.slice(i).find(isTransactionEvent)?.id).toBe(event.id.split(':')[0]);
    });
    expect(page.events[page.events.length - 1] && isTransactionEvent(page.events[page.events.length - 1]!)).toBe(true);

    const all = (await getSkillHistory(skillId, 40))!;
    expect(all.hasMore).toBe(false);
    expect(all.events.at(-1)?.type).toBe('SKILL_CREATED');
    // 25 × 5 = 125 points in flasks of 10: 12 level-ups; the milestone of 2 flasks once.
    expect(all.events.filter((e) => e.type === 'LEVEL_UP')).toHaveLength(12);
    expect(all.events.filter((e) => e.type === 'MILESTONE_REACHED')).toHaveLength(1);
  });

  it('is null for a missing skill and empty of operations for a new one', async () => {
    expect(await getSkillHistory('nope')).toBeNull();
    const skillId = await skillWith(0);
    expect(await getSkillHistory(skillId)).toMatchObject({ operations: 0, hasMore: false, events: [{ type: 'SKILL_CREATED' }] });
  });
});
