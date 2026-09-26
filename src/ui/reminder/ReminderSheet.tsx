import { useState } from 'react';
import type { Skill } from '../../domain/types';
import { Sheet } from '../components/Sheet';
import { ReminderForm } from './ReminderForm';
import { reminderCopy as t } from './strings';

// ⋯ → «Напоминание для навыка» (v0.5 package 20, a lazy chunk): the form of «Настройки» with the
// skill's title («Английский — время заниматься») and link (its screen). The skill screen offers
// it only where some way makes the event on the phone (platform/reminders.ts): the static files
// of iOS carry the general title only.

export interface ReminderSheetProps {
  skill: Skill;
  open: boolean;
  onClose(): void;
}

export default function ReminderSheet({ skill, open, onClose }: ReminderSheetProps) {
  // The form (and its read of the remembered choice) lives from opening until the sheet has slid
  // out, not for as long as the skill screen is open.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  return (
    <Sheet open={open} onClose={onClose} onExited={() => setShown(false)} title={t.sheetTitle} className="reminder-sheet">
      <p className="hint reminder-intro">{t.sheetIntro(skill.name)}</p>
      {shown && <ReminderForm skill={{ id: skill.id, name: skill.name }} />}
    </Sheet>
  );
}
