import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { AchievementState } from '../../domain/achievements/types';
import { formatDate, nowIso } from '../../lib/dates';
import { logError } from '../../platform/errorLog';
import { haptics } from '../../platform/haptics';
import { getAchievementsView, markAchievementsSeen, type AchievementsView } from '../../services/achievements';
import { AchievementSheet } from '../achievements/AchievementSheet';
import { Badge, badgeState } from '../components/Badge';
import { LadderCard, tierState } from '../components/LadderCard';
import { Ring } from '../components/Ring';
import { Screen } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { copy } from '../copy';

// «Ачивки»: a summary with the ring and the last unlock, a filter, the seven ladders and the
// badge tiles. Everything comes from the engine through one live query; opening the tab marks
// the new unlocks as seen after a moment (the tab's dot goes out). Nothing here is ever
// «failed»: an achievement is earned, on its way or ahead.

const t = copy.achievements;

type Filter = 'all' | 'earned' | 'ahead';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: t.filterAll },
  { value: 'earned', label: t.filterEarned },
  { value: 'ahead', label: t.filterAhead },
];

/** The dot on the tab goes out this long after the unlocks were on screen. */
const SEEN_DELAY_MS = 800;
/** A locked tile shows the start of «Как получить». */
const HOW_TO_CHARS = 40;

export function AchievementsScreen() {
  const view = useLiveQuery(getAchievementsView, []);
  const [params, setParams] = useSearchParams();
  const filter: Filter = FILTERS.find((f) => f.value === params.get('filter'))?.value ?? 'all';
  const focus = params.get('focus');
  const [open, setOpen] = useState<AchievementState | null>(null);

  const unseen = view?.unseenCount ?? 0;
  useEffect(() => {
    if (unseen === 0) return;
    const timer = window.setTimeout(() => {
      markAchievementsSeen(nowIso()).catch((error: unknown) => logError(error, 'markAchievementsSeen'));
    }, SEEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [unseen]);

  const setFilter = (next: Filter) => {
    if (next === filter) return;
    haptics.select();
    setParams(next === 'all' ? {} : { filter: next }, { replace: true });
  };

  return (
    <Screen title={t.title} largeTitle>
      <Skeleton layout="achievements" loading={view === undefined}>
        {view && <Content view={view} filter={filter} focus={focus} onFilter={setFilter} onOpen={setOpen} />}
      </Skeleton>
      <AchievementSheet state={open} skillNames={view?.skillNames ?? {}} onClose={() => setOpen(null)} />
    </Screen>
  );
}

interface ContentProps {
  view: AchievementsView;
  filter: Filter;
  focus: string | null;
  onFilter(next: Filter): void;
  onOpen(state: AchievementState): void;
}

function Content({ view, filter, focus, onFilter, onOpen }: ContentProps) {
  const ladders = view.ladders.filter((l) => (filter === 'earned' ? l.tierIndex >= 0 : filter === 'ahead' ? l.next !== null : true));
  const badges = view.badges.filter((b) => (filter === 'earned' ? b.unlocked : filter === 'ahead' ? !b.unlocked : true));
  const scrolled = useRef(false);

  // ?focus=id (the achievement card): bring its tile or ladder into view once.
  useEffect(() => {
    if (!focus || scrolled.current) return;
    scrolled.current = true;
    document.querySelector('[data-focus]')?.scrollIntoView({ block: 'center' });
  }, [focus]);

  return (
    <>
      <Summary view={view} onOpen={onOpen} />

      <div className="filter-chips" role="group" aria-label={t.filterLabel}>
        {FILTERS.map((f) => (
          <button key={f.value} type="button" className="chip" aria-pressed={filter === f.value} onClick={() => onFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {ladders.length === 0 && badges.length === 0 && <p className="hint ach-empty">{filter === 'earned' ? t.earnedNone : t.aheadNone}</p>}

      {ladders.length > 0 && (
        <section className="ach-section" aria-labelledby="ach-ladders">
          <h2 className="section-title" id="ach-ladders">
            {t.ladders}
          </h2>
          {ladders.map((ladder) => (
            <LadderCard key={ladder.def.id} ladder={ladder} focusId={focus} onOpen={onOpen} />
          ))}
        </section>
      )}

      {badges.length > 0 && (
        <section className="ach-section" aria-labelledby="ach-badges">
          <h2 className="section-title" id="ach-badges">
            {t.badges}
          </h2>
          <ul className="ach-grid">
            {badges.map((state) => (
              <li key={state.def.id}>
                <BadgeTile state={state} focused={state.def.id === focus} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Summary({ view, onOpen }: { view: AchievementsView; onOpen(state: AchievementState): void }) {
  const last = view.lastUnlocked;
  return (
    <section className="card ach-summary">
      <span className="ach-summary-ring">
        <Ring value={view.unlockedCount / view.total} size={64} stroke={5} label={t.summaryLabel(view.unlockedCount, view.total)}>
          {view.unlockedCount}
        </Ring>
        <span className="t-caption ach-summary-of">{t.summaryOf(view.total)}</span>
      </span>
      {last ? (
        <button type="button" className="ach-summary-last pressable" onClick={() => onOpen(last)}>
          <span className="t-label ach-summary-label">{t.last}</span>
          <span className="ach-summary-row">
            <Badge rarity={last.def.rarity} size={40} state="unlocked" icon={last.def.icon} />
            <span className="ach-summary-text">
              <span className="t-body-strong ach-summary-title">{last.def.title}</span>
              <span className="ach-summary-meta">{t.lastMeta(last.skillId ? (view.skillNames[last.skillId] ?? null) : null, last.unlockedAt!)}</span>
            </span>
          </span>
        </button>
      ) : (
        <p className="ach-summary-last hint">{t.noneYet}</p>
      )}
    </section>
  );
}

function BadgeTile({ state, focused, onOpen }: { state: AchievementState; focused: boolean; onOpen(state: AchievementState): void }) {
  const { def } = state;
  const look = badgeState(state);
  const caption =
    look === 'unlocked' ? formatDate(state.unlockedAt!) : look === 'progress' ? t.progress(state.current, state.target) : howToStart(def.howTo);
  return (
    <button
      type="button"
      className={`card pressable ach-tile ach-tile--${def.rarity.toLowerCase()} is-${look}${focused ? ' is-focus' : ''}`}
      data-focus={focused || undefined}
      aria-label={t.tileLabel(def.title, tierState(state))}
      onClick={() => onOpen(state)}
    >
      <Badge rarity={def.rarity} size={56} state={look} icon={def.icon} progress={state.current / state.target} />
      <span className="ach-tile-title">{def.title}</span>
      <span className="ach-tile-caption">{caption}</span>
    </button>
  );
}

/** The first words of «Как получить», cut at a word boundary. */
function howToStart(text: string): string {
  if (text.length <= HOW_TO_CHARS) return text;
  const cut = text.slice(0, HOW_TO_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s,.—–-]+$/, '')}…`;
}
