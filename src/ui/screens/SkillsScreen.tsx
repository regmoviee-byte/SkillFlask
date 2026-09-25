import { Link, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { SkillStatus } from '../../domain/types';
import { formatNumber } from '../../lib/format';
import { getHomeView, type HomeView } from '../../services/queries';
import type { LastWeekLine } from '../../services/recap';
import { haptics } from '../../platform/haptics';
import { EmptyState } from '../components/EmptyState';
import { Badge } from '../components/Badge';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { SkillCard } from '../components/SkillCard';
import { Skeleton } from '../components/Skeleton';
import { Tile, TileNumber, TodayTile } from '../components/Tile';
import { copy } from '../copy';
import { useToday } from '../hooks/useToday';
import type { ProgressThemeKey } from '../progress/contract';
import { ProgressMini } from '../progress/ProgressHero';
import { skillTheme } from '../progress/registry';

// Home as a motivation panel (wireframe 1): a bento row — today's points with the week's
// dots, the levels completed so far (all skills, whatever their themes: «Пройдено»), the last achievement (or the next one), «Итоги недели» for
// the week before — then the skill cards. Facts only: no charts, no targets, nothing about
// days without activity.

const t = copy.home;

const SEGMENTS: { status: SkillStatus; param: string; label: string }[] = [
  { status: 'ACTIVE', param: 'active', label: t.filterActive },
  { status: 'COMPLETED', param: 'completed', label: t.filterCompleted },
  { status: 'ARCHIVED', param: 'archived', label: t.filterArchived },
];

/**
 * Completed levels drawn in the «Пройдено» tile, at most (four fit the tile on a 320 px phone).
 * Past that, one fewer and «+N» for the rest: the picture always adds up to the number.
 */
const TILE_FLASKS = 4;

/**
 * The themes (and numbers) of the first `count` completed levels, skill by skill in the list's order: each
 * drawing in the tile is a real level of a real skill, in that skill's theme.
 */
function tileLevels(home: HomeView, count: number): { theme: ProgressThemeKey; level: number }[] {
  const out: { theme: ProgressThemeKey; level: number }[] = [];
  for (const { skill, progress } of home.summaries) {
    for (let i = 0; i < progress.completedFlasks && out.length < count; i++) out.push({ theme: skillTheme(skill.theme), level: i + 1 });
  }
  return out;
}

export function SkillsScreen() {
  const today = useToday();
  const home = useLiveQuery(() => getHomeView(today), [today]);
  // The segment lives in the URL (`#/skills?filter=archived`), so «Назад» from a card opened
  // in «Архив» returns to «Архив»; switching replaces the entry instead of adding one.
  const [params, setParams] = useSearchParams();
  const filter = SEGMENTS.find((segment) => segment.param === params.get('filter'))?.status ?? 'ACTIVE';
  const setFilter = (next: SkillStatus) => {
    const param = SEGMENTS.find((segment) => segment.status === next)!.param;
    setParams(next === 'ACTIVE' ? {} : { filter: param }, { replace: true });
  };

  const addButton = (
    <Link to="/skills/new" className="icon-button" aria-label={t.newSkill}>
      <Icon name="plus" size={26} />
    </Link>
  );

  return (
    <Screen title={t.title} largeTitle action={addButton}>
      <Skeleton layout="home" loading={home === undefined}>
        {home && <HomeContent home={home} today={today} filter={filter} onFilter={setFilter} />}
      </Skeleton>
    </Screen>
  );
}

interface HomeContentProps {
  home: HomeView;
  today: string;
  filter: SkillStatus;
  onFilter(next: SkillStatus): void;
}

function HomeContent({ home, today, filter, onFilter }: HomeContentProps) {
  if (home.summaries.length === 0) {
    return (
      <EmptyState
        illustration="skills"
        title={t.emptyTitle}
        text={t.emptyText}
        action={{ label: t.create, to: '/skills/new' }}
        secondary={
          <Link to="/skills/new?template=english" className="text-button">
            {t.example}
          </Link>
        }
      />
    );
  }

  const counts = { ACTIVE: 0, COMPLETED: 0, ARCHIVED: 0 };
  for (const s of home.summaries) counts[s.skill.status] += 1;
  // A segment exists only while it has skills; a filter left empty falls back to the first one.
  const segments = SEGMENTS.filter((segment) => counts[segment.status] > 0);
  const shown = counts[filter] > 0 ? filter : (segments[0]?.status ?? 'ACTIVE');
  const visible = home.summaries.filter((s) => s.skill.status === shown);
  // A filter with one option filters nothing: the chips appear from two non-empty segments.
  const showChips = segments.length >= 2;
  // «Новый навык» closes the active list; with no active skill left it closes whatever is shown.
  const showNewCard = shown === 'ACTIVE' || counts.ACTIVE === 0;

  return (
    <>
      <div className="bento">
        <TodayTile points={home.todayPoints} week={home.weekActivity} today={today} to="/today" />
        <Tile label={t.tileLevels} className="tile--flasks">
          <TileNumber value={home.totalFlasks} caption={t.levelsCaption(home.totalFlasks)} />
          {home.totalFlasks > 0 && (
            <span className="tile-flasks" aria-hidden="true">
              {tileLevels(home, home.totalFlasks > TILE_FLASKS ? TILE_FLASKS - 1 : home.totalFlasks).map(({ theme, level }, i) => (
                <ProgressMini key={i} theme={theme} fill={1} state="complete" size={26} level={level} />
              ))}
              {home.totalFlasks > TILE_FLASKS && <span className="tile-flasks-more">+{formatNumber(home.totalFlasks - TILE_FLASKS + 1)}</span>}
            </span>
          )}
        </Tile>
        <AchievementTile home={home} />
        {home.lastWeek && <RecapTile line={home.lastWeek} />}
      </div>

      {showChips && (
        <div className="filter-chips" role="group" aria-label={t.filterLabel}>
          {segments.map((segment) => (
            <button
              key={segment.status}
              type="button"
              className="chip"
              aria-pressed={shown === segment.status}
              onClick={() => {
                if (shown === segment.status) return;
                haptics.select();
                onFilter(segment.status);
              }}
            >
              {segment.label}
            </button>
          ))}
        </div>
      )}

      <ul className="skill-cards">
        {visible.map((summary) => (
          <SkillCard key={summary.skill.id} summary={summary} />
        ))}
        {showNewCard && (
          <li>
            <Link to="/skills/new" className="dashed-card pressable">
              <Icon name="plus" size={20} />
              {t.newSkill}
            </Link>
          </li>
        )}
      </ul>
    </>
  );
}

/** «Итоги недели · 14–20 сентября»: the previous week, all through this one, when it had a completion. */
function RecapTile({ line }: { line: LastWeekLine }) {
  return (
    <Link to="/recap" className="tile tile--wide tile--recap pressable">
      <span className="tile-recap-icon" aria-hidden="true">
        <Icon name="laurel" size={20} />
      </span>
      <span className="tile-text">
        <span className="tile-ach-label">{copy.recap.homeLabel(line.weekStart)}</span>
        <span className="tile-ach-title">{copy.recap.homeMeta(line.points, line.activeDays)}</span>
      </span>
      <Icon name="chevron-right" size={20} className="tile-chevron" />
    </Link>
  );
}

/**
 * The wide tile: «Последняя ачивка» with its medal and date, or «Следующая» with its progress
 * before the first one. A milestone reached after the last achievement stays as a caption.
 */
function AchievementTile({ home }: { home: HomeView }) {
  const { last, next } = home.achievements;
  const milestone = home.lastMilestone;
  const showMilestone = milestone !== null && (!last || milestone.reachedAt > last.unlockedAt!);
  return (
    <Link to="/achievements" className="tile tile--wide tile--achievement pressable">
      {last ? (
        <Badge rarity={last.def.rarity} size={32} state="unlocked" icon={last.def.icon} />
      ) : next ? (
        <Badge rarity={next.def.rarity} size={32} state="locked" icon={next.def.icon} />
      ) : (
        <Icon name="medal" size={22} className="tile-icon" />
      )}
      <span className="tile-text">
        {last ? (
          <>
            <span className="tile-ach-label">{t.achievementLastOn(last.unlockedAt!)}</span>
            <span className="tile-ach-title">{last.def.title}</span>
          </>
        ) : next ? (
          <>
            <span className="tile-ach-label">{t.achievementNext}</span>
            <span className="tile-ach-title">{t.achievementNextMeta(next.def.title, next.current, next.target)}</span>
            <span className="bar tile-ach-bar" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${Math.round((next.current / next.target) * 100)}%` }} />
            </span>
          </>
        ) : (
          <span className="hint">{t.achievementNone}</span>
        )}
        {showMilestone && <span className="tile-ach-caption">{t.lastMilestone(milestone.name, milestone.skillName, milestone.reachedAt)}</span>}
      </span>
      <Icon name="chevron-right" size={20} className="tile-chevron" />
    </Link>
  );
}
