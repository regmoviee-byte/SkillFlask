import type { AchievementState } from '../../domain/achievements/types';
import { formatNumber, plural } from '../../lib/format';
import type { LadderView } from '../../services/achievements';
import { copy } from '../copy';
import { Badge, badgeState } from './Badge';
import { Icon } from './Icon';

// One ladder of the «Ачивки» tab: the counter, the distance to the next tier and, folded, every
// tier with its date. «Лучшая серия» shows the record only — there is no current streak.

const t = copy.achievements;

interface LadderCardProps {
  ladder: LadderView;
  /** An id to highlight (?focus=): one of this ladder's tiers opens the list and pulses the card. */
  focusId: string | null;
  onOpen(state: AchievementState): void;
}

export function LadderCard({ ladder, focusId, onOpen }: LadderCardProps) {
  const { def, current, tierIndex, next, tiers } = ladder;
  const focused = tiers.some((tier) => tier.def.id === focusId);
  const top = tierIndex >= 0 ? tiers[tierIndex]! : null;
  // The medal of the highest tier reached; before the first, the first tier on its way.
  const shown = top ?? tiers[0]!;
  const previous = tierIndex >= 0 ? tiers[tierIndex]!.target : 0;
  const ratio = next ? Math.max(0, Math.min(1, (current - previous) / (next.target - previous))) : 1;
  const unlocked = tierIndex + 1;
  return (
    <article className={`card ladder-card${focused ? ' is-focus' : ''}`} data-focus={focused || undefined} aria-label={def.title}>
      <button type="button" className="ladder-head pressable" onClick={() => onOpen(top ?? shown)}>
        <Badge rarity={shown.def.rarity} size={40} state={top ? 'unlocked' : badgeState(shown)} icon={def.icon} progress={shown.current / shown.target} />
        <span className="ladder-title t-title-s">{def.title}</span>
        <span className="ladder-value">
          <span className="t-display-l ladder-number">{formatNumber(current)}</span>
          <span className="ladder-unit">{plural(current, def.unit)}</span>
        </span>
      </button>
      <div className="bar ladder-bar" aria-hidden="true">
        <div className={`bar-fill${next ? '' : ' is-done'}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <p className="ladder-next">{next ? t.ladderNext(next.target, next.remaining) : t.ladderDone}</p>
      <details className="disclosure ladder-tiers" open={focused || undefined}>
        <summary>
          {t.ladderTiers(unlocked, tiers.length)}
          <Icon name="chevron-down" size={18} className="disclosure-chevron" />
        </summary>
        <ul className="ladder-tier-row">
          {tiers.map((tier) => (
            <li key={tier.def.id}>
              <button
                type="button"
                className={`ladder-tier${tier.def.id === focusId ? ' is-focus' : ''}`}
                aria-label={t.tileLabel(tier.def.title, tierState(tier))}
                onClick={() => onOpen(tier)}
              >
                <Badge rarity={tier.def.rarity} size={32} state={tier.unlocked ? 'unlocked' : 'locked'} icon={def.icon} />
                <span className="ladder-tier-target">{formatNumber(tier.target)}</span>
                <span className="ladder-tier-date">{tier.unlockedAt ? shortDate(tier.unlockedAt) : t.tierDateNone}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export function tierState(state: AchievementState): string {
  if (state.unlockedAt) return t.stateEarned(state.unlockedAt);
  return state.current > 0 ? t.stateProgress(state.current, state.target) : t.stateAhead;
}

const short = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

/** «21 сент.» — fits under a 32 px medal. */
function shortDate(iso: string): string {
  return short.format(new Date(iso));
}
