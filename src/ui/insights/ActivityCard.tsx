import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays } from '../../lib/dates';
import { getAllActivity, getSkillActivity, type ActivityCompletion, type ActivityView } from '../../services/insights';
import { haptics } from '../../platform/haptics';
import { Heatmap, HeatmapLegend } from '../components/Heatmap';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { insightsCopy } from './strings';
import { HeatmapSkeleton } from './skeleton';

// The heat map with its caption and legend, and the sheet of a tapped day (lazy chunk, see
// lazy.tsx). `skillId` null is the home screen's map of every skill: its day sheet groups the
// completions by skill, each group a link to that skill's history, and an empty map is no map
// at all there (the home screen says nothing about days without activity). A skill's own map
// ends its day sheet with «История навыка», which scrolls its screen down to the history.

const t = insightsCopy.activity;

interface ActivityCardProps {
  /** The skill of the map; null for every skill together. */
  skillId: string | null;
  /**
   * How an empty map speaks: true — what will appear here (an active skill, maybe new); false —
   * that half a year had no practice (an archived or completed skill).
   */
  active: boolean;
  today: string;
  /** The section or tile around the map (lazy.tsx), the same as around its placeholder. */
  frame(content: ReactNode): ReactNode;
}

export default function ActivityCard({ skillId, active, today, frame }: ActivityCardProps) {
  const view = useLiveQuery(() => (skillId ? getSkillActivity(skillId, today) : getAllActivity(today)), [skillId, today]);
  const [day, setDay] = useState<string | null>(null);
  if (view === undefined) return frame(<HeatmapSkeleton />);
  if (view === null) return null;

  const activeDays = view.days.size;
  if (skillId === null && activeDays === 0) return null;
  return frame(
    <div className="heatmap-content">
      <Heatmap from={view.from} today={view.today} days={view.days} label={t.summary(activeDays)} onSelect={setDay} />
      <div className="heatmap-foot">
        <span className="heatmap-caption">{activeDays > 0 ? t.caption(activeDays) : active ? t.empty : t.emptyPast}</span>
        {activeDays > 0 && <HeatmapLegend />}
      </div>
      <DaySheet date={day} view={view} skillId={skillId} onDate={setDay} onClose={() => setDay(null)} />
    </div>,
  );
}

interface DaySheetProps {
  date: string | null;
  view: ActivityView;
  skillId: string | null;
  onDate(date: string): void;
  onClose(): void;
}

/** A day of the map: what was done (step, points, minutes, note), ‹ › to the neighbouring days. */
function DaySheet({ date, view, skillId, onDate, onClose }: DaySheetProps) {
  // The last day stays on screen while the sheet slides out.
  const [shown, setShown] = useState(date);
  if (date !== null && date !== shown) setShown(date);
  const navigate = useNavigate();
  const closeRef = useRef<() => void>(() => {});
  /** Where to go once the sheet has closed (its history entry popped): a skill's history. */
  const pending = useRef<string | null>(null);
  /** The skill's own history, scrolled to once the sheet has let go of the page (onExited). */
  const scrollToHistory = useRef(false);
  // A day opened again before the sheet slid out cancels that scroll.
  if (date !== null) scrollToHistory.current = false;

  function openHistory(id: string) {
    haptics.tap();
    pending.current = id;
    closeRef.current();
  }

  function closed() {
    const id = pending.current;
    pending.current = null;
    onClose();
    if (id === null) return;
    if (skillId === null) navigate(`/skills/${id}`, { state: { focus: 'history' } });
    else scrollToHistory.current = true;
  }

  function exited() {
    if (!scrollToHistory.current) return;
    scrollToHistory.current = false;
    document.querySelector('.history')?.scrollIntoView({ block: 'start' });
  }

  const items = shown ? (view.byDate.get(shown) ?? []) : [];
  const info = shown ? view.days.get(shown) : undefined;
  const step = (n: number) => {
    if (!shown) return;
    haptics.select();
    onDate(addDays(shown, n));
  };

  return (
    <Sheet open={date !== null} onClose={closed} ariaLabel={shown ? t.dayTitle(shown) : undefined} closeRef={closeRef} className="day-sheet" onExited={exited}>
      {shown && (
        <>
          <div className="day-sheet-head">
            <button type="button" className="icon-button" aria-label={t.previousDay} disabled={shown <= view.from} onClick={() => step(-1)}>
              <Icon name="chevron-left" size={22} />
            </button>
            <div className="day-sheet-title">
              <h2 className="sheet-title">{t.dayTitle(shown)}</h2>
              {info && <p className="hint">{t.daySummary(info.completions, info.points)}</p>}
            </div>
            <button type="button" className="icon-button" aria-label={t.nextDay} disabled={shown >= view.today} onClick={() => step(1)}>
              <Icon name="chevron-right" size={22} />
            </button>
          </div>
          {items.length === 0 ? (
            <p className="day-sheet-empty hint">{t.dayEmpty}</p>
          ) : skillId === null ? (
            groupBySkill(items).map(([id, list]) => (
              <section key={id} className="day-sheet-group">
                <button type="button" className="day-sheet-skill pressable-row" aria-label={t.skillHistory(view.skillNames[id] ?? '')} onClick={() => openHistory(id)}>
                  <span>{view.skillNames[id]}</span>
                  <Icon name="chevron-right" size={18} />
                </button>
                <DayList items={list} />
              </section>
            ))
          ) : (
            <>
              <DayList items={items} />
              <button type="button" className="text-button day-sheet-history" onClick={() => openHistory(skillId)}>
                {t.history}
              </button>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

function groupBySkill(items: ActivityCompletion[]): [string, ActivityCompletion[]][] {
  const groups = new Map<string, ActivityCompletion[]>();
  for (const item of items) groups.set(item.skillId, [...(groups.get(item.skillId) ?? []), item]);
  return [...groups];
}

function DayList({ items }: { items: ActivityCompletion[] }) {
  return (
    <ul className="list day-sheet-list">
      {items.map((c) => (
        <li key={c.id} className="day-sheet-row">
          <span className="day-sheet-main">
            <span className="day-sheet-name">{c.stepName}</span>
            {c.minutes !== null && <span className="day-sheet-meta">{t.minutes(c.minutes)}</span>}
            {c.note && <span className="day-sheet-note">{c.note}</span>}
          </span>
          <span className="day-sheet-points">{t.points(c.points)}</span>
        </li>
      ))}
    </ul>
  );
}
