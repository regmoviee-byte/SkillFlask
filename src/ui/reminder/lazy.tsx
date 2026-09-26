import { Suspense, useEffect, type ComponentType } from 'react';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { lazySafe } from '../lazySafe';
import type { ReminderSheetProps } from './ReminderSheet';

// «Напоминание для навыка» (v0.5 package 20) in the first paint: only this wrapper. The sheet,
// the form, the .ics and Google Calendar builders and their strings come in a lazy chunk that
// starts loading with the skill screen, long before its ⋯ menu can ask for it. A chunk that
// fails to load says so when the sheet is asked for, instead of a tap doing nothing.

/** Without the chunk: a toast when asked to open, then closed again. */
function ReminderUnavailable({ open, onClose }: ReminderSheetProps) {
  const { showToast } = useToast();
  useEffect(() => {
    if (!open) return;
    showToast(copy.errors.sheetChunk);
    onClose();
  }, [open, onClose, showToast]);
  return null;
}

const ReminderSheetChunk = lazySafe<ComponentType<ReminderSheetProps>>(() => import('./ReminderSheet'), 'ReminderSheet', ReminderUnavailable);

export function ReminderSheet(props: ReminderSheetProps) {
  return (
    <Suspense fallback={null}>
      <ReminderSheetChunk {...props} />
    </Suspense>
  );
}
