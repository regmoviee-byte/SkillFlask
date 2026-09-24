import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { flushCloudBackup } from '../services/backupSync';
import { getSetting } from '../services/settings';
import { useAppLifecycle } from '../platform/telegram';
import { DialogHost } from './components/DialogHost';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isTabRoute, TabBar, TabBarContext } from './components/TabBar';
import { ToastProvider } from './components/Toast';
import { setMotionPreference, type MotionPreference } from './hooks/useMotion';
import { AddActionScreen } from './screens/AddActionScreen';
import { AchievementsScreen, TodayScreen } from './screens/PlaceholderScreens';
import { SettingsScreen } from './screens/SettingsScreen';
import { SkillFormScreen } from './screens/SkillFormScreen';
import { SkillScreen } from './screens/SkillScreen';
import { SkillsScreen } from './screens/SkillsScreen';
import { StepFormScreen } from './screens/StepFormScreen';

// The styleguide exists only in development builds; the dead branch keeps it out of the bundle.
const StyleguideScreen = import.meta.env.DEV ? lazy(() => import('./screens/StyleguideScreen')) : null;

// Hash routing works on any static host and inside the Telegram Mini App webview without server rewrites.
export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  const location = useLocation();
  const hasTabBar = isTabRoute(location.pathname);

  useEffect(() => {
    // The «Уменьшить движение» setting (package 4) is applied on top of prefers-reduced-motion.
    getSetting<MotionPreference>('motion', 'system').then(setMotionPreference, () => {});
  }, []);
  // Leaving the app (Telegram `deactivated`, or the page hidden) saves pending changes to the
  // cloud at once instead of after the 30 s debounce.
  useAppLifecycle(undefined, () => void flushCloudBackup());

  return (
    <TabBarContext.Provider value={hasTabBar}>
      <ToastProvider routeKey={location.pathname}>
        <div className="app">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/skills" replace />} />
              <Route path="/today" element={<TodayScreen />} />
              <Route path="/skills" element={<SkillsScreen />} />
              <Route path="/skills/new" element={<SkillFormScreen />} />
              <Route path="/skills/:skillId" element={<SkillScreen />} />
              <Route path="/skills/:skillId/edit" element={<SkillFormScreen />} />
              <Route path="/skills/:skillId/add" element={<AddActionScreen />} />
              <Route path="/steps/new" element={<StepFormScreen />} />
              <Route path="/steps/:stepId/edit" element={<StepFormScreen />} />
              <Route path="/achievements" element={<AchievementsScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="/todo" element={<Navigate to="/today" replace />} />
              <Route path="/account" element={<Navigate to="/settings" replace />} />
              {StyleguideScreen && (
                <Route
                  path="/styleguide"
                  element={
                    <Suspense fallback={null}>
                      <StyleguideScreen />
                    </Suspense>
                  }
                />
              )}
              <Route path="*" element={<Navigate to="/skills" replace />} />
            </Routes>
          </ErrorBoundary>
          {hasTabBar && <TabBar />}
        </div>
        <DialogHost />
      </ToastProvider>
    </TabBarContext.Provider>
  );
}
