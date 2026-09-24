// The achievement catalogue of v0.3 (proposal 2.2): 8 ladders with 37 tiers and 12 badges,
// 49 entries («Часы практики» and «Марафон» came with timed steps in package 8). Rules read
// the replay stats only. Principles: nothing rewards opening the app, the time of day,
// calendar dates or a return after a break; nothing is taken away for a day without
// practice; no bonus points; no secrets. Rarity is a visual tone.
//
// Adding an entry: append a badge (or a tier to a ladder) with a new stable id, Russian
// title/description/howTo and a rule over Stats (extend stats.ts if the rule needs a new
// number). The next sync — any write or the next app start — unlocks it retroactively with the
// historical date at which its rule became true, quietly (it shows up with the tab's dot).
// Never reuse or rename an id: the ledger and backups refer to it.

import { formatNumber, plural } from '../../lib/format';
import type { AchievementDef, LadderDef, LadderId, Rarity } from './types';
import type { Stats } from './stats';

const B: Rarity = 'BRONZE';
const S: Rarity = 'SILVER';
const G: Rarity = 'GOLD';

const tiers = (...list: [number, Rarity][]) => list.map(([target, rarity]) => ({ target, rarity }));
const count = (n: number, forms: [string, string, string]) => `${formatNumber(n)} ${plural(n, forms)}`;

export const LADDERS: readonly LadderDef[] = [
  {
    id: 'actions',
    title: 'Действия',
    unit: ['выполнение', 'выполнения', 'выполнений'],
    icon: 'check-circle',
    description: 'Сколько всего отмечено выполнений.',
    howTo: 'Отмечайте выполнения действий в любом навыке. Отменённые выполнения не считаются.',
    tiers: tiers([10, B], [50, B], [100, S], [250, S], [500, G], [1000, G]),
    value: (s) => s.global.completions,
    tierDescription: (n) => count(n, ['выполнение', 'выполнения', 'выполнений']),
  },
  {
    id: 'days',
    title: 'Дни с практикой',
    unit: ['день', 'дня', 'дней'],
    icon: 'calendar-check',
    description: 'Разные дни, в которые было хотя бы одно выполнение.',
    howTo: 'День считается, если в нём есть хотя бы одно выполнение. Дни не обязаны идти подряд.',
    tiers: tiers([3, B], [10, B], [30, S], [60, S], [100, G], [200, G], [365, G]),
    value: (s) => s.global.activeDays,
    tierDescription: (n) => `${count(n, ['день', 'дня', 'дней'])} с практикой`,
  },
  {
    id: 'weeks',
    title: 'Недели в ритме',
    unit: ['неделя', 'недели', 'недель'],
    icon: 'infinity',
    description: 'Недели с понедельника по воскресенье, в которых три и более дня с практикой.',
    howTo: 'Неделя считается в ритме, если в ней три и более дня с практикой. Недели не обязаны идти подряд, пропуски ничего не отнимают.',
    tiers: tiers([1, B], [4, S], [12, S], [26, G], [52, G]),
    value: (s) => s.global.rhythmWeeks,
    tierDescription: (n) => `${count(n, ['неделя', 'недели', 'недель'])} в ритме`,
  },
  {
    id: 'series',
    title: 'Лучшая серия',
    unit: ['день', 'дня', 'дней'],
    icon: 'chain',
    description: 'Самая длинная цепочка дней подряд с практикой — личный рекорд.',
    howTo: 'Личный рекорд дней подряд. Рекорд остаётся навсегда.',
    tiers: tiers([3, B], [7, S], [14, G], [30, G]),
    value: (s) => s.global.bestDayStreak,
    tierDescription: (n) => `Рекорд: ${count(n, ['день', 'дня', 'дней'])} подряд`,
  },
  {
    id: 'hours',
    title: 'Часы практики',
    unit: ['час', 'часа', 'часов'],
    icon: 'hourglass',
    description: 'Время, отмеченное во временных действиях, в полных часах.',
    howTo: 'Считаются минуты временных действий. Отменённые выполнения не считаются.',
    tiers: tiers([1, B], [10, S], [50, G], [100, G]),
    value: (s) => Math.floor(s.global.totalMinutes / 60),
    tierDescription: (n) => `${count(n, ['час', 'часа', 'часов'])} практики`,
  },
  {
    id: 'flasks',
    title: 'Колбы',
    unit: ['колба', 'колбы', 'колб'],
    icon: 'flask-stack',
    description: 'Заполненные колбы всех навыков вместе.',
    howTo: 'Заполняйте колбы в любых навыках — считаются все, включая достигнутые и архивные навыки.',
    tiers: tiers([5, B], [10, S], [25, S], [50, G], [100, G]),
    value: (s) => s.global.totalCompletedFlasks,
    tierDescription: (n) => count(n, ['заполненная колба', 'заполненные колбы', 'заполненных колб']),
  },
  {
    id: 'milestones',
    title: 'Вехи',
    unit: ['веха', 'вехи', 'вех'],
    icon: 'flag',
    description: 'Навыки, в которых заполнено не меньше колб, чем задано вехой.',
    howTo: 'Заполните в навыке столько колб, сколько задано его вехой.',
    tiers: tiers([1, S], [3, G], [5, G]),
    value: (s) => s.global.milestonesReached,
    tierDescription: (n) => count(n, ['достигнутая веха', 'достигнутые вехи', 'достигнутых вех']),
  },
  {
    id: 'completed',
    title: 'Навыки достигнуты',
    unit: ['навык', 'навыка', 'навыков'],
    icon: 'trophy',
    description: 'Навыки, доведённые до конца.',
    howTo: 'Достигните вехи навыка и нажмите «Завершить навык».',
    tiers: tiers([1, G], [3, G], [5, G]),
    value: (s) => s.global.completedSkills,
    tierDescription: (n) => `${count(n, ['навык', 'навыка', 'навыков'])} ${n % 10 === 1 && n % 100 !== 11 ? 'доведён' : 'доведены'} до конца`,
  },
];

/** The skill of the event that made a per-skill rule true. */
const eventSkill = (s: Stats) => s.eventSkillId;

type BadgeInput = Omit<AchievementDef, 'kind' | 'target'> & { target?: number };

const badge = (input: BadgeInput): AchievementDef => ({ kind: 'BADGE', target: 1, ...input });

export const BADGES: readonly AchievementDef[] = [
  badge({
    id: 'first-skill',
    title: 'Первый навык',
    description: 'Создан первый навык',
    howTo: 'Создайте навык — то, что хотите развивать.',
    rarity: B,
    icon: 'seedling',
    value: (s) => s.global.skillsCreated,
    skillOf: eventSkill,
  }),
  badge({
    id: 'first-step',
    title: 'Первое действие',
    description: 'Отмечено первое выполнение',
    howTo: 'Отметьте выполнение любого действия.',
    rarity: B,
    icon: 'sparkle',
    value: (s) => s.global.completions,
    skillOf: eventSkill,
  }),
  badge({
    id: 'first-flask',
    title: 'Первая колба',
    description: 'Заполнена первая колба',
    howTo: 'Наберите очки на целую колбу в любом навыке.',
    rarity: B,
    icon: 'drop',
    value: (s) => s.global.maxCompletedFlasksInSkill,
    skillOf: eventSkill,
  }),
  badge({
    id: 'toolbox',
    title: 'Набор инструментов',
    description: 'Три разных действия в одном навыке',
    howTo: 'Добавьте в навык три действия и держите их в списке.',
    rarity: B,
    icon: 'list',
    target: 3,
    value: (s) => s.global.maxActiveStepsInSkill,
    skillOf: eventSkill,
  }),
  badge({
    id: 'two-fronts',
    title: 'Два фронта',
    description: 'Действия в двух навыках за один день',
    howTo: 'Отметьте выполнения в двух разных навыках с одной датой.',
    rarity: B,
    icon: 'pair',
    target: 2,
    value: (s) => s.global.maxDistinctSkillsInDay,
  }),
  badge({
    id: 'multi',
    title: 'Многоборье',
    description: 'Три разных действия одного навыка за день',
    howTo: 'Отметьте три разных действия одного навыка с одной датой.',
    rarity: S,
    icon: 'star',
    target: 3,
    value: (s) => s.global.maxDistinctStepsOneSkillInDay,
    skillOf: eventSkill,
  }),
  badge({
    id: 'three-dirs',
    title: 'Три направления',
    description: 'Три навыка, в каждом заполнена хотя бы одна колба',
    howTo: 'Заполните хотя бы по одной колбе в трёх разных навыках.',
    rarity: S,
    icon: 'compass',
    target: 3,
    value: (s) => s.global.skillsWithFlask,
  }),
  badge({
    id: 'double',
    title: 'Двойное дно',
    description: 'Одно выполнение заполнило две колбы',
    howTo: 'Отметьте выполнение, очков которого хватит сразу на две колбы.',
    rarity: S,
    icon: 'layers',
    target: 2,
    value: (s) => s.global.maxLevelChange,
    skillOf: eventSkill,
  }),
  badge({
    id: 'exact',
    title: 'Ювелирно',
    description: 'Колба заполнена ровно до края',
    howTo: 'Заполните колбу так, чтобы в следующую не перешло ни одного очка.',
    rarity: S,
    icon: 'target',
    value: (s) => s.global.exactFills,
    skillOf: eventSkill,
  }),
  badge({
    id: 'beyond',
    title: 'Дальше цели',
    description: 'После вехи заполнена ещё одна колба',
    howTo: 'Достигнув вехи, продолжайте развитие и заполните ещё одну колбу.',
    rarity: S,
    icon: 'mountain',
    value: (s) => s.global.skillsBeyondMilestone,
    skillOf: eventSkill,
  }),
  badge({
    id: 'big-day',
    title: 'Большой день',
    description: 'Пять выполнений за один день',
    howTo: 'Отметьте пять выполнений с одной датой — в одном или в разных навыках.',
    rarity: S,
    icon: 'bolt',
    target: 5,
    value: (s) => s.global.maxCompletionsInDay,
  }),
  badge({
    id: 'marathon',
    title: 'Марафон',
    description: 'Одно выполнение длиной час и больше',
    howTo: 'Отметьте временное действие длительностью 60 минут или больше.',
    rarity: G,
    icon: 'stopwatch',
    target: 60,
    value: (s) => s.global.maxDurationMinutes,
    skillOf: eventSkill,
  }),
];

/** Tier defs of a ladder, generated: id `${ladderId}-${target}`, title «Действия · 50». */
function tierDefs(ladder: LadderDef): AchievementDef[] {
  return ladder.tiers.map(({ target, rarity }, tierIndex) => ({
    id: `${ladder.id}-${target}`,
    kind: 'TIER',
    ladderId: ladder.id,
    tierIndex,
    title: `${ladder.title} · ${formatNumber(target)}`,
    description: ladder.tierDescription(target),
    howTo: ladder.howTo,
    rarity,
    icon: ladder.icon,
    target,
    value: ladder.value,
  }));
}

/** Every achievement: the ladder tiers in ladder order, then the badges. */
export const CATALOG: readonly AchievementDef[] = [...LADDERS.flatMap(tierDefs), ...BADGES];

export const ladderById = (id: LadderId): LadderDef => LADDERS.find((l) => l.id === id)!;
