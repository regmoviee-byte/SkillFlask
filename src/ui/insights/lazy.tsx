import { Suspense, type ReactNode } from 'react';
import { copy } from '../copy';
import { lazySafe } from '../lazySafe';
import { ForecastPlaceholder, HeatmapSkeleton } from './skeleton';

// The entry points of «Прогноз» and «Активность» (v0.5 package 14) for the screens: what they
// render comes from lazy chunks (ForecastLine.tsx, ActivityCard.tsx with the heat map, the day
// and forecast sheets, their read models and strings), loaded the first time a screen shows
// them. Their places are kept meanwhile, so nothing below them moves when they arrive: the
// forecast line's by a placeholder of its height (the screen renders it only when
// getSkillDetails says there is a forecast), the heat map's by a skeleton of the same size (the
// grid is 26 : 7 of the width, the rows around it fixed). A chunk that fails to load leaves
// its place empty instead of taking the app down (lazySafe).

const ForecastLine = lazySafe(() => import('./ForecastLine'), 'ForecastLine');
const ActivityCard = lazySafe(() => import('./ActivityCard'), 'ActivityCard');

/** «В таком темпе колба 3 заполнится ≈ 12 октября» under the hero of an active skill with a forecast. */
export function SkillForecast({ skillId, today }: { skillId: string; today: string }) {
  return (
    <Suspense fallback={<ForecastPlaceholder />}>
      <ForecastLine skillId={skillId} today={today} />
    </Suspense>
  );
}

/** The skill screen's «Активность»: the skill's own heat map, in its colour. */
export function SkillActivity({ skillId, active, today }: { skillId: string; active: boolean; today: string }) {
  const frame = (content: ReactNode) => (
    <section className="activity">
      <h2 className="section-title">{copy.skill.activity}</h2>
      <div className="card heatmap-card">{content}</div>
    </section>
  );
  return (
    <Suspense fallback={frame(<HeatmapSkeleton />)}>
      <ActivityCard skillId={skillId} active={active} today={today} frame={frame} />
    </Suspense>
  );
}

/**
 * The home screen's wide tile «Активность · все навыки»: every skill together, in the accent.
 * The screen shows it when a completion was written inside the map's half year; the card still
 * drops the tile when the map turns out empty (a completion back-dated further than that), since
 * the home screen says nothing about days without activity.
 */
export function HomeActivity({ today }: { today: string }) {
  const frame = (content: ReactNode) => (
    <div className="tile tile--wide tile--activity">
      <span className="tile-label t-label">{copy.home.activity}</span>
      {content}
    </div>
  );
  return (
    <Suspense fallback={frame(<HeatmapSkeleton />)}>
      <ActivityCard skillId={null} active={false} today={today} frame={frame} />
    </Suspense>
  );
}
