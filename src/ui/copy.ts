// Every user-facing string of the UI, grouped by screen. Tone rules (proposal v0.3, appendix Б):
// 1. Terms: навык, действие, очки, колба, веха, ачивка. Never «баллы».
// 2. Forbidden: просрочено, пропущено, штраф, долг, провал, сгорела, потеряна, «не сдавайтесь»,
//    countdowns, red for days without activity.
// 3. The past is described by what happened («В этот день отметок нет», «Активных дней: 9»),
//    never by what did not.
// 4. Quotas are progress towards a goal («1 из 3 на неделе»); «осталось» only about today's plan.
// 5. Comparisons only when they favour the user.
// 6. A level rollback is «Возврат к колбе N» in toasts and history.
// 7. Exclamation marks and emoji only in «Навык достигнут 🎉» and «Веха достигнута! 🎯».
// copy.test.ts walks this object and rejects forbidden words.

import { formatDate } from '../lib/dates';
import { FLASKS, FLASKS_OF, formatNumber, formatPoints, plural } from '../lib/format';

export const copy = Object.freeze({
  tabs: {
    achievements: 'Ачивки',
    skills: 'Навыки',
    todo: 'Список дел',
    account: 'Аккаунт',
  },
  common: {
    back: 'Назад',
    save: 'Сохранить',
    saved: 'Сохранено',
    soon: 'Скоро',
    optional: 'Необязательно',
    skill: 'Навык',
    skillNotFound: 'Навык не найден',
    flaskFilled: (percent: number) => `Колба заполнена на ${percent}%`,
    flaskNumber: (n: number) => `Колба ${n}`,
    flasksCount: (n: number) => `${n} ${plural(n, FLASKS)}`,
  },
  skills: {
    title: 'Навыки',
    newSkill: 'Новый навык',
    emptyTitle: 'Здесь будут ваши навыки',
    emptyHint: 'Создайте навык, добавьте к нему действия и заполняйте колбы очками.',
    create: 'Создать навык',
    filterActive: 'Активные',
    filterCompleted: 'Достигнутые',
    noActive: 'Нет активных навыков',
    noCompleted: 'Достигнутые навыки появятся здесь',
    statActive: 'в работе',
    statFlasks: 'колб заполнено',
    lastReached: 'Последнее достижение:',
    noReached: 'Достигнутые вехи появятся здесь',
    milestoneBadge: 'веха',
    milestoneProgress: (name: string, done: number, target: number) => `${name}: ${done}/${target}`,
    pointsOfCapacity: (points: number, capacity: number) => `${formatNumber(points)} / ${formatNumber(capacity)}`,
  },
  skill: {
    edit: 'Изм.',
    addAction: 'Добавить действие',
    flask: 'Колба',
    percentFilled: (percent: number) => `${percent}% заполнено`,
    total: (points: number) => `Всего ${formatPoints(points)}`,
    history: 'История',
    historyEmptyActive: 'Отметьте первое действие — очки начнут заполнять колбу.',
    historyEmptyInactive: 'Выполнений нет.',
  },
  history: {
    correction: 'Корректировка',
    flaskState: (flask: number, points: number, capacity: number) =>
      `Колба ${flask}: ${formatNumber(points)}/${formatNumber(capacity)}`,
    flaskFilledBadge: (flask: number) => `Колба ${flask} заполнена`,
    flasksFilledBadge: (n: number) => `Заполнено колб: ${n}`,
    flaskRollbackBadge: (flask: number) => `Возврат к колбе ${flask}`,
  },
  milestone: {
    completedAt: (date: string, flasks: number) =>
      `Навык достигнут ${formatDate(date)} · ${flasks} ${plural(flasks, FLASKS)}`,
    progress: (done: number, target: number) => `${done} из ${target} ${plural(target, FLASKS_OF)}`,
    reachedAt: (date: string) => `Веха достигнута ${formatDate(date)}.`,
    continuing: 'Вы продолжаете развитие.',
    decide: 'Завершить навык или продолжить развитие?',
    finish: 'Завершить',
    keepGoing: 'Продолжить',
    confirmFinish: (skillName: string) => `Завершить навык «${skillName}»? Он станет достигнутым и перейдёт в режим просмотра.`,
  },
  addAction: {
    title: 'Добавить действие',
    unavailable: 'Навык недоступен для новых действий',
    submit: 'Отметить выполненным',
    emptyTitle: 'Действий пока нет',
    emptyHint: 'Создайте действие — например, «Разговорная практика» на 5 очков.',
    stepGroup: 'Действие',
    when: 'Когда выполнено',
    createNew: 'Создать новое действие',
    stepPoints: (points: number) => `+${formatPoints(points)}`,
  },
  stepForm: {
    title: 'Новое действие',
    submit: 'Создать действие',
    created: 'Действие создано',
    name: 'Название',
    namePlaceholder: 'Например, разговорная практика',
    skill: 'Навык, к которому относится действие',
    type: 'Тип',
    typeBoolean: 'Выполнено / нет',
    typeTimedSoon: 'По времени · скоро',
    repeat: 'Повтор',
    repeatManual: 'Без расписания — отмечаю вручную',
    repeatDailySoon: 'Каждый день · скоро',
    repeatWeekdaysSoon: 'По дням недели · скоро',
    repeatTimesPerWeekSoon: 'N раз в неделю · скоро',
    points: 'Очки за выполнение',
  },
  skillForm: {
    titleNew: 'Новый навык',
    titleEdit: 'Настройка навыка',
    create: 'Создать навык',
    name: 'Название',
    namePlaceholder: 'Например, английский',
    description: 'Описание',
    startLabel: 'Сейчас',
    startPlaceholder: 'B1',
    targetLabel: 'Цель',
    targetPlaceholder: 'C1',
    milestoneSection: 'Веха',
    milestoneName: 'Название вехи',
    milestoneFlasks: 'Колб',
    defaultMilestoneName: (target: string) => (target ? `Достичь ${target}` : 'Главная цель'),
    capacitySection: 'Ёмкость колб',
    capacityBase: 'Первая колба',
    capacityIncrement: 'Прирост за уровень',
    manualCapacities: 'Свои значения по колбам',
    manualPlaceholder: 'Необязательно, например: 50, 80, 120',
    manualHint: 'После последнего значения ёмкость растёт на «прирост за уровень».',
    manualInvalid: 'Свои ёмкости: целые положительные числа через запятую',
    preview: (target: number, points: number) => `До вехи: ${target} ${plural(target, FLASKS)}, ${formatPoints(points)}`,
    remove: 'Удалить навык',
    confirmRemove: 'Навык и вся его история будут удалены без возможности восстановления. Удалить?',
    removed: 'Навык удалён',
  },
  placeholders: {
    achievementsTitle: 'Ачивки',
    achievementsHint: 'Ачивки появятся в следующих версиях. Пока достигнутые вехи видны на главной.',
    todoTitle: 'Список дел',
    todoHint: 'Здесь будут действия на сегодня по расписанию. Пока выполнения отмечаются вручную на экране навыка.',
    toSkills: 'К навыкам',
    accountTitle: 'Аккаунт',
    version: (version: string) => `Skill Flask · версия ${version}`,
    localData: 'Данные хранятся только на этом устройстве. Синхронизация между устройствами и резервная копия появятся позже.',
  },
  toast: {
    skillCompleted: 'Навык достигнут 🎉',
    milestoneReached: (points: number) => `+${formatNumber(points)} · Веха достигнута! 🎯`,
    flaskFilled: (points: number, flask: number, filled = 1) =>
      filled > 1
        ? `+${formatNumber(points)} · Заполнено колб: ${filled}, теперь колба ${flask}`
        : `+${formatNumber(points)} · Колба ${flask - 1} заполнена, теперь колба ${flask}`,
    pointsAdded: (points: number) => `+${formatPoints(points)}`,
  },
  errors: {
    save: 'Не сохранилось. Данные на месте — попробуйте ещё раз',
  },
  db: {
    opening: 'Открываем данные…',
    reload: 'Перезагрузить',
    title: 'Не удалось открыть данные',
  },
});

export type Copy = typeof copy;
