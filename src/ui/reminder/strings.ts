// The words of «Напоминание в календаре» (v0.5 package 20), in its lazy chunk: the form in
// «Настройках», the skill's sheet and the event itself. The build imports `reminderCopy.event` for the
// static .ics files (vite.config.ts), so this module imports nothing. The ⋯ item is in copy.ts;
// copy.test.ts walks this object.

export const reminderCopy = Object.freeze({
  /** The «Настройки» section. */
  section: 'Напоминание',
  time: 'Время',
  days: 'Дни',
  preset: { daily: 'Каждый день', weekdays: 'По будням', weekend: 'По выходным' },
  custom: 'Свои дни',
  weekdays: 'Дни недели',
  noDays: 'Выберите хотя бы один день',
  /** iOS: the static file, which iOS offers to add to «Календарь». */
  calendar: 'Добавить в Календарь',
  google: 'Google Календарь',
  file: 'Файл .ics',
  googleHint: 'Уведомление придёт так, как в Google Календаре настроено по умолчанию.',
  /** Telegram outside iOS: the static file opens in the browser. */
  fileLinkHint: 'Файл откроется в браузере — нажмите на него, чтобы добавить событие в календарь телефона.',
  /** A browser outside iOS: the file is made on the phone and downloaded. */
  downloadHint: 'Файл скачается — откройте его, чтобы добавить событие в календарь телефона.',
  /** Chosen weekdays: the static file has only the three day sets. */
  fileOnlyPresets: 'Файл .ics — для готовых наборов дней.',
  /** A skill's reminder: the static file has only the general title. */
  fileOnlyGeneral: 'Файл .ics — только общее напоминание, в «Настройках».',
  /** iOS outside Telegram: the static file's link is the Mini App (one file for everyone). */
  linkTelegram: 'Ссылка в событии открывает Skill Flask в Telegram.',
  downloaded: 'Файл сохранён — откройте его, чтобы добавить событие',
  note: 'Календарь напомнит в это время каждый раз, даже если вы уже позанимались. Чтобы убрать — удалите событие в календаре.',
  /** The skill's sheet (⋯ → «Напоминание для навыка»). */
  sheetTitle: 'Напоминание для навыка',
  sheetIntro: (name: string) => `Событие «${name} — время заниматься» в календаре телефона.`,
  fileName: (time: string) => `skill-flask-${time.replace(':', '')}.ics`,
  /** The calendar event. */
  event: {
    title: 'Skill Flask: время заниматься',
    skillTitle: (name: string) => `${name} — время заниматься`,
    description: (link: string) => `Откройте Skill Flask, когда будете готовы: ${link}`,
  },
});
