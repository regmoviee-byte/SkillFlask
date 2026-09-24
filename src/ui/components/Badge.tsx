import type { MedalGlyph, Rarity } from '../../domain/achievements/types';
import { MedalGlyphIcon } from '../achievements/medals';
import { Ring } from './Ring';

// An achievement medal. Earned: a radial gradient in the rarity's metal with a thin inner
// white ring and a white glyph. Ahead: a sunken disc with a dashed rim and a quiet glyph —
// never greyed-out «failed», just not yet. With progress, the ring around it fills.

export type BadgeState = 'unlocked' | 'locked' | 'progress';

interface BadgeProps {
  rarity: Rarity;
  size: 32 | 40 | 44 | 56 | 96;
  state: BadgeState;
  icon: MedalGlyph;
  /** 0..1, for state 'progress'. */
  progress?: number;
}

export function Badge({ rarity, size, state, icon, progress = 0 }: BadgeProps) {
  const medal = (
    <span
      className={`ach-badge ach-badge--${rarity.toLowerCase()} is-${state === 'unlocked' ? 'unlocked' : 'locked'}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <MedalGlyphIcon glyph={icon} size={Math.round(size * 0.5)} />
    </span>
  );
  if (state !== 'progress') return medal;
  return (
    <Ring value={progress} size={size + 8} stroke={3}>
      {medal}
    </Ring>
  );
}

/** Which look a state gets: earned, on its way (some progress), or ahead. */
export function badgeState(state: { unlocked: boolean; current: number }): BadgeState {
  return state.unlocked ? 'unlocked' : state.current > 0 ? 'progress' : 'locked';
}
