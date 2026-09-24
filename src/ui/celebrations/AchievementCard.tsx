import { useEffect, useRef, useState } from 'react';
import type { AchievementState } from '../../domain/achievements/types';
import { Badge } from '../components/Badge';
import { copy } from '../copy';

// A new achievement: an opaque card slides in at the top (the TopCard's place and motion), the
// medal turns in, and it leaves by itself after 3.5 s. Swipe up dismisses it; a tap opens the
// achievement on the «Ачивки» tab. Never a modal: the screen underneath stays usable.

export interface AchievementCardContent {
  /** The achievements of one write; more than two are told in one card. */
  states: AchievementState[];
  /** Name of the skill the first one is credited to. */
  skillName: string | null;
}

const SHOW_MS = 3500;
const EXIT_MS = 240;

interface AchievementCardProps {
  content: AchievementCardContent;
  /** Leave now: the level-up card needs the place. */
  yieldPlace?: boolean;
  onOpen(id: string): void;
  onDone(): void;
}

export function AchievementCard({ content, yieldPlace = false, onOpen, onDone }: AchievementCardProps) {
  const [state, setState] = useState<'enter' | 'shown' | 'leaving'>('enter');
  const startY = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    // A dismissal in the very first frame wins over the entrance.
    const frame = requestAnimationFrame(() => setState((current) => (current === 'enter' ? 'shown' : current)));
    const timer = window.setTimeout(() => setState('leaving'), SHOW_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (yieldPlace) setState('leaving');
  }, [yieldPlace]);

  useEffect(() => {
    if (state !== 'leaving') return;
    const timer = window.setTimeout(() => onDoneRef.current(), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const [first, ...rest] = content.states;
  if (!first) return null;
  const title = rest.length > 0 ? copy.achievements.cardMore(first.def.title, rest.length) : first.def.title;
  // One: the skill it is credited to, or what it is for. Several: the others by name.
  const caption = rest.length > 0 ? rest.map((s) => s.def.title).join(', ') : (content.skillName ?? first.def.description);

  return (
    <div className="top-card ach-card anim-func" data-state={state} role="status">
      <button
        type="button"
        className="top-card-body"
        aria-label={copy.achievements.cardOpen(title)}
        onClick={() => {
          setState('leaving');
          onOpen(first.def.id);
        }}
        onTouchStart={(event) => {
          startY.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchMove={(event) => {
          const y = event.touches[0]?.clientY;
          if (startY.current !== null && y !== undefined && startY.current - y > 16) {
            startY.current = null;
            setState('leaving');
          }
        }}
      >
        <span className="ach-card-medal">
          <Badge rarity={first.def.rarity} size={44} state="unlocked" icon={first.def.icon} />
        </span>
        <span className="top-card-text">
          <span className="ach-card-overline">{copy.achievements.cardOverline}</span>
          <span className="t-body-strong ach-card-title">{title}</span>
          <span className="top-card-caption">{caption}</span>
        </span>
      </button>
    </div>
  );
}
