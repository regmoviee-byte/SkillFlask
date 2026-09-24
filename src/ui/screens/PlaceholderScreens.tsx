import { Link } from 'react-router';
import { Screen } from '../components/Screen';
import { copy } from '../copy';

const t = copy.placeholders;

export function AchievementsScreen() {
  return (
    <Screen title={t.achievementsTitle}>
      <div className="empty">
        <p className="empty-title">{copy.common.soon}</p>
        <p className="hint">{t.achievementsHint}</p>
      </div>
    </Screen>
  );
}

export function TodoScreen() {
  return (
    <Screen title={t.todoTitle}>
      <div className="empty">
        <p className="empty-title">{copy.common.soon}</p>
        <p className="hint">{t.todoHint}</p>
        <Link to="/skills" className="button button-secondary" replace>
          {t.toSkills}
        </Link>
      </div>
    </Screen>
  );
}

export function AccountScreen() {
  return (
    <Screen title={t.accountTitle}>
      <section className="card card-padded">
        <p>{t.version(__APP_VERSION__)}</p>
        <p className="hint">{t.localData}</p>
      </section>
    </Screen>
  );
}
