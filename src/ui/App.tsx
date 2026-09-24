import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { TabBar } from './components/TabBar';
import { ToastProvider } from './components/Toast';
import { AddActionScreen } from './screens/AddActionScreen';
import { AccountScreen, AchievementsScreen, TodoScreen } from './screens/PlaceholderScreens';
import { SkillFormScreen } from './screens/SkillFormScreen';
import { SkillScreen } from './screens/SkillScreen';
import { SkillsScreen } from './screens/SkillsScreen';
import { StepFormScreen } from './screens/StepFormScreen';

// Hash routing works on any static host and inside the Telegram Mini App webview without server rewrites.
export function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <div className="app">
          <Routes>
            <Route path="/" element={<Navigate to="/skills" replace />} />
            <Route path="/skills" element={<SkillsScreen />} />
            <Route path="/skills/new" element={<SkillFormScreen />} />
            <Route path="/skills/:skillId" element={<SkillScreen />} />
            <Route path="/skills/:skillId/edit" element={<SkillFormScreen />} />
            <Route path="/skills/:skillId/add" element={<AddActionScreen />} />
            <Route path="/steps/new" element={<StepFormScreen />} />
            <Route path="/achievements" element={<AchievementsScreen />} />
            <Route path="/todo" element={<TodoScreen />} />
            <Route path="/account" element={<AccountScreen />} />
            <Route path="*" element={<Navigate to="/skills" replace />} />
          </Routes>
          <TabBar />
        </div>
      </ToastProvider>
    </HashRouter>
  );
}
