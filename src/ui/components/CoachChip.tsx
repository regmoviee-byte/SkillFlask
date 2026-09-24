import { copy } from '../copy';
import { Icon } from './Icon';

// The only coach hint in the app (proposal: at most one hint per screen): shown once on
// «Сегодня» above the first button with points, gone for good after a tap or the first
// completion. The caret points down at the button on the right.

export function CoachChip({ onDismiss }: { onDismiss(): void }) {
  return (
    <button type="button" className="coach-chip" aria-label={copy.today.coachLabel} onClick={onDismiss}>
      <Icon name="info" size={20} className="coach-chip-icon" />
      <span className="coach-chip-text">{copy.today.coach}</span>
      {/* The whole chip dismisses it; the cross only says so. */}
      <Icon name="close" size={16} className="coach-chip-close" />
    </button>
  );
}
