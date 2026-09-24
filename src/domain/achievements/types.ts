// Achievement definitions and their evaluated state. The catalogue (catalog.ts) is data; the
// engine (evaluate.ts) replays the journal and decides what is unlocked and since when. Nothing
// here is stored: the `achievementUnlocks` table only remembers what the UI has shown.

import type { Stats } from './stats';

/** A visual tone only: rarity never changes points, order or rules. */
export type Rarity = 'BRONZE' | 'SILVER' | 'GOLD';

export type LadderId = 'actions' | 'days' | 'weeks' | 'series' | 'hours' | 'flasks' | 'milestones' | 'completed';

/**
 * Glyphs of the medal art (ui/achievements/medals.tsx draws one per name). Kept in the domain
 * so the catalogue stays free of UI imports; the UI map is typed against this union.
 */
export type MedalGlyph =
  | 'check-circle'
  | 'calendar-check'
  | 'infinity'
  | 'chain'
  | 'flask-stack'
  | 'flag'
  | 'trophy'
  | 'seedling'
  | 'sparkle'
  | 'drop'
  | 'list'
  | 'pair'
  | 'star'
  | 'compass'
  | 'layers'
  | 'target'
  | 'mountain'
  | 'bolt'
  | 'hourglass'
  | 'stopwatch';

/** An open-ended counter with tiers: «Следующая: 60 · ещё 12». */
export interface LadderDef {
  id: LadderId;
  title: string;
  /** Russian plural forms of the counted unit: one, few, many. */
  unit: [string, string, string];
  icon: MedalGlyph;
  /** What the counter counts, one sentence. */
  description: string;
  howTo: string;
  tiers: { target: number; rarity: Rarity }[];
  /** The counter; every tier of the ladder compares it with its target. */
  value(stats: Stats): number;
  /** Tier description: «30 дней с практикой». */
  tierDescription(target: number): string;
}

export interface AchievementDef {
  /** Stable id stored in the ledger: `${ladderId}-${target}` for tiers, a slug for badges. */
  id: string;
  kind: 'BADGE' | 'TIER';
  ladderId?: LadderId;
  tierIndex?: number;
  title: string;
  description: string;
  howTo: string;
  rarity: Rarity;
  icon: MedalGlyph;
  /** Unlocked iff value(stats) >= target. */
  target: number;
  value(stats: Stats): number;
  /** The skill an unlock is credited to, read at the moment it unlocked; none for global rules. */
  skillOf?(stats: Stats): string | null;
}

export interface AchievementState {
  def: AchievementDef;
  unlocked: boolean;
  /** When the rule most recently became true (see the dating rule in evaluate.ts); null while locked. */
  unlockedAt: string | null;
  skillId: string | null;
  /** min(value, target): progress towards the target. */
  current: number;
  target: number;
}
