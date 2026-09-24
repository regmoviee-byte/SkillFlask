import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTelegram } from './telegram';
import { App } from './ui/App';
import { DbBoundary } from './ui/DbBoundary';
import './ui/styles.css';

initTelegram();

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
