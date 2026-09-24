import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { copy } from '../copy';

const t = copy.placeholders;

export function AchievementsScreen() {
  return (
    <Screen title={t.achievementsTitle} largeTitle>
      <EmptyState illustration="achievements" title={copy.common.soon} text={t.achievementsHint} />
    </Screen>
  );
}

/** «Сегодня»: real content arrives in package 6. */
export function TodayScreen() {
  return (
    <Screen title={t.todayTitle} largeTitle>
      <EmptyState illustration="today" title={copy.common.soon} text={t.todayHint} action={{ label: t.toSkills, to: '/skills', replace: true }} />
    </Screen>
  );
}
