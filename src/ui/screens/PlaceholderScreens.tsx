import { Link } from 'react-router';
import { Screen } from '../components/Screen';

export function AchievementsScreen() {
  return (
    <Screen title="Ачивки">
      <div className="empty">
        <p className="empty-title">🏅 Скоро</p>
        <p className="hint">Ачивки появятся в следующих версиях. Пока достигнутые вехи видны на главной.</p>
      </div>
    </Screen>
  );
}

export function TodoScreen() {
  return (
    <Screen title="Список дел">
      <div className="empty">
        <p className="empty-title">📅 Скоро</p>
        <p className="hint">
          Здесь будут действия на сегодня по расписанию. Пока выполнения отмечаются вручную на экране навыка.
        </p>
        <Link to="/skills" className="button button-secondary" replace>
          К навыкам
        </Link>
      </div>
    </Screen>
  );
}

export function AccountScreen() {
  return (
    <Screen title="Аккаунт">
      <section className="card card-padded">
        <p>Skill Flask · версия {__APP_VERSION__}</p>
        <p className="hint">
          Данные хранятся только на этом устройстве. Синхронизация между устройствами и резервная копия появятся позже.
        </p>
      </section>
    </Screen>
  );
}
