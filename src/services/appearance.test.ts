import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { setClock } from '../lib/clock';
import { installFreshDb, tickingClock, todayNoon } from '../test/harness';
import { normalizeColor, normalizeTheme } from '../domain/appearance';
import { verifyJournal } from './journal';
import { archiveSkill, restartSkill } from './lifecycle';
import { getSkillDetails } from './queries';
import { completeStep, createSkill, createStep, setSkillAppearance, updateSkill, ValidationError, type SkillInput } from './skills';

// «Оформление» (package 11): the progress theme and the colour of a skill. Presentation only:
// nothing in the journal, progress or milestone depends on it.

const english: SkillInput = {
  name: 'Английский',
  description: '',
  startLabel: 'B1',
  targetLabel: 'C1',
  milestoneName: 'Достичь C1',
  milestoneTarget: 3,
  capacityBase: 10,
  capacityIncrement: 5,
  manualCapacities: [],
};

installFreshDb();
beforeEach(() => setClock(tickingClock(todayNoon())));

describe('a new skill', () => {
  it('is a flask «Как в теме» unless the form chose otherwise', async () => {
    const plain = await createSkill(english);
    expect(await db.skills.get(plain)).toMatchObject({ theme: 'flask', color: null });
    const pizza = await createSkill({ ...english, name: 'Пицца', theme: 'pizza', color: 'coral' });
    expect(await db.skills.get(pizza)).toMatchObject({ theme: 'pizza', color: 'coral' });
  });

  it('refuses a theme or colour that does not exist', async () => {
    await expect(createSkill({ ...english, theme: 'comet' as never })).rejects.toThrow(ValidationError);
    await expect(createSkill({ ...english, color: 'ultramarine' as never })).rejects.toThrow(ValidationError);
    expect(await db.skills.count()).toBe(0);
  });
});

describe('updateSkill', () => {
  it('changes the appearance with the form and keeps it when the form leaves it out', async () => {
    const id = await createSkill({ ...english, theme: 'book', color: 'violet' });
    await updateSkill(id, { ...english, name: 'Английский язык' });
    expect(await db.skills.get(id)).toMatchObject({ name: 'Английский язык', theme: 'book', color: 'violet' });
    await updateSkill(id, { ...english, theme: 'rocket', color: null });
    expect(await db.skills.get(id)).toMatchObject({ theme: 'rocket', color: null });
  });
});

describe('setSkillAppearance', () => {
  it('saves at once and changes nothing of the progress', async () => {
    const id = await createSkill(english);
    const step = await createStep({ skillId: id, name: 'Разговор', points: 4 });
    for (let i = 0; i < 4; i++) await completeStep(step);
    const before = await getSkillDetails(id);
    const rows = await db.transactions.count();

    await setSkillAppearance(id, { theme: 'car', color: 'teal' });
    const after = await getSkillDetails(id);
    expect(after?.skill).toMatchObject({ theme: 'car', color: 'teal' });
    expect(after?.progress).toEqual(before?.progress);
    expect(after?.milestone).toEqual(before?.milestone);
    expect(await db.transactions.count()).toBe(rows);
    expect(await verifyJournal()).toEqual([]);
  });

  it('is refused for an archived skill (read-only) and for unknown values', async () => {
    const id = await createSkill(english);
    await expect(setSkillAppearance(id, { theme: 'comet' as never, color: null })).rejects.toThrow(ValidationError);
    await expect(setSkillAppearance(id, { theme: 'flask', color: 'ultramarine' as never })).rejects.toThrow(ValidationError);
    await archiveSkill(id);
    await expect(setSkillAppearance(id, { theme: 'pizza', color: null })).rejects.toThrow('Навык не активен');
    expect(await db.skills.get(id)).toMatchObject({ theme: 'flask', color: null });
  });

  it('writes only the field given: a newer release’s theme key survives a colour change', async () => {
    const id = await createSkill(english);
    // Restored from a backup of a newer release that knows a «comet».
    await db.skills.update(id, { theme: 'comet' as never });
    await setSkillAppearance(id, { color: 'teal' });
    expect(await db.skills.get(id)).toMatchObject({ theme: 'comet', color: 'teal' });
    await updateSkill(id, { ...english, color: 'amber' });
    expect(await db.skills.get(id)).toMatchObject({ theme: 'comet', color: 'amber' });
    await setSkillAppearance(id, { theme: 'moon' });
    expect(await db.skills.get(id)).toMatchObject({ theme: 'moon', color: 'amber' });
  });
});

describe('restartSkill', () => {
  it('copies the theme and the colour', async () => {
    const id = await createSkill({ ...english, theme: 'flower', color: 'rose' });
    await archiveSkill(id);
    const copy = await restartSkill(id);
    expect(await db.skills.get(copy)).toMatchObject({ theme: 'flower', color: 'rose', originSkillId: id });
  });
});

describe('reading a stored appearance', () => {
  it('falls back to the flask and «Как в теме» for values this build does not know', () => {
    expect(normalizeTheme('pizza')).toBe('pizza');
    expect(normalizeTheme('comet')).toBe('flask');
    expect(normalizeTheme(undefined)).toBe('flask');
    expect(normalizeTheme(42)).toBe('flask');
    expect(normalizeColor('coral')).toBe('coral');
    expect(normalizeColor('ultramarine')).toBeNull();
    expect(normalizeColor(null)).toBeNull();
  });
});
