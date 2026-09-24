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

import { formatDate, formatDateTime } from '../lib/dates';
import { FLASKS, FLASKS_OF, formatNumber, formatPoints, plural } from '../lib/format';

const COMPLETIONS: [string, string, string] = ['выполнение', 'выполнения', 'выполнений'];
const SKILLS: [string, string, string] = ['навык', 'навыка', 'навыков'];
const ACTIONS: [string, string, string] = ['действие', 'действия', 'действий'];
const DAYS: [string, string, string] = ['день', 'дня', 'дней'];

const count = (n: number, forms: [string, string, string]) => `${formatNumber(n)} ${plural(n, forms)}`;

/** «Колба 2: 45/150» — the flask state after an operation, as in the history. */
const flaskState = (flask: number, points: number, capacity: number) =>
  `Колба ${flask}: ${formatNumber(points)}/${formatNumber(capacity)}`;

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
    flask: 'Колба',
    percentFilled: (percent: number) => `${percent}% заполнено`,
    total: (points: number) => `Всего ${formatPoints(points)}`,
    history: 'История',
    historyEmptyActive: 'Отметьте первое действие — очки начнут заполнять колбу.',
    historyEmptyInactive: 'Выполнений нет.',
    actions: 'Действия',
    actionsEdit: 'Изменить',
    actionsDone: 'Готово',
    newAction: 'Новое действие',
    firstAction: 'Создать первое действие',
    backdate: 'Задним числом',
    actionsIntro: 'Действие — это то, что вы отмечаете: «Чтение», «Тренировка». За каждое — очки в колбу.',
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
  },
  stepRow: {
    meta: (points: number, today: number) => (today > 0 ? `+${formatNumber(points)} · сегодня ×${today}` : `+${formatNumber(points)}`),
    check: (name: string, points: number) => `Отметить: ${name}, +${formatPoints(points)}`,
  },
  completion: {
    added: (points: number, stepName: string) => `+${formatNumber(points)} · ${stepName}`,
    undo: 'Отменить',
    cancelled: (flask: number, points: number, capacity: number) => `Отменено · ${flaskState(flask, points, capacity)}`,
    restored: 'Возвращено',
  },
  completionSheet: {
    meta: (date: string, points: number, flask: number, inFlask: number, capacity: number) =>
      `${formatDate(date)} · +${formatNumber(points)} · ${flaskState(flask, inFlask, capacity)}`,
    cancelledAt: (date: string) => `Отменено ${formatDate(date)}. Очки не учитываются.`,
    note: 'Заметка',
    notePlaceholder: 'Как прошло? Что получилось?',
    noteCounter: (length: number, max: number) => `${length} / ${max}`,
    saveNote: 'Сохранить',
    noteSaved: 'Заметка сохранена',
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
    cancelledBadge: 'Отменено',
    flaskState,
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
    title: 'Задним числом',
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
    titleEdit: 'Изменить действие',
    submit: 'Создать действие',
    created: 'Действие создано',
    name: 'Название',
    namePlaceholder: 'Например, разговорная практика',
    skill: 'Навык, к которому относится действие',
    points: 'Очки за выполнение',
    preview: (perFlask: number, perMilestone: number) =>
      `≈ ${perFlask} ${plural(perFlask, COMPLETIONS)} до первой колбы · веха через ≈ ${perMilestone}`,
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
    milestoneFlasks: 'Колб',
    defaultMilestoneName: (target: string) => (target ? `Достичь ${target}` : 'Главная цель'),
    capacitySection: 'Ёмкость колб',
    capacityBase: 'Первая колба',
    capacityIncrement: 'Прирост за уровень',
    manualCapacities: 'Свои значения по колбам',
    manualPlaceholder: 'Необязательно, например: 50, 80, 120',
    manualHint: 'После последнего значения ёмкость растёт на «прирост за уровень».',
    manualInvalid: 'Свои ёмкости: целые положительные числа через запятую',
    advanced: 'Дополнительно',
    capacityHint: 'Изменение ёмкости пересчитает уровни по всей истории',
    preview: (target: number, capacities: string, points: number) =>
      `Веха: ${target} ${plural(target, FLASKS)} · ${capacities} · всего ${formatPoints(points)}`,
    templates: {
      english: { name: 'Английский', startLabel: 'B1', targetLabel: 'C1', milestoneName: 'Достичь C1', milestoneTarget: 10 },
    },
    remove: 'Удалить навык',
    removeConfirmButton: 'Удалить',
    confirmRemove: 'Навык и вся его история будут удалены без возможности восстановления. Удалить?',
    removed: 'Навык удалён',
  },
  placeholders: {
    achievementsTitle: 'Ачивки',
    achievementsHint: 'Ачивки появятся в следующих версиях. Пока достигнутые вехи видны на главной.',
    todayTitle: 'Сегодня',
    todayHint: 'Здесь появятся действия на сегодня. Пока отмечайте выполнения на экране навыка.',
    toSkills: 'К навыкам',
  },
  settings: {
    title: 'Настройки',
    groupData: 'Данные',
    groupAppearance: 'Оформление',
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
    reduceMotion: 'Меньше анимации',
    reduceMotionHint: 'Системная настройка «Уменьшить движение» тоже учитывается',
    haptics: 'Виброотклик',
    version: (version: string) => `Skill Flask · версия ${version}`,
    reload: 'Обновить приложение',
    reloadHint: 'Если что-то выглядит устаревшим',
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
    milestoneReached: (points: number) => `+${formatNumber(points)} · Веха достигнута! 🎯`,
    /** A completion filled flasks; `lastFilled` is the number of the last full flask. */
    flaskFilled: (lastFilled: number, remainder: number, filled = 1) => {
      const head = filled > 1 ? `Заполнено колб: ${filled}` : `Колба ${lastFilled} заполнена`;
      return remainder > 0 ? `${head} · остаток ${formatPoints(remainder)}` : head;
    },
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
