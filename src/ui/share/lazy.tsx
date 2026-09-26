import { Suspense, useEffect, type ComponentType } from 'react';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { lazySafe } from '../lazySafe';
import type { ShareSheetProps } from './ShareSheet';

// «Поделиться прогрессом» (v0.5 package 19) in the first paint: only this wrapper. The sheet,
// the card's drawing, its read model and its strings come in a lazy chunk that starts loading
// with the skill screen, long before its ⋯ menu can ask for it. A chunk that fails to load says
// so when the sheet is asked for, instead of a tap doing nothing.

/** Without the chunk: a toast when asked to open, then closed again. */
function ShareUnavailable({ open, onClose }: ShareSheetProps) {
  const { showToast } = useToast();
  useEffect(() => {
    if (!open) return;
    showToast(copy.errors.sheetChunk);
    onClose();
  }, [open, onClose, showToast]);
  return null;
}

const ShareSheetChunk = lazySafe<ComponentType<ShareSheetProps>>(() => import('./ShareSheet'), 'ShareSheet', ShareUnavailable);

export function ShareSheet(props: ShareSheetProps) {
  return (
    <Suspense fallback={null}>
      <ShareSheetChunk {...props} />
    </Suspense>
  );
}
