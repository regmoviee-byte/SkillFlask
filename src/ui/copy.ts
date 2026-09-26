// Every user-facing string of the UI, grouped by screen. Tone rules (proposal v0.3, appendix Б):
// 1. Terms: навык, действие, очки, колба, веха, ачивка. Never «баллы». A skill's level speaks
//    its progress theme's nouns (levelCopy below: «Пицца 2 съедена»); places that count the
//    levels of every skill together say «уровни».
// 2. Forbidden: просрочено, пропущено, штраф, долг, провал, сгорела, потеряна, «не сдавайтесь»,
//    countdowns, red for days without activity.
// 3. The past is described by what happened («В этот день отметок нет», «Активных дней: 9»),
//    never by what did not.
// 4. Quotas are progress towards a goal («1 из 3 на неделе»); «осталось» only about today's plan.
// 5. Comparisons only when they favour the user.
// 6. A level rollback is «Возврат к колбе N» (the theme's noun) in toasts and history.
// 7. Exclamation marks and emoji only in the «Навык достигнут 🎉» toast (the milestone has
//    its own sheet since v0.3 package 5, without emoji).
// copy.test.ts walks this object and rejects forbidden words.

import { formatDate, formatDateTime, formatDaySpan, formatWeek, formatWeekdayDate, MONTHS_IN } from '../lib/dates';
import { formatDelta, formatMinutes, formatNumber, formatPoints, formatRate, plural, POINTS } from '../lib/format';
import type { SkillColor } from '../domain/appearance';
import type { TemplateKey } from '../domain/templateKeys';
import type { LevelText } from './progress/texts';

/** The native bottom button's limit (MAX_BUTTON_TEXT in platform/buttons.ts; copy.test.ts keeps them equal). */
export const BUTTON_TEXT_MAX = 24;

const COMPLETIONS: [string, string, string] = ['выполнение', 'выполнения', 'выполнений'];
const SKILLS: [string, string, string] = ['навык', 'навыка', 'навыков'];
const ACTIONS: [string, string, string] = ['действие', 'действия', 'действий'];
const DAYS: [string, string, string] = ['день', 'дня', 'дней'];
const ACHIEVEMENTS: [string, string, string] = ['ачивка', 'ачивки', 'ачивок'];
const ACTIVE_DAYS: [string, string, string] = ['активный день', 'активных дня', 'активных дней'];
/** Levels of every skill together, whatever their themes: «Пройдено 7 уровней». */
const LEVELS: [string, string, string] = ['уровень', 'уровня', 'уровней'];

/** Genitive after «из»: «из 1 очка», «из 10 очков», «из 21 очка». */
const POINTS_OF: [string, string, string] = ['очка', 'очков', 'очков'];

const count = (n: number, forms: [string, string, string]) => `${formatNumber(n)} ${plural(n, forms)}`;

/**
 * A number never parts from the word after it («17 сентября», «2025 г.»), nor a range of days
 * at its dash («14–20»): a narrow row wraps between the parts of a text, not inside a date.
 */
export const keepNumbers = (text: string) => text.replace(/(\d) /g, '$1\u00a0').replace(/(\d)–(?=\d)/g, '$1–\u2060');

export const copy = Object.freeze({
  tabs: {
    today: 'Сегодня',
    skills: 'Навыки',
    achievements: 'Ачивки',
    settings: 'Настройки',
    navLabel: 'Разделы',
  },
  common: {
    back: 'Назад',
    loading: 'Загрузка…',
    save: 'Сохранить',
    saved: 'Сохранено',
    soon: 'Скоро',
    optional: 'Необязательно',
    skill: 'Навык',
    skillNotFound: 'Навык не найден',
  },
  home: {
    title: 'Навыки',
    newSkill: 'Новый навык',
    /** The levels of every skill together: neutral, whatever the themes. */
    tileLevels: 'Пройдено',
    levelsCaption: (n: number) => plural(n, LEVELS),
    /** The wide tile: the last achievement, or the closest next one with its progress. */
    // The date never breaks inside («24 / сентября» on a 320 px tile).
    achievementLastOn: (date: string) => `Последняя ачивка · ${formatDate(date).replace(/ /g, '\u00a0')}`,
    achievementNext: 'Следующая',
    achievementNextMeta: (title: string, current: number, target: number) => `${title} · ${formatNumber(current)} из ${formatNumber(target)}`,
    /** Defensive: `next` is null only when every achievement is unlocked, which the tile shows as the last one. */
    achievementNone: 'Ачивки начнутся с первого навыка',
    /** A second caption when a milestone was reached after the last achievement. */
    lastMilestone: (name: string, skillName: string, date: string) => `Веха «${name}» · ${skillName} · ${formatDate(date)}`,
    filterLabel: 'Какие навыки показать',
    filterActive: 'Активные',
    filterCompleted: 'Достигнутые',
    filterArchived: 'Архив',
    pointsOfCapacity: (points: number, capacity: number) => `${formatNumber(points)} / ${formatNumber(capacity)}`,
    archivedSince: (date: string) => `в архиве с ${formatDate(date)}`,
    milestoneReached: 'веха достигнута',
    todayPoints: (points: number) => `+${formatNumber(points)} сегодня`,
    emptyTitle: 'Первый навык',
    /** The heat map of every skill (ui/insights). */
    activity: 'Активность · все навыки',
    /** The header button that opens the search over every skill's history (ui/search). */
    search: 'Поиск по истории',
    /** The search screen's title (its header stands while the chunk loads). */
    searchTitle: 'Поиск',
  },
  today: {
    title: 'Сегодня',
    tileToday: 'Сегодня',
    pointsCaption: (n: number) => plural(n, POINTS),
    /** The week strip states facts only: no target, no count of the days without activity. */
    week: (n: number) => `Активных дней на неделе: ${n}`,
    weekdays: ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'],
    groupPoints: (points: number, capacity: number) => `${formatNumber(points)}/${formatNumber(capacity)}`,
    backdateLabel: (name: string) => `Задним числом: ${name}`,
    done: 'Сделано сегодня',
    doneCancelled: 'отменено',
    donePoints: (points: number) => `+${formatNumber(points)}`,
    doneCount: (n: number) => `×${n}`,
    emptyTitle: 'Начните с навыка',
    /** No active skill, but some in the archive or reached: not a first run, one way to a new skill. */
    noActiveTitle: 'Активных навыков нет',
    noActiveText: 'Начните новый навык — его действия появятся здесь. Архив и достигнутые навыки — на экране «Навыки».',
    noStepsTitle: 'Добавьте первое действие',
    noStepsText: 'Действия всех навыков собираются здесь, отметка — одним нажатием.',
    toSkill: (name: string) => `К навыку «${name}»`,
    /** The line under the date: facts about today's plan, never about what is missing. */
    summaryProgress: (done: number, planned: number) => `Сделано ${done} из ${planned}`,
    summaryAllDone: 'Всё сделано на сегодня',
    summaryNothing: 'На сегодня ничего не запланировано — отметьте что-нибудь из списка ниже',
    /** A past day picked on the strip: the ✓ records on that date. */
    summaryPast: (date: string) => `Отметки задним числом: ${formatWeekdayDate(date)}`,
    /** The week strip: a column per day, Monday first; days ahead cannot be picked. */
    weekPicker: 'День для отметок',
    weekdaysShort: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    dayLabel: (date: string, completions: number) =>
      completions > 0 ? `${formatWeekdayDate(date)}: ${count(completions, COMPLETIONS)}` : formatWeekdayDate(date),
    /** «Осталось» is used for today's plan only (tone rule 4); a past day lists its plan neutrally. */
    remaining: 'Осталось',
    plannedPast: 'По расписанию',
    quotaWeek: 'На этой неделе',
    quotaMonth: 'В этом месяце',
    /** A quota of another month than the current one (the week strip crosses a month). */
    quotaMonthOf: (month: number) => `В ${MONTHS_IN[month - 1] ?? 'этом месяце'}`,
    quotaProgress: (done: number, target: number) => `${done} из ${target}`,
    /** Accessible name of a quota's segmented bar. */
    quotaBar: (done: number, target: number) => `Выполнено ${done} из ${target}`,
    /** The other actions, folded under a plan: «Ещё 3 действия». */
    moreCount: (n: number) => `Ещё ${count(n, ACTIONS)}`,
    donePast: 'Сделано в этот день',
    doneEmptyPast: 'В этот день отметок нет',
    /** The only coach hint of the app, shown once above the first button. */
    coach: 'Нажмите на кнопку с очками — они сразу достанутся навыку. Ошиблись? «Отменить» в подсказке снизу.',
    /** The chip is one button: its name says it is a hint and that a tap closes it. */
    coachLabel: 'Подсказка: нажмите на кнопку с очками — они сразу достанутся навыку. Ошиблись? «Отменить» в подсказке снизу. Закрыть подсказку',
  },
  /**
   * The empty states of a device without skills (home, «Сегодня»): the templates first (v0.5
   * package 16). The rest of the chooser's words are lazy (ui/templates/strings.ts).
   */
  firstRun: {
    text: 'Выберите, чем занимаетесь, — очки и действия уже настроены',
    popularLabel: 'Популярные шаблоны',
    /** Chips straight to a template's form; the names are the catalogue's (templates.test.ts). */
    popular: [
      { key: 'english', name: 'Английский' },
      { key: 'running', name: 'Бег' },
      { key: 'reading', name: 'Чтение' },
      { key: 'guitar', name: 'Гитара' },
    ] satisfies { key: TemplateKey; name: string }[],
    allTemplates: 'Все шаблоны',
    custom: 'Свой навык',
  },
  lifecycle: {
    archivedSince: (date: string) => `В архиве с ${formatDate(date)}`,
    archivedText: 'История и прогресс сохранены. Действия снова появятся на «Сегодня», когда вы продолжите.',
    restore: 'Продолжить с этого места',
    restored: 'Навык снова в работе',
    restart: 'Начать заново',
    confirmRestart: (name: string, archived: boolean) =>
      `Создадим копию «${name}» с теми же действиями и вехой, но без очков. Этот навык останется ${archived ? 'в архиве' : 'в достигнутых'}.`,
    restarted: 'Копия создана',
    archive: 'Архивировать навык',
    confirmArchive: (name: string) =>
      `Убрать «${name}» в архив? История сохранится, действия перестанут показываться на «Сегодня». Вернуть можно в любой момент.`,
    archiveOk: 'В архив',
    archived: 'Навык в архиве',
  },
  skill: {
    edit: 'Изменить навык',
    /** The header ⋯ button that opens the skill's context menu. */
    menu: 'Меню навыка',
    reached: 'Достигнут',
    milestoneReachedIcon: 'Веха достигнута',
    total: (points: number) => `Всего ${formatPoints(points)}`,
    notFoundTitle: 'Навык не найден',
    notFoundText: 'Возможно, он удалён.',
    toSkills: 'К навыкам',
    history: 'История',
    /** The skill's heat map (ui/insights). */
    activity: 'Активность',
    historyEmptyTitle: 'Здесь появится история',
    historyEmptyActive: 'Отметьте первое действие — здесь появятся очки и уровни.',
    historyEmptyInactive: 'Выполнений нет.',
    showMore: 'Показать ещё',
    actions: 'Действия',
    actionsEdit: 'Изменить',
    actionsDone: 'Готово',
    newAction: 'Новое действие',
    firstAction: 'Создать первое действие',
    backdate: 'Задним числом',
    actionsIntro: 'Действие — это то, что вы отмечаете: «Чтение», «Тренировка». За каждое — очки.',
    examplesLabel: 'Примеры действий',
    examples: [
      { name: 'Разговорная практика', points: 5 },
      { name: '30 минут чтения', points: 10 },
      { name: 'Тренировка', points: 20 },
    ],
    exampleChip: (name: string, points: number) => `${name} · ${formatNumber(points)}`,
    allHidden: 'Все действия убраны из списка. Верните нужное или создайте новое.',
    hiddenSteps: (n: number) => `Убранные действия (${n})`,
    unhide: 'Вернуть',
    unhidden: 'Действие снова в списке',
    /** ⋯ menu: copies a link that opens this skill (platform/deeplink.ts). */
    link: 'Ссылка на навык',
    linkCopied: 'Ссылка скопирована',
  },
  /** The link sheet: the clipboard was unavailable, the link is shown to copy by hand. */
  skillLink: {
    title: 'Ссылка на навык',
    hintTelegram: 'Откроет этот навык в Skill Flask. Её можно закрепить в «Избранном» Telegram.',
    hintBrowser: 'Откроет этот навык в этом браузере: данные хранятся на устройстве.',
    field: 'Ссылка',
    copy: 'Скопировать',
  },
  marks: {
    mark: 'Засечка',
    title: 'Засечки',
    add: 'Добавить засечку',
    newTitle: 'Новая засечка',
    editTitle: 'Изменить засечку',
    name: 'Название',
    namePlaceholder: 'Пробный тест, экзамен, конкурс',
    date: 'Дата',
    description: 'Описание',
    descriptionPlaceholder: 'Необязательно',
    save: 'Сохранить',
    edit: 'Изменить',
    remove: 'Удалить',
    keep: 'Оставить',
    confirmRemove: (title: string) => `Удалить засечку «${title}»?`,
    added: 'Засечка добавлена',
    saved: 'Засечка сохранена',
    removed: 'Засечка удалена',
    empty: 'Отмечайте важные события на пути: экзамен, конкурс, новый проект.',
    /** The accessible name of a caption on the hero flask. */
    onFlask: (title: string) => `Засечка: ${title}`,
  },
  stepRow: {
    /** The points sit on the ✓ itself; the line under the name only counts today's completions. */
    today: (today: number) => `сегодня ×${today}`,
    /** The same count for a past day picked on «Сегодня». */
    onDate: (n: number) => `в этот день ×${n}`,
    points: (points: number) => `+${formatNumber(points)}`,
    /** A TIMED step's rate on its ✓: «0,5/мин». */
    rate: (rate: number) => formatRate(rate),
    check: (name: string, points: number) => `Отметить: ${name}, +${formatPoints(points)}`,
    checkTimed: (name: string, rate: number) => `Отметить: ${name}, ${formatNumber(rate)} ${plural(rate, POINTS)} в минуту`,
    /** The ▶ of a TIMED action (the live timer, package 15); the rest of the timer's words are lazy (ui/timer/strings.ts). */
    startTimer: (name: string) => `Запустить таймер: ${name}`,
    /** The same button while this action's timer runs: it opens the timer. */
    openTimer: (name: string) => `Открыть таймер: ${name}`,
  },
  minutes: {
    title: 'Сколько минут?',
    field: 'Минуты',
    unit: 'мин',
    willEarn: (points: number) => `Начислится ${formatPoints(points)}`,
    done: 'Готово',
    /** The date field, shown when the minutes come from a timer. */
    date: 'Дата',
  },
  stepper: {
    less: 'Меньше',
    more: 'Больше',
    presets: 'Частые значения',
  },
  completion: {
    added: (points: number, stepName: string) => `+${formatNumber(points)} · ${stepName}`,
    durationChanged: (delta: number) => `Длительность изменена: ${formatDelta(delta)} ${plural(Math.abs(delta), POINTS)}`,
    undo: 'Отменить',
    /** The toast's second action: the completion sheet with its note field focused (package 17). */
    note: 'Заметка',
    restored: 'Возвращено',
  },
  completionSheet: {
    /** A TIMED completion: minutes and the rate it was recorded at. */
    timedMeta: (minutes: number, rate: number) => `${formatMinutes(minutes)} · ${formatRate(rate)}`,
    minutes: 'Минуты',
    minutesPreview: (from: number, fromPoints: number, to: number, delta: number) =>
      `Было ${formatMinutes(from)} (${formatNumber(fromPoints)}) → станет ${formatMinutes(to)} (${formatDelta(delta)})`,
    recalc: 'Пересчитать',
    cancelledAt: (date: string) => `Отменено ${formatDate(date)}. Очки не учитываются.`,
    note: 'Заметка',
    notePlaceholder: 'Как прошло? Что получилось?',
    noteCounter: (length: number, max: number) => `${length} / ${max}`,
    saveNote: 'Сохранить',
    noteSaved: 'Заметка сохранена',
    noteAutosave: 'Сохраняется автоматически',
    cancel: 'Отменить выполнение',
    confirmCancelOk: 'Отменить',
    keep: 'Оставить',
    confirmCancel: (stepName: string, date: string) =>
      `Отменить выполнение «${stepName}» от ${formatDate(date)}? Очки будут списаны, запись останется в истории. Уровень может понизиться.`,
    restore: 'Вернуть',
  },
  history: {
    correction: 'Корректировка',
    cancellationOf: (stepName: string) => `Отмена: ${stepName}`,
    restoreOf: (stepName: string) => `Возврат: ${stepName}`,
    correctionOf: (stepName: string) => `Коррекция: ${stepName}`,
    /** A correction of the minutes that did not change the points (and whose minutes cannot be told from them). */
    minutesChanged: 'Минуты изменены',
    cancelledBadge: 'Отменено',
    milestoneReached: (name: string) => `Веха «${name}» достигнута`,
    milestoneAgain: (name: string) => `Веха «${name}» снова впереди`,
    skillCreated: 'Навык создан',
    skillCompleted: 'Навык достигнут',
    skillArchived: 'Навык в архиве',
    skillRestored: 'Навык снова активен',
    duration: (from: number, to: number) => `Длительность: ${from} → ${to} мин`,
    minutes: (n: number) => formatMinutes(n),
  },
  milestone: {
    reachedAt: (date: string) => `Веха достигнута ${formatDate(date)}.`,
    continuing: 'Вы продолжаете развитие.',
    decide: 'Завершить навык или продолжить развитие? Решать сейчас не обязательно.',
    finish: 'Завершить',
    keepGoing: 'Продолжить',
    confirmFinish: (skillName: string) => `Завершить навык «${skillName}»? Он станет достигнутым и перейдёт в режим просмотра.`,
  },
  addAction: {
    title: 'Задним числом',
    unavailable: 'Навык недоступен для новых действий',
    submit: 'Отметить выполненным',
    emptyTitle: 'Действий пока нет',
    emptyHint: 'Создайте действие — например, «Разговорная практика» на 5 очков.',
    stepGroup: 'Действие',
    when: 'Когда выполнено',
    createNew: 'Создать новое действие',
    stepPoints: (points: number) => `+${formatPoints(points)}`,
    duration: 'Длительность',
    /** The bottom button of a TIMED step; «Записать» gives way when a large rate makes it too long. */
    submitTimed: (minutes: number, points: number) => {
      const text = `${minutes} мин · +${formatNumber(points)}`;
      return `Записать ${text}`.length <= BUTTON_TEXT_MAX ? `Записать ${text}` : text;
    },
    submitNoMinutes: 'Укажите минуты',
  },
  stepForm: {
    title: 'Новое действие',
    titleEdit: 'Изменить действие',
    submit: 'Создать действие',
    created: 'Действие создано',
    name: 'Название',
    namePlaceholder: 'Например, разговорная практика',
    skill: 'Навык, к которому относится действие',
    points: 'Очки за выполнение',
    typeSection: 'Тип',
    typeBoolean: 'Выполнено / нет',
    typeTimed: 'По времени',
    typeLocked: 'Тип действия нельзя изменить; создайте новое действие',
    rate: 'Очков за минуту',
    ratePlaceholder: 'Например, 0,5',
    rateLow: 'При одной минуте очки округлятся до 0',
    usualMinutes: 'Обычно минут',
    usualMinutesHint: 'Необязательно — будет выбрано первым в «Сколько минут?»',
    /** «30 мин → 15 очков» */
    timedPreview: (minutes: number, points: number) => `${minutes} мин → ${formatPoints(points)}`,
    scheduleSection: 'Повтор',
    schedule: 'Когда показывать на «Сегодня»',
    scheduleManual: 'Вручную, без расписания',
    scheduleDaily: 'Каждый день',
    scheduleWeekdays: 'По дням недели',
    schedulePerWeek: 'N раз в неделю',
    schedulePerMonth: 'N раз в месяц',
    weekdays: 'Дни недели',
    weekdayNames: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'],
    weekdaysEmpty: 'Выберите хотя бы один день недели',
    timesPerWeek: 'Сколько раз в неделю',
    timesPerMonth: 'Сколько раз в месяц',
    dueHint: 'Появится в «Осталось» в эти дни. День без отметки ничего не отнимает.',
    quotaHint: (n: number) => `Покажем на экране «Сегодня» каждый день, пока не наберётся ${n}. Пропуски ничего не отнимают.`,
    futureHint: 'Изменения касаются только будущих выполнений. Прошлое не пересчитывается.',
    hide: 'Убрать из списка',
    hideConfirmButton: 'Убрать',
    confirmHide: 'Действие перестанет показываться в списке. История и очки сохранятся.',
    hidden: 'Действие убрано из списка',
    unhide: 'Вернуть в список',
    notFound: 'Действие не найдено',
    readOnly: 'Навык не активен — действие доступно только для просмотра.',
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
    defaultMilestoneName: (target: string) => (target ? `Достичь ${target}` : 'Главная цель'),
    // Capacities are the same numbers whatever the theme: «уровни».
    capacitySection: 'Ёмкость уровней',
    capacityBase: 'Первый уровень',
    capacityIncrement: 'Прирост за уровень',
    manualCapacities: 'Свои значения по уровням',
    manualPlaceholder: 'Необязательно, например: 50, 80, 120',
    manualHint: 'После последнего значения ёмкость растёт на «прирост за уровень».',
    manualInvalid: 'Свои ёмкости: целые положительные числа через запятую',
    advanced: 'Дополнительно',
    capacityHint: 'Изменение ёмкости пересчитает уровни по всей истории',
    /** The template's chunk did not load (offline, a new build): the form opens empty. */
    templateFailed: 'Шаблон не загрузился — заполните форму сами или попробуйте ещё раз',
    remove: 'Удалить навык',
    removeConfirmButton: 'Удалить',
    confirmRemove: 'Навык и вся его история будут удалены без возможности восстановления. Удалить?',
    removed: 'Навык удалён',
  },
  achievements: {
    title: 'Ачивки',
    /** The summary ring's accessible name. */
    summaryLabel: (unlocked: number, total: number) => `Получено ${formatNumber(unlocked)} из ${formatNumber(total)}`,
    summaryOf: (total: number) => `из ${formatNumber(total)}`,
    last: 'Последняя',
    lastMeta: (skillName: string | null, date: string) => (skillName ? `${skillName} · ${formatDate(date)}` : formatDate(date)),
    noneYet: 'Первая ачивка — за первый навык',
    filterLabel: 'Какие ачивки показать',
    filterAll: 'Все',
    filterEarned: 'Получено',
    filterAhead: 'Впереди',
    ladders: 'Лестницы',
    badges: 'Значки',
    ladderNext: (target: number, remaining: number) => `Следующая: ${formatNumber(target)} · ещё ${formatNumber(remaining)}`,
    ladderDone: 'Все ступени пройдены',
    ladderTiers: (unlocked: number, total: number) => `Ступени · ${unlocked} из ${total}`,
    tierDateNone: '—',
    progress: (current: number, target: number) => `${formatNumber(current)} из ${formatNumber(target)}`,
    rarity: { BRONZE: 'Бронза', SILVER: 'Серебро', GOLD: 'Золото' },
    howTo: 'Как получить',
    earnedOn: (date: string, skillName: string | null) => `Получена ${formatDate(date)}${skillName ? ` · ${skillName}` : ''}`,
    ahead: 'Ещё впереди',
    earnedNone: 'Полученные ачивки появятся здесь',
    aheadNone: 'Все ачивки получены',
    /** Accessible names: a tile, a tier, the tab with its dot. */
    tileLabel: (title: string, state: string) => `${title}: ${state}`,
    stateEarned: (date: string) => `получена ${formatDate(date)}`,
    stateProgress: (current: number, target: number) => `${formatNumber(current)} из ${formatNumber(target)}`,
    stateAhead: 'впереди',
    tabNew: (n: number) => `Ачивки, новых: ${n}`,
    /** The card at the top after a write earned something. */
    cardOverline: 'Новая ачивка',
    cardMore: (title: string, more: number) => `${title} и ещё ${more} ${plural(more, ACHIEVEMENTS)}`,
    cardOpen: (title: string) => `Новая ачивка: ${title}. Открыть «Ачивки»`,
  },
  recap: {
    /** «Итоги недели»: facts of one week, compared only when it is in the user's favour. */
    title: 'Итоги недели',
    range: (monday: string) => formatWeek(monday),
    /** The home row, all through the week after. */
    homeLabel: (monday: string) => `Итоги недели · ${keepNumbers(formatWeek(monday))}`,
    homeMeta: (points: number, days: number) => keepNumbers(`${formatPoints(points)} · ${count(days, ACTIVE_DAYS)}`),
    switcher: 'Неделя',
    previous: 'Предыдущая неделя',
    next: 'Следующая неделя',
    inProgress: 'Неделя ещё идёт',
    tilePoints: 'Очки',
    pointsCaption: (n: number) => plural(n, POINTS),
    tileDays: 'Активные дни',
    daysCaption: (n: number) => plural(n, DAYS),
    tileCompletions: 'Выполнено',
    completionsCaption: (n: number) => plural(n, ACTIONS),
    tileLevels: 'Пройдено',
    levelsCaption: (n: number) => plural(n, LEVELS),
    // «Неделей раньше», not «на прошлой неделе»: a browsed past week compares with the one before it.
    morePoints: 'Больше очков, чем неделей раньше',
    moreDays: 'Больше активных дней, чем неделей раньше',
    best: 'Лучшее за неделю',
    topSkill: 'Больше всего очков',
    topAction: 'Чаще всего',
    topActionMeta: (actionName: string, skillName: string) => `${actionName}\u00a0· ${skillName}`,
    topActionValue: (n: number) => `×${n}`,
    milestone: (name: string) => `Веха «${name}» достигнута`,
    milestoneMeta: (skillName: string, date: string) => `${skillName}\u00a0· ${keepNumbers(formatDate(date))}`,
    /** A record set this week: «Рекорд · 15 сентября». */
    recordMeta: (detail: string) => `Рекорд\u00a0· ${detail}`,
    achievements: 'Ачивки недели',
    emptyTitle: 'В эту неделю отметок нет',
    emptyText: 'Итоги собираются из отметок: очки, активные дни, уровни и рекорды.',
    emptyCurrentTitle: 'Отметки этой недели появятся здесь',
  },
  records: {
    title: 'Рекорды',
    bestDay: 'Лучший день',
    bestWeek: 'Лучшая неделя',
    mostCompletions: 'Больше всего действий за день',
    bestStreak: 'Лучшая серия',
    // «Самое длинное», not «долгое»: the tone test rejects every word starting with «долг».
    longestSession: 'Самое длинное занятие',
    fastestFlask: 'Самый быстрый уровень',
    points: (n: number) => formatPoints(n),
    completions: (n: number) => count(n, ACTIONS),
    streak: (days: number) => `${count(days, DAYS)} подряд`,
    minutes: (n: number) => formatMinutes(n),
    /** Days between two completed levels: 0 — «в тот же день», 2 — «за 2 дня». */
    flaskDays: (days: number) => (days === 0 ? 'в тот же день' : `за ${count(days, DAYS)}`),
    date: (date: string) => keepNumbers(formatDate(date)),
    week: (monday: string) => keepNumbers(formatWeek(monday)),
    /** A run of days: «5–7 сентября». */
    streakDates: (start: string, days: number) => keepNumbers(formatDaySpan(start, days)),
    // A no-break space before each «·», so a wrapped line never starts with the dot.
    withSkill: (skillName: string, detail: string) => `${skillName}\u00a0· ${detail}`,
    bySkill: (n: number) => `Лучший день по навыкам · ${n}`,
  },
  settings: {
    title: 'Настройки',
    groupData: 'Данные',
    groupAppearance: 'Оформление',
    groupCompletion: 'Выполнение',
    askNote: 'Спрашивать заметку после каждого действия',
    askNoteHint: 'После отметки откроется поле заметки — его можно закрыть пустым',
    groupAbout: 'О приложении',
    groupDanger: 'Опасная зона',
    cloud: 'Облако Telegram',
    /** `when` is «сегодня в 14:02» / «24 сентября в 14:02». */
    cloudSaved: (when: string, kb: number) => `Сохранено ${when} · ${formatNumber(kb)} КБ`,
    cloudDirty: 'Есть несохранённые изменения',
    cloudSaving: (done: number, total: number) => `Сохранение ${done}/${total}`,
    cloudSavingStart: 'Сохранение…',
    cloudNoCopy: 'Копии в облаке пока нет',
    cloudOff: 'Выключено',
    cloudError: (message: string) => `Не сохранилось: ${message}`,
    cloudUpdateTelegram: 'Недоступно: обновите Telegram',
    cloudOutside: 'Доступно при запуске из Telegram',
    cloudToggle: 'Хранить копию в облаке Telegram',
    cloudSaveNow: 'Сохранить сейчас',
    cloudSavedToast: 'Копия сохранена в облаке',
    cloudRestore: 'Восстановить из облака…',
    cloudRemote: (when: string, skills: number, completions: number) =>
      `Копия: ${when} · ${count(skills, SKILLS)}, ${count(completions, COMPLETIONS)}`,
    cloudRemoteNone: 'В облаке нет копии',
    cloudRemoteLoading: 'Проверяем облако…',
    cloudRemoteError: 'Не удалось проверить облако — нажмите, чтобы повторить',
    /** The cloud holds a copy this device did not write; the automatic save waits. `when` as in cloudSaved. */
    cloudConflict: (when: string | null) =>
      `В облаке другая копия${when ? ` (сохранена ${when})` : ''} — восстановите её или нажмите «Сохранить сейчас»`,
    confirmCloudOverwrite: (when: string | null) =>
      `Копия в облаке${when ? ` от ${when}` : ''} сохранена не с этого устройства. Заменить её данными с этого устройства?`,
    cloudOverwriteOk: 'Заменить копию',
    confirmCloudRestore: (when: string) => `Текущие данные на устройстве будут заменены копией из облака от ${when}. Продолжить?`,
    replaceOk: 'Заменить',
    cloudRestored: 'Восстановлено из облака',
    cloudDelete: 'Удалить копию из облака',
    confirmCloudDelete: 'Копия в облаке Telegram будет удалена, автоматическое сохранение выключится. Данные на устройстве останутся.',
    cloudDeleteOk: 'Удалить копию',
    cloudDeleted: 'Копия в облаке удалена',
    cloudHint:
      'Копия хранится в вашем аккаунте Telegram и доступна только этому боту. Это копия, а не синхронизация: при восстановлении данные на устройстве заменяются.',
    fileDownload: 'Скачать файл',
    fileImport: 'Загрузить из файла…',
    fileHint: 'Файл JSON со всеми навыками и историей. Его можно загрузить на другом устройстве или в браузере.',
    fileSaved: 'Файл сохранён',
    fileShared: 'Копия сохранена',
    fileCopied: (kb: number) => `Копия скопирована как текст (${formatNumber(kb)} КБ). Вставьте её в «Избранное» Telegram`,
    onDevice: 'На устройстве',
    counts: (skills: number, steps: number, completions: number) =>
      `${count(skills, SKILLS)} · ${count(steps, ACTIONS)} · ${count(completions, COMPLETIONS)}`,
    storagePersisted: 'Хранилище защищено от автоочистки',
    storageNotPersisted: 'Браузер может очистить данные — скачайте копию',
    reminder: (days: number) => `Последняя копия ${count(days, DAYS)} назад — скачайте файл`,
    reminderNever: 'Резервной копии ещё нет — скачайте файл',
    theme: 'Тема',
    /** 'auto': Telegram's theme inside Telegram, the system's in a browser. */
    themeAuto: (telegram: boolean) => (telegram ? 'Как в Telegram' : 'Как в системе'),
    themeLight: 'Светлая',
    themeDark: 'Тёмная',
    reduceMotion: 'Меньше анимации',
    reduceMotionHint: 'Системная настройка «Уменьшить движение» тоже учитывается',
    haptics: 'Виброотклик',
    version: (version: string) => `Skill Flask · версия ${version}`,
    reload: 'Обновить приложение',
    reloadHint: 'Если что-то выглядит устаревшим',
    /** A new version of the installed browser app is downloaded and waits (service worker). */
    updateReady: 'Доступна новая версия — нажмите, чтобы обновить',
    homeScreenAdd: 'Добавить на главный экран',
    homeScreenHintTelegram: 'Ярлык открывает Skill Flask сразу, без чата с ботом',
    homeScreenHintBrowser: 'Skill Flask откроется отдельным приложением, и без сети тоже',
    homeScreenAdded: 'Уже на главном экране',
    homeScreenAddedToast: 'Ярлык добавлен на главный экран',
    activeDays: (n: number) => `Активных дней за 14 дней: ${n}`,
    errors: (n: number) => `Ошибки (${n})`,
    errorsEmpty: 'Журнал ошибок пуст',
    errorsClear: 'Очистить',
    errorsCleared: 'Журнал ошибок очищен',
    deleteAll: 'Удалить все данные',
    confirmDeleteAll: 'Все навыки, действия и история на этом устройстве будут удалены. Удалить?',
    deleteAllOk: 'Удалить всё',
    confirmDeleteCloud: 'Удалить и копию в облаке Telegram? Если оставить её, данные можно будет восстановить из облака.',
    deleteCloudOk: 'Удалить и копию',
    keepCloud: 'Оставить копию',
    deletedAll: 'Все данные удалены',
  },
  /** «На главный экран» outside Telegram when the browser has no install prompt (Safari). */
  install: {
    title: 'На главный экран',
    steps: {
      ios: ['Нажмите «Поделиться» внизу Safari', 'Выберите «На экран „Домой“»', 'Нажмите «Добавить»'],
      /** Chrome, Firefox, an in-app browser on iOS: «Поделиться» is elsewhere, or missing. */
      'ios-other': ['Откройте меню «Поделиться» браузера', 'Выберите «На экран „Домой“»', 'Нажмите «Добавить»'],
      other: ['Откройте меню браузера', 'Выберите «Установить приложение» или «Добавить на главный экран»', 'Подтвердите добавление'],
    },
    /** iOS keeps a home-screen app's storage apart from Safari's. */
    noteIos: 'У приложения на экране «Домой» своё хранилище, отдельное от Safari. Чтобы перенести навыки, скачайте здесь файл копии и загрузите его в приложении.',
    noteIosOther:
      'Если пункта «На экран „Домой“» нет, откройте эту страницу в Safari. У приложения на экране «Домой» своё хранилище: чтобы перенести навыки, скачайте здесь файл копии и загрузите его в приложении.',
    noteOther: 'Приложение откроется в своём окне, навыки и история — те же, что в этом браузере.',
    done: 'Понятно',
  },
  backupImport: {
    title: 'Загрузить из файла',
    chooseFile: 'Выбрать файл',
    pasteLabel: 'Или вставьте текст копии',
    pastePlaceholder: '{"format":"skill-flask-backup",…}',
    check: 'Проверить текст',
    reading: 'Читаем копию…',
    previewTitle: 'Резервная копия',
    preview: (skills: number, completions: number, lastDate: string | null, exportedAt: string) =>
      [
        `Навыков: ${formatNumber(skills)}`,
        `выполнений: ${formatNumber(completions)}`,
        lastDate ? `последняя запись ${formatDate(lastDate)}` : null,
        `создано ${formatDateTime(exportedAt)}`,
      ]
        .filter(Boolean)
        .join(' · '),
    replace: 'Заменить данные',
    replaceHint: 'Данные на устройстве будут заменены этой копией.',
    confirm: (exportedAt: string) => `Текущие данные на устройстве будут заменены копией от ${formatDateTime(exportedAt)}. Продолжить?`,
    confirmOk: 'Заменить',
    imported: 'Импортировано',
  },
  backupText: {
    title: 'Копия как текст',
    hint: 'Скопируйте текст целиком и сохраните его, например, в «Избранное» Telegram. Загрузить его можно через «Загрузить из файла…».',
    selectAll: 'Выделить всё',
    field: 'Текст резервной копии',
  },
  restoreOffer: {
    title: 'Резервная копия в облаке',
    text: (at: string, skills: number, completions: number) =>
      `Найдена резервная копия от ${formatDateTime(at)}: ${count(skills, SKILLS)}, ${count(completions, COMPLETIONS)}. Восстановить?`,
    restore: 'Восстановить',
    fresh: 'Начать с чистого листа',
    freshConfirm: 'Копия в облаке заменится новыми данными после первого изменения. Начать с чистого листа?',
    freshOk: 'Начать заново',
    freshCancel: 'Назад',
    restoring: 'Восстанавливаем…',
  },
  sheet: {
    cancel: 'Отмена',
    ok: 'OK',
    close: 'Закрыть',
    confirmLabel: 'Подтверждение',
  },
  errorBoundary: {
    title: 'Что-то пошло не так',
    text: 'Данные на устройстве не пострадали.',
    reload: 'Перезагрузить',
    saveCopy: 'Сохранить копию данных',
  },
  toast: {
    skillCompleted: 'Навык достигнут 🎉',
  },
  celebration: {
    milestoneTitle: 'Веха достигнута',
    milestoneLabel: (name: string) => `Веха достигнута: ${name}`,
    tilePoints: (n: number) => plural(n, POINTS),
    tileDays: (n: number) => plural(n, DAYS),
    finishSkill: 'Завершить навык',
    keepGoing: 'Продолжить развитие',
    later: 'Решу позже',
    continued: 'Продолжаем — уровни без ограничений',
  },
  appearance: {
    /** The skill form's section and the ⋯ menu item. */
    title: 'Оформление',
    theme: 'Образ',
    color: 'Цвет',
    /** The picker's live preview: the chosen theme at 45 %. */
    previewLabel: (themeName: string, colorName: string) => `Предпросмотр: ${themeName}, ${`${colorName}`.toLowerCase()}`,
    themeLabel: (name: string, hint: string) => `${name}. ${hint}`,
    colorAuto: 'Как в теме',
    colors: {
      sky: 'Голубой',
      teal: 'Бирюзовый',
      green: 'Зелёный',
      amber: 'Янтарный',
      coral: 'Коралловый',
      rose: 'Розовый',
      violet: 'Фиолетовый',
      graphite: 'Графитовый',
    } satisfies Record<SkillColor, string>,
    saved: 'Оформление сохранено',
  },
  errors: {
    save: 'Не сохранилось. Данные на месте — попробуйте ещё раз',
    /** The live timer's chunk did not load (a new build on the server): the timer itself is kept. */
    timerChunk: 'Таймер не открылся — обновите приложение в «Настройках»',
    /** The search chunk did not load (package 17). */
    searchChunk: 'Поиск не открылся — обновите приложение в «Настройках»',
    recapChunk: 'Итоги не открылись — обновите приложение в «Настройках»',
  },
  db: {
    opening: 'Открываем данные…',
    reload: 'Перезагрузить',
    title: 'Не удалось открыть данные',
  },
});

export type Copy = typeof copy;

/**
 * The strings that name a skill's level, in the nouns of its progress theme: «Колба 3»,
 * «ещё 58 до пиццы 4», «Книга 2 прочитана», «Возврат к полёту 1», «2 из 10 цветков».
 * One frozen object per theme (registry.ts levelCopyOf caches them); copy.test.ts runs the tone
 * checks over every theme.
 */
export function levelCopy(lv: LevelText) {
  const noun = (level: number) => `${lv.levelNoun} ${level}`;
  const levels = (n: number) => `${formatNumber(n)} ${plural(n, lv.levelForms)}`;
  /** «Колба 2: 45/150» — the level after an operation, as in the history. */
  const state = (level: number, points: number, capacity: number) => `${noun(level)}: ${formatNumber(points)}/${formatNumber(capacity)}`;
  const levelsOf = (n: number) => plural(n, lv.levelFormsOf);
  return Object.freeze({
    /** The hero's eyebrow over the big number: «Колба», «Поездка». */
    name: lv.levelNoun,
    /** «Колба 3»: the pill of a level-up, the marks list, rows. */
    noun,
    /** «3 колбы». */
    levels,
    /** The count word alone, for a tile: «колбы». */
    levelsCaption: (n: number) => plural(n, lv.levelForms),
    state,
    /** A level completed (history, the aria-live, the TopCard); `count` > 1 when one write completed several. */
    completed: (level: number, count = 1) => (count > 1 ? lv.completedRange(level - count + 1, level) : lv.completed(level)),
    rollback: (level: number) => `Возврат к ${lv.levelDative} ${level}`,
    /** «42% · ещё 58 до колбы 4» */
    // Non-breaking spaces: a narrow hero column (marks beside the hero) wraps as «66% · ещё 5 /
    // до колбы 3», never inside «ещё 5» or «до колбы 3».
    toNext: (percent: number, left: number, next: number) => `${percent}% · ещё ${formatNumber(left)} до ${lv.levelGenitive} ${next}`,
    /** The hero's accessible name (FR-XP-007). */
    heroLabel: (level: number, points: number, capacity: number, percent: number) =>
      `${noun(level)}: ${formatNumber(points)} из ${formatNumber(capacity)}, ${percent}%`,
    completedLabel: (count: number) => `Навык достигнут: ${levels(count)}`,
    /** Accessible name of a skill card's level picture. */
    cardLabel: (level: number, percent: number) => `${noun(level)}, ${percent}%`,
    /** The milestone: «2 из 10 колб»; above 12 levels the card shows «7 / 20 колб». */
    milestoneProgress: (done: number, target: number) => `${done} из ${target} ${levelsOf(target)}`,
    milestoneCount: (done: number, target: number) => `${formatNumber(done)} / ${formatNumber(target)} ${levelsOf(target)}`,
    completedAt: (date: string, count: number, points: number) => `Навык достигнут ${formatDate(date)} · ${levels(count)} · ${formatPoints(points)}`,
    /** Where a mark sits, against its level's capacity as it is now. */
    markPosition: (level: number, points: number, capacity: number) =>
      `${noun(level)}, ${formatNumber(points)} из ${formatNumber(capacity)} ${plural(capacity, POINTS_OF)}`,
    /** The history row of a mark. */
    markHistory: (level: number, points: number) => `${noun(level)} · ${formatPoints(points)}`,
    cancelled: (level: number, points: number, capacity: number) => `Отменено · ${state(level, points, capacity)}`,
    completionMeta: (date: string, points: number, level: number, inLevel: number, capacity: number) =>
      `${formatDate(date)} · +${formatNumber(points)} · ${state(level, inLevel, capacity)}`,
    stepPreview: (perLevel: number, perMilestone: number) =>
      `≈ ${perLevel} ${plural(perLevel, COMPLETIONS)} до ${lv.levelGenitive} 1 · веха через ≈ ${perMilestone}`,
    /** The milestone target field: «Колб», «Поездок». */
    formMilestoneLevels: lv.levelForms[2].charAt(0).toUpperCase() + lv.levelForms[2].slice(1),
    formPreview: (target: number, capacities: string, points: number) => `Веха: ${levels(target)} · ${capacities} · всего ${formatPoints(points)}`,
    /** «Английский · Пицца 3 · 17 сентября» — the fastest level of the records. */
    record: (skillName: string, level: number, date: string) =>
      `${skillName} · ${lv.levelNoun} ${level} · ${keepNumbers(formatDate(date))}`,
  });
}

export type LevelCopy = ReturnType<typeof levelCopy>;
