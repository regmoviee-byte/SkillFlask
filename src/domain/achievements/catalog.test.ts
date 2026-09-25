import { describe, expect, it } from 'vitest';
import { BADGES, CATALOG, LADDERS } from './catalog';

const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|вернул|баллы|балл\b|баллов/i;
const CYRILLIC = /[А-Яа-яЁё]/;

/** Every user-facing string of the catalogue, with where it comes from. */
function strings(): [string, string][] {
  const out: [string, string][] = [];
  for (const ladder of LADDERS) {
    out.push([`${ladder.id}.title`, ladder.title], [`${ladder.id}.description`, ladder.description], [`${ladder.id}.howTo`, ladder.howTo]);
    ladder.unit.forEach((form, i) => out.push([`${ladder.id}.unit[${i}]`, form]));
  }
  for (const def of CATALOG) {
    out.push([`${def.id}.title`, def.title], [`${def.id}.description`, def.description], [`${def.id}.howTo`, def.howTo]);
  }
  return out;
}

describe('achievement catalogue', () => {
  it('has 8 ladders with 37 tiers and 12 badges: 49 entries with unique ids', () => {
    expect(LADDERS).toHaveLength(8);
    expect(LADDERS.reduce((n, l) => n + l.tiers.length, 0)).toBe(37);
    expect(BADGES).toHaveLength(12);
    expect(CATALOG).toHaveLength(49);
    expect(new Set(CATALOG.map((d) => d.id)).size).toBe(49);
    expect(new Set(LADDERS.map((l) => l.id)).size).toBe(8);
  });

  it('counts hours of timed practice and has the marathon badge', () => {
    const hours = LADDERS.find((l) => l.id === 'hours')!;
    expect(hours).toMatchObject({ title: 'Часы практики', unit: ['час', 'часа', 'часов'] });
    expect(hours.tiers.map((t) => [t.target, t.rarity])).toEqual([
      [1, 'BRONZE'],
      [10, 'SILVER'],
      [50, 'GOLD'],
      [100, 'GOLD'],
    ]);
    expect(CATALOG.find((d) => d.id === 'hours-10')!.description).toBe('10 часов практики');
    expect(CATALOG.find((d) => d.id === 'marathon')).toMatchObject({ title: 'Марафон', rarity: 'GOLD', target: 60, description: 'Одно выполнение длиной час и больше' });
  });

  it('has whole targets of at least 1 and strictly increasing ladder tiers', () => {
    for (const def of CATALOG) {
      expect(Number.isInteger(def.target), def.id).toBe(true);
      expect(def.target, def.id).toBeGreaterThanOrEqual(1);
    }
    for (const ladder of LADDERS) {
      const targets = ladder.tiers.map((t) => t.target);
      expect(targets.every((t, i) => i === 0 || t > targets[i - 1]!), ladder.id).toBe(true);
    }
  });

  it('generates tier ids, titles and indexes from the ladder', () => {
    const tier = CATALOG.find((d) => d.id === 'days-30')!;
    expect(tier).toMatchObject({ kind: 'TIER', ladderId: 'days', tierIndex: 2, title: 'Дни с практикой · 30', rarity: 'SILVER', target: 30 });
    expect(tier.description).toBe('30 дней с практикой');
    expect(CATALOG.find((d) => d.id === 'actions-1000')!.title).toBe('Действия · 1 000');
    expect(CATALOG.find((d) => d.id === 'completed-1')!.description).toBe('1 навык доведён до конца');
    expect(CATALOG.find((d) => d.id === 'completed-3')!.description).toBe('3 навыка доведены до конца');
    expect(CATALOG.find((d) => d.id === 'flasks-25')!.description).toBe('25 пройденных уровней');
  });

  it('writes every string in Russian, without forbidden words, exclamation marks or emoji', () => {
    const all = strings();
    for (const [path, text] of all) {
      expect(text.trim().length, path).toBeGreaterThan(0);
      expect(CYRILLIC.test(text), path).toBe(true);
    }
    expect(all.filter(([, text]) => FORBIDDEN.test(text))).toEqual([]);
    expect(all.filter(([, text]) => /[!\u{1F300}-\u{1FAFF}]/u.test(text))).toEqual([]);
  });

  it('never describes a current streak, only the record', () => {
    const series = LADDERS.find((l) => l.id === 'series')!;
    expect(series.howTo).toBe('Личный рекорд дней подряд. Рекорд остаётся навсегда.');
    expect(strings().filter(([, text]) => /текущ/i.test(text))).toEqual([]);
  });
});
