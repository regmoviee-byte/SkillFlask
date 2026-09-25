import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { syncAchievementsOnStart } from '../services/achievements';
import { flushCloudBackup } from '../services/backupSync';
import { getSetting } from '../services/settings';
import { useAppLifecycle } from '../platform/telegram';
import { isAppearance, setAppearancePreference } from '../platform/theme';
import { CelebrationProvider } from './celebrations/CelebrationProvider';
import { DialogHost } from './components/DialogHost';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isTabRoute, TabBar, TabBarContext } from './components/TabBar';
import { ToastProvider } from './components/Toast';
import { setMotionPreference, type MotionPreference } from './hooks/useMotion';
import { AddActionScreen } from './screens/AddActionScreen';
import { AchievementsScreen } from './screens/AchievementsScreen';
import { RecapScreen } from './screens/RecapScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SkillFormScreen } from './screens/SkillFormScreen';
import { SkillScreen } from './screens/SkillScreen';
import { SkillsScreen } from './screens/SkillsScreen';
import { StepFormScreen } from './screens/StepFormScreen';
import { TodayScreen } from './screens/TodayScreen';
import { StartRedirect } from './StartRedirect';
import { TemplateChooserRoute } from './templates/lazy';
import { TimerLayer } from './timer/TimerLayer';

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
    // «Тема» (package 12): the settings table is the source of truth; this restores the
    // localStorage mirror the inline boot script reads (cleared storage, an old mirror).
    getSetting<unknown>('appearance', 'auto').then((value) => setAppearancePreference(isAppearance(value) ? value : 'auto'), () => {});
    // Files unlocks that appeared without a write (a catalogue entry added in an update):
    // quietly, never celebrated. Idempotent, so StrictMode's second run changes nothing.
    void syncAchievementsOnStart();
  }, []);
  // Leaving the app (Telegram `deactivated`, or the page hidden) saves pending changes to the
  // cloud at once instead of after the 30 s debounce.
  useAppLifecycle(undefined, () => void flushCloudBackup());

  return (
    <TabBarContext.Provider value={hasTabBar}>
      <ToastProvider routeKey={location.pathname}>
        {/* Reward moments (flask level-up, TopCard, milestone sheet) toast through the provider above. */}
        <CelebrationProvider>
          {/* The live timer (package 15): the step rows' ▶, and the pill over every screen. */}
          <TimerLayer>
            <div className="app">
              <ErrorBoundary>
                <Routes>
                  {/* «Сегодня» is the entry once there is an action to tap, the skills before that. */}
                  <Route path="/" element={<StartRedirect />} />
                  <Route path="/today" element={<TodayScreen />} />
                  <Route path="/skills" element={<SkillsScreen />} />
                  {/* A new skill: the template chooser (lazy), then the form — from a template or «Свой навык». */}
                  <Route path="/skills/new" element={<TemplateChooserRoute />} />
                  <Route path="/skills/new/:templateKey" element={<SkillFormScreen />} />
                  <Route path="/skills/:skillId" element={<SkillScreen />} />
                  <Route path="/skills/:skillId/edit" element={<SkillFormScreen />} />
                  <Route path="/skills/:skillId/add" element={<AddActionScreen />} />
                  <Route path="/steps/new" element={<StepFormScreen />} />
                  <Route path="/steps/:stepId/edit" element={<StepFormScreen />} />
                  <Route path="/achievements" element={<AchievementsScreen />} />
                  <Route path="/recap" element={<RecapScreen />} />
                  <Route path="/recap/:weekStart" element={<RecapScreen />} />
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
                  {/* Unknown paths decide like `/`. Telegram launches the app with its own hash
                      (`#tgWebAppData=…&tgWebAppVersion=…`), which lands here, not on `/`. */}
                  <Route path="*" element={<StartRedirect />} />
                </Routes>
              </ErrorBoundary>
              {hasTabBar && <TabBar />}
            </div>
          </TimerLayer>
          <DialogHost />
        </CelebrationProvider>
      </ToastProvider>
    </TabBarContext.Provider>
  );
}
