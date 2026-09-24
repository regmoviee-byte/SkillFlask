import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { copy } from '../copy';

const t = copy.placeholders;

/** «Ачивки»: the catalogue arrives in package 7. */
export function AchievementsScreen() {
  return (
    <Screen title={t.achievementsTitle} largeTitle>
      <EmptyState illustration="achievements" title={copy.common.soon} text={t.achievementsHint} />
    </Screen>
  );
}
