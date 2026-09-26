import { Suspense, useEffect, type ComponentType } from 'react';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { lazySafe } from '../lazySafe';
import type { PauseSheetProps } from './PauseSheet';

// The pause sheet (v0.5 package 18) in the first paint: only this wrapper. The sheet, its
// strings and the pause mutations come in a lazy chunk that starts loading with the skill screen
// of an active skill, long before its ⋯ menu can ask for it. A chunk that fails to load says so
// when the sheet is asked for, instead of a tap doing nothing.

/** Without the chunk: a toast when asked to open, then closed again. */
function PauseUnavailable({ open, onClose }: PauseSheetProps) {
  const { showToast } = useToast();
  useEffect(() => {
    if (!open) return;
    showToast(copy.errors.pauseChunk);
    onClose();
  }, [open, onClose, showToast]);
  return null;
}

const PauseSheetChunk = lazySafe<ComponentType<PauseSheetProps>>(() => import('./PauseSheet'), 'PauseSheet', PauseUnavailable);

export function PauseSheet(props: PauseSheetProps) {
  return (
    <Suspense fallback={null}>
      <PauseSheetChunk {...props} />
    </Suspense>
  );
}
