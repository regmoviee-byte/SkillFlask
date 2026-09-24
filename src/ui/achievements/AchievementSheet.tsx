import type { AchievementState } from '../../domain/achievements/types';
import { Badge, badgeState } from '../components/Badge';
import { Sheet } from '../components/Sheet';
import { copy } from '../copy';

// Details of one achievement: the medal, its rarity, what it is, how to get it, the progress
// and when it was earned. Read-only; nothing here can be «failed».

const t = copy.achievements;

interface AchievementSheetProps {
  state: AchievementState | null;
  skillNames: Record<string, string>;
  onClose(): void;
}

export function AchievementSheet({ state, skillNames, onClose }: AchievementSheetProps) {
  // The last state stays rendered while the sheet slides out.
  return (
    <Sheet open={state !== null} onClose={onClose} ariaLabel={state?.def.title} className="achievement-sheet">
      {state && <Details state={state} skillName={state.skillId ? (skillNames[state.skillId] ?? null) : null} />}
    </Sheet>
  );
}

function Details({ state, skillName }: { state: AchievementState; skillName: string | null }) {
  const { def } = state;
  const ratio = state.target > 0 ? state.current / state.target : 0;
  return (
    <div className="ach-detail">
      <Badge rarity={def.rarity} size={96} state={badgeState(state)} icon={def.icon} progress={ratio} />
      <h2 className="t-title-m ach-detail-title">{def.title}</h2>
      <span className={`rarity-chip rarity-chip--${def.rarity.toLowerCase()}`}>{t.rarity[def.rarity]}</span>
      <p className="ach-detail-description">{def.description}</p>
      <section className="ach-howto" aria-label={t.howTo}>
        <h3 className="t-label">{t.howTo}</h3>
        <p>{def.howTo}</p>
      </section>
      <div className="ach-progress">
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={state.target} aria-valuenow={state.current} aria-label={t.progress(state.current, state.target)}>
          <div className={`bar-fill${state.unlocked ? ' is-done' : ''}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <span className="t-caption">{t.progress(state.current, state.target)}</span>
      </div>
      <p className={`ach-detail-foot${state.unlocked ? ' is-earned' : ''}`}>
        {state.unlockedAt ? t.earnedOn(state.unlockedAt, skillName) : t.ahead}
      </p>
    </div>
  );
}
