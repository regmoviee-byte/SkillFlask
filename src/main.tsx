import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installErrorLog } from './platform/errorLog';
import { initHomeScreen } from './platform/homeScreen';
import { registerServiceWorker } from './platform/sw';
import { initTelegram } from './platform/telegram';
import { applyTheme } from './platform/theme';
import { installViewport } from './platform/viewport';
import { App } from './ui/App';
import { dropStaleSheetEntry } from './ui/components/Sheet';
import { DbBoundary } from './ui/DbBoundary';
import { applyMotion } from './ui/hooks/useMotion';
import './ui/styles.css';

installErrorLog();
initTelegram();
applyTheme();
applyMotion();
installViewport();
dropStaleSheetEntry();
// Chrome fires beforeinstallprompt early; Settings offers it later («Добавить на главный экран»).
initHomeScreen();
// Offline start of the installed browser app; a no-op inside Telegram and in dev.
window.addEventListener('load', () => void registerServiceWorker(), { once: true });

if (import.meta.env.DEV) {
  // Demo data for screenshots and manual testing: open the console and call __skillFlask.seed().
  import('./dev/seed').then(({ installDevTools }) => installDevTools());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DbBoundary>
      <App />
    </DbBoundary>
  </StrictMode>,
);
