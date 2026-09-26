// The static reminder files of the build (v0.5 package 20): scripts/reminders-plugin.mjs loads
// this module through Vite (runnerImport) and writes what it returns to dist/reminders/. Their
// link is the Mini App of VITE_TG_APP_LINK, like «Ссылка на навык» inside Telegram.

import { staticReminderFiles } from '../../domain/reminder';
import { tgAppLink } from '../../platform/deeplink';
import { reminderCopy } from './strings';

export default function reminderStaticFiles(env: Record<string, string | undefined>, now: Date = new Date()): { path: string; content: string }[] {
  return staticReminderFiles(tgAppLink(env.VITE_TG_APP_LINK ?? ''), reminderCopy.event, now);
}
