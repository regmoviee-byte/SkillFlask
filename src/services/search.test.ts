import { beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../lib/clock';
import type { SearchHit } from './search';
import { installFreshDb, tickingClock } from '../test/harness';
import { cancelCompletion, completeStep } from './completions';
import { archiveSkill } from './lifecycle';
import { createMark } from './marks';
import { isEmptySearch, searchAllHistory, searchSkillHistory } from './search';
import { createSkill, type SkillInput } from './skills';
import { createStep, updateStep } from './steps';

installFreshDb();
beforeEach(() => setClock(tickingClock('2026-09-20T12:00:00')));

const input = (name: string): SkillInput => ({
  name,
  description: '',
  startLabel: '',
  targetLabel: '',
  milestoneName: 'Цель',
  milestoneTarget: 10,
  capacityBase: 10,
  capacityIncrement: 0,
  manualCapacities: [],
});

/** What a hit shows first: the step name as recorded, or the mark's title. */
const label = (hit: SearchHit) => (hit.type === 'MARK' ? `mark:${hit.mark.title}` : `${hit.completion!.stepName}|${hit.completion!.note ?? ''}`);

async function english() {
  const skillId = await createSkill(input('Английский'));
  const talk = await createStep({ skillId, name: 'Разговорная практика', points: 5 });
  const read = await createStep({ skillId, name: 'Чтение', points: 3 });
  const first = (await completeStep(talk, { note: 'Говорили про путешествия', date: '2026-09-18' })).completionId;
  const second = (await completeStep(read, { note: 'Ёжик в тумане, вслух', date: '2026-09-19' })).completionId;
  const third = (await completeStep(talk)).completionId;
  await createMark(skillId, { title: 'Пробный тест', description: 'Вышло B2 по чтению', date: '2026-09-19' });
  return { skillId, talk, read, first, second, third };
}

describe('searchSkillHistory', () => {
  it('finds completions by the recorded step name and by the note, newest first', async () => {
    const { skillId } = await english();
    const byName = await searchSkillHistory(skillId, { query: 'разговорная', filter: 'all' });
    expect(byName?.events.map(label)).toEqual(['Разговорная практика|', 'Разговорная практика|Говорили про путешествия']);
    expect(byName?.total).toBe(2);
    const byNote = await searchSkillHistory(skillId, { query: 'ПУТЕШЕСТВ', filter: 'all' });
    expect(byNote?.events.map(label)).toEqual(['Разговорная практика|Говорили про путешествия']);
    // Each hit is the history event with the flask after it, as the timeline draws it.
    expect(byNote?.events[0]).toMatchObject({ type: 'COMPLETION', date: '2026-09-18', after: { totalPoints: 5 } });
  });

  it('reads «ё» as «е» and needs every word', async () => {
    const { skillId } = await english();
    expect((await searchSkillHistory(skillId, { query: 'ежик вслух', filter: 'all' }))?.events.map(label)).toEqual(['Чтение|Ёжик в тумане, вслух']);
    expect((await searchSkillHistory(skillId, { query: 'ежик футбол', filter: 'all' }))?.total).toBe(0);
  });

  it('finds marks by title and description', async () => {
    const { skillId } = await english();
    expect((await searchSkillHistory(skillId, { query: 'пробный', filter: 'all' }))?.events.map(label)).toEqual(['mark:Пробный тест']);
    // «чтени» is in the mark's description and in the step «Чтение»; on the same day the mark,
    // written later, comes first.
    expect((await searchSkillHistory(skillId, { query: 'чтени', filter: 'all' }))?.events.map(label)).toEqual(['mark:Пробный тест', 'Чтение|Ёжик в тумане, вслух']);
  });

  it('filters to completions with a note, or to marks, with or without words', async () => {
    const { skillId } = await english();
    expect((await searchSkillHistory(skillId, { query: '', filter: 'notes' }))?.events.map(label)).toEqual([
      'Чтение|Ёжик в тумане, вслух',
      'Разговорная практика|Говорили про путешествия',
    ]);
    expect((await searchSkillHistory(skillId, { query: 'разговорная', filter: 'notes' }))?.total).toBe(1);
    expect((await searchSkillHistory(skillId, { query: '', filter: 'marks' }))?.events.map(label)).toEqual(['mark:Пробный тест']);
    expect((await searchSkillHistory(skillId, { query: 'чтени', filter: 'marks' }))?.events.map(label)).toEqual(['mark:Пробный тест']);
  });

  it('keeps the name a completion was recorded with after the step is renamed', async () => {
    const { skillId, talk } = await english();
    await updateStep(talk, { name: 'Разговор с носителем' });
    await completeStep(talk);
    expect((await searchSkillHistory(skillId, { query: 'практика', filter: 'all' }))?.total).toBe(2);
    expect((await searchSkillHistory(skillId, { query: 'носителем', filter: 'all' }))?.total).toBe(1);
  });

  it('lists a cancelled completion as it stays in the history, but not the rows it caused', async () => {
    const { skillId, first } = await english();
    await cancelCompletion(first);
    const result = await searchSkillHistory(skillId, { query: 'путешествия', filter: 'all' });
    expect(result?.events.map((e) => [e.type, e.type === 'COMPLETION' ? e.completion?.status : null])).toEqual([['COMPLETION', 'CANCELLED']]);
  });

  it('pages the hits and counts them all', async () => {
    const skillId = await createSkill(input('Бег'));
    const run = await createStep({ skillId, name: 'Пробежка', points: 1 });
    for (let i = 0; i < 7; i++) await completeStep(run);
    const page = await searchSkillHistory(skillId, { query: 'пробежка', filter: 'all', limit: 5 });
    expect(page).toMatchObject({ total: 7, hasMore: true });
    expect(page?.events).toHaveLength(5);
    expect((await searchSkillHistory(skillId, { query: 'пробежка', filter: 'all', limit: 10 }))?.hasMore).toBe(false);
  });

  it('asks nothing without words and filter, and is null for a missing skill', async () => {
    const { skillId } = await english();
    expect(isEmptySearch('  ', 'all')).toBe(true);
    expect(isEmptySearch('', 'notes')).toBe(false);
    expect(await searchSkillHistory(skillId, { query: ' ', filter: 'all' })).toEqual({ events: [], total: 0, hasMore: false });
    expect(await searchSkillHistory('nope', { query: 'бег', filter: 'all' })).toBeNull();
  });
});

describe('searchAllHistory', () => {
  it('groups hits by skill, the skill with the latest hit first, archived skills included', async () => {
    const { skillId: englishId } = await english();
    const guitarId = await createSkill(input('Гитара'));
    const chords = await createStep({ skillId: guitarId, name: 'Аккорды', points: 2 });
    await completeStep(chords, { note: 'Разучил практику баррэ', date: '2026-09-10' });
    await archiveSkill(guitarId);

    const result = await searchAllHistory({ query: 'практик', filter: 'all' });
    expect(result.groups.map((g) => g.skill.id)).toEqual([englishId, guitarId]);
    expect(result.groups.map((g) => g.events.map(label))).toEqual([
      ['Разговорная практика|', 'Разговорная практика|Говорили про путешествия'],
      ['Аккорды|Разучил практику баррэ'],
    ]);
    expect(result).toMatchObject({ total: 3, hasMore: false });
    expect((await searchAllHistory({ query: '', filter: 'marks' })).groups.map((g) => g.events.map(label))).toEqual([['mark:Пробный тест']]);
    expect((await searchAllHistory({ query: 'футбол', filter: 'all' })).groups).toEqual([]);
    expect((await searchAllHistory({ query: '', filter: 'all' })).groups).toEqual([]);
  });

  it('cuts after `limit` hits across the groups', async () => {
    await english();
    const result = await searchAllHistory({ query: '', filter: 'notes', limit: 1 });
    expect(result).toMatchObject({ total: 2, hasMore: true });
    expect(result.groups.flatMap((g) => g.events)).toHaveLength(1);
  });
});
