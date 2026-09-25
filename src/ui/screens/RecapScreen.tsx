import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, isValidLocalDate, weekStart } from '../../lib/dates';
import { haptics } from '../../platform/haptics';
import { getRecapView, lastCompletedWeek, type RecapView } from '../../services/recap';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { InfoList, recordRow, type InfoRowSpec } from '../components/RecordList';
import { Screen } from '../components/Screen';
import { Skeleton } from '../components/Skeleton';
import { Tile, TileNumber } from '../components/Tile';
import { WeekStrip } from '../components/WeekStrip';
import { copy } from '../copy';
import { useToday } from '../hooks/useToday';

// «Итоги недели» (`/recap`, the last completed week, and `/recap/:weekStart`): a week switcher,
// four bento tiles, «Лучшее за неделю» (the top skill and action, milestones, records set) and
// the achievements of the week. Facts only: a week without completions says so plainly, and
// the week before is mentioned only when this one did better (tone rules 3 and 5).

const t = copy.recap;

/** The week a route names: its Monday, never after the current week; the last completed one by default. */
function weekOf(param: string | undefined, today: string): string {
  const current = weekStart(today);
  if (!param || !isValidLocalDate(param)) return lastCompletedWeek(today);
  const week = weekStart(param);
  return week > current ? current : week;
}

export function RecapScreen() {
  const { weekStart: param } = useParams();
  const today = useToday();
  const week = weekOf(param, today);
  const current = weekStart(today);
  const isCurrent = week === current;
  const view = useLiveQuery(() => getRecapView(week, today), [week, today]);
  // Stale while the next week loads: the switcher stays put, the content waits.
  const shown = view?.recap.weekStart === week ? view : undefined;
  const navigate = useNavigate();
  const go = (next: string) => {
    haptics.select();
    // Switching weeks replaces the entry: «Назад» leaves the recap for where it was opened from.
    navigate(`/recap/${next}`, { replace: true });
  };
  const canGoBack = view !== undefined && week > view.firstWeek;

  return (
    <Screen title={t.title} back="/skills" largeTitle>
      <div className="recap-switcher" role="group" aria-label={t.switcher}>
        <button type="button" className="icon-button" aria-label={t.previous} disabled={!canGoBack} onClick={() => go(addDays(week, -7))}>
          <Icon name="chevron-left" />
        </button>
        <span className="recap-switcher-label" aria-live="polite">
          <span className="t-title-s">{t.range(week)}</span>
          {isCurrent && <span className="recap-switcher-note">{t.inProgress}</span>}
        </span>
        <button type="button" className="icon-button" aria-label={t.next} disabled={isCurrent} onClick={() => go(addDays(week, 7))}>
          <Icon name="chevron-right" />
        </button>
      </div>
      <Skeleton layout="home" loading={shown === undefined}>
        {shown && <RecapContent view={shown} isCurrent={isCurrent} today={today} />}
      </Skeleton>
    </Screen>
  );
}

function RecapContent({ view, isCurrent, today }: { view: RecapView; isCurrent: boolean; today: string }) {
  const { recap, skillNames } = view;
  const name = (skillId: string) => skillNames[skillId] ?? '';
  if (recap.completions === 0) {
    return (
      <>
        <EmptyState illustration="history" title={isCurrent ? t.emptyCurrentTitle : t.emptyTitle} text={isCurrent ? undefined : t.emptyText} />
        <WeekAchievements view={view} />
      </>
    );
  }

  const best: InfoRowSpec[] = [];
  if (recap.topSkill) {
    const { skillId, points } = recap.topSkill;
    best.push({ key: 'skill', icon: 'flask', title: t.topSkill, meta: name(skillId), value: copy.records.points(points), to: `/skills/${skillId}` });
  }
  if (recap.topAction) {
    const { skillId, name: action, count } = recap.topAction;
    best.push({ key: 'action', icon: 'check', title: t.topAction, meta: t.topActionMeta(action, name(skillId)), value: t.topActionValue(count), to: `/skills/${skillId}` });
  }
  for (const m of recap.milestones) {
    best.push({ key: `ms:${m.skillId}`, icon: 'flag', title: t.milestone(m.name), meta: t.milestoneMeta(name(m.skillId), m.date), to: `/skills/${m.skillId}` });
  }
  for (const kind of recap.records) {
    const row = recordRow(kind, view.records, skillNames, false);
    if (row) best.push({ ...row, key: `rec:${kind}`, icon: 'laurel', meta: t.recordMeta(row.meta) });
  }

  return (
    <>
      <div className="bento recap-bento">
        <Tile label={t.tilePoints}>
          <TileNumber value={recap.points} caption={t.pointsCaption(recap.points)} />
        </Tile>
        <Tile label={t.tileDays} className="tile--days">
          <TileNumber value={recap.activeDays} caption={t.daysCaption(recap.activeDays)} />
          <WeekStrip days={recap.days} today={isCurrent ? today : undefined} />
        </Tile>
        <Tile label={t.tileCompletions}>
          <TileNumber value={recap.completions} caption={t.completionsCaption(recap.completions)} />
        </Tile>
        <Tile label={t.tileFlasks}>
          <TileNumber value={recap.flasksFilled} caption={t.flasksCaption(recap.flasksFilled)} />
        </Tile>
      </div>

      {(recap.morePointsThanWeekBefore || recap.moreDaysThanWeekBefore) && (
        <p className="recap-compare">
          <Icon name="sparkle" size={18} />
          {recap.morePointsThanWeekBefore ? t.morePoints : t.moreDays}
        </p>
      )}

      {best.length > 0 && (
        <section className="recap-section" aria-labelledby="recap-best">
          <h2 className="section-title" id="recap-best">
            {t.best}
          </h2>
          <InfoList rows={best} />
        </section>
      )}

      <WeekAchievements view={view} />
    </>
  );
}

/** The achievements earned during the week: medal chips that open them on the tab. */
function WeekAchievements({ view }: { view: RecapView }) {
  const { achievements } = view.recap;
  if (achievements.length === 0) return null;
  return (
    <section className="recap-section" aria-labelledby="recap-achievements">
      <h2 className="section-title" id="recap-achievements">
        {t.achievements}
      </h2>
      <ul className="recap-ach">
        {achievements.map((state) => (
          <li key={state.def.id}>
            <Link to={`/achievements?focus=${encodeURIComponent(state.def.id)}`} className="recap-ach-chip pressable">
              <Badge rarity={state.def.rarity} size={32} state="unlocked" icon={state.def.icon} />
              <span className="recap-ach-title">{state.def.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
