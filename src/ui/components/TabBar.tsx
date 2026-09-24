import { createContext, useContext } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { haptics } from '../../platform/haptics';
import { countUnseenAchievements } from '../../services/achievements';
import { copy } from '../copy';
import { Icon, type IconName } from './Icon';

export type TabKey = 'today' | 'skills' | 'achievements' | 'settings';

export const TABS: { key: TabKey; to: string; label: string; icon: IconName }[] = [
  { key: 'today', to: '/today', label: copy.tabs.today, icon: 'sun' },
  { key: 'skills', to: '/skills', label: copy.tabs.skills, icon: 'flask' },
  { key: 'achievements', to: '/achievements', label: copy.tabs.achievements, icon: 'medal' },
  { key: 'settings', to: '/settings', label: copy.tabs.settings, icon: 'sliders' },
];

/** True on the four root routes, where the tab bar is rendered. */
export function isTabRoute(pathname: string): boolean {
  return TABS.some((tab) => tab.to === pathname);
}

/** Whether the current screen has the tab bar under it (bottom padding, toast position). */
export const TabBarContext = createContext(false);

export const useHasTabBar = () => useContext(TabBarContext);

export function TabBar() {
  const location = useLocation();
  // A dot on «Ачивки» while there are unlocks the tab has not shown yet.
  const unseen = useLiveQuery(countUnseenAchievements, [], 0);

  return (
    <nav className="tab-bar" aria-label={copy.tabs.navLabel}>
      {TABS.map((tab) => {
        const active = location.pathname === tab.to;
        const dot = tab.key === 'achievements' && unseen > 0;
        return (
          <NavLink
            key={tab.key}
            to={tab.to}
            className="tab"
            replace
            aria-current={active ? 'page' : undefined}
            aria-label={dot ? copy.achievements.tabNew(unseen) : undefined}
            onClick={(event) => {
              haptics.select();
              if (active) {
                // Re-tapping the active tab scrolls to the top instead of re-navigating.
                event.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
          >
            <Icon name={tab.icon} filled={active} />
            <span>{tab.label}</span>
            {dot && <span className="tab-badge" aria-hidden="true" />}
          </NavLink>
        );
      })}
    </nav>
  );
}
