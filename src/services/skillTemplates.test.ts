import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { localDate } from '../lib/dates';
import { setClock } from '../lib/clock';
import { TEMPLATES, type SkillTemplate } from '../domain/templates';
import { installFreshDb, tickingClock, todayNoon } from '../test/harness';
import { getSkillDetails } from './queries';
import { createSkill, ValidationError, type NewStepInput, type SkillInput } from './skills';

// A new skill from a template (v0.5 package 16): the form hands createSkill the skill and the
// checked actions, written in one transaction.

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));

function inputOf(t: SkillTemplate): SkillInput {
  return {
    name: t.name,
    description: '',
    startLabel: t.startLabel,
    targetLabel: t.targetLabel,
    milestoneName: t.milestoneName,
    milestoneTarget: t.milestoneTarget,
    capacityBase: t.capacityBase,
    capacityIncrement: t.capacityIncrement,
    manualCapacities: [],
    theme: t.theme,
    color: t.color,
  };
}

const stepsOf = (t: SkillTemplate): NewStepInput[] => t.steps.map((s) => ({ ...s }));

const counts = async () => ({
  skills: await db.skills.count(),
  milestones: await db.milestones.count(),
  steps: await db.steps.count(),
});

describe('createSkill with the actions of a template', () => {
  it.each(TEMPLATES.map((t) => [t.key, t] as const))('%s passes the skill and step validators', async (_key, template) => {
    const id = await createSkill(inputOf(template), stepsOf(template));
    const details = (await getSkillDetails(id))!;
    expect(details.skill).toMatchObject({ name: template.name, theme: template.theme, color: template.color, capacityBase: template.capacityBase });
    expect(details.milestone).toMatchObject({ name: template.milestoneName, targetFlaskNumber: template.milestoneTarget });
    // The actions, in the template's order, planned from today on.
    expect(details.steps.map((s) => s.name)).toEqual(template.steps.map((s) => s.name));
    for (const [i, step] of details.steps.entries()) {
      const source = template.steps[i]!;
      expect(step).toMatchObject({ type: source.type, schedule: source.schedule, scheduleFrom: localDate(), isActive: true });
      if (source.type === 'TIMED') expect(step).toMatchObject({ pointsPerMinute: source.pointsPerMinute, defaultMinutes: source.defaultMinutes, points: 0 });
      else expect(step).toMatchObject({ points: source.points, pointsPerMinute: null, defaultMinutes: null });
    }
    // A template is only a starting point: nothing about it is stored on the skill.
    expect(Object.keys(details.skill).sort()).toEqual(
      ['id', 'name', 'description', 'status', 'startLabel', 'targetLabel', 'capacityBase', 'capacityIncrement', 'completedAt', 'archivedAt', 'originSkillId', 'theme', 'color', 'createdAt', 'updatedAt'].sort(),
    );
  });

  it('creates only the actions it is given (the checked ones)', async () => {
    const template = TEMPLATES.find((t) => t.key === 'running')!;
    const id = await createSkill(inputOf(template), [stepsOf(template)[1]!]);
    expect((await getSkillDetails(id))!.steps.map((s) => s.name)).toEqual(['Растяжка после бега']);
    const empty = await createSkill(inputOf(template));
    expect((await getSkillDetails(empty))!.steps).toEqual([]);
  });

  it('writes nothing when an action is invalid', async () => {
    const template = TEMPLATES.find((t) => t.key === 'running')!;
    const steps = stepsOf(template);
    steps[2] = { ...steps[2]!, pointsPerMinute: 0.001 };
    await expect(createSkill(inputOf(template), steps)).rejects.toThrow(ValidationError);
    steps[2] = { ...steps[2]!, pointsPerMinute: 0.5, name: '   ' };
    await expect(createSkill(inputOf(template), steps)).rejects.toThrow('Укажите название действия');
    expect(await counts()).toEqual({ skills: 0, milestones: 0, steps: 0 });
  });

  it('rolls the skill back when writing an action fails', async () => {
    const template = TEMPLATES.find((t) => t.key === 'running')!;
    // The third action's row fails inside the transaction, after the skill, its milestone and
    // two actions were written.
    let added = 0;
    const failThird = function () {
      if (++added === 3) throw new Error('disk full');
    };
    db.steps.hook('creating', failThird);
    try {
      await expect(createSkill(inputOf(template), stepsOf(template))).rejects.toThrow('disk full');
    } finally {
      db.steps.hook('creating').unsubscribe(failThird);
    }
    expect(added).toBe(3);
    expect(await counts()).toEqual({ skills: 0, milestones: 0, steps: 0 });
    expect(await db.levelThresholds.count()).toBe(0);
    // And the next attempt goes through as a whole.
    await createSkill(inputOf(template), stepsOf(template));
    expect(await counts()).toEqual({ skills: 1, milestones: 1, steps: 3 });
  });
});
