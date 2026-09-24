import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTelegram } from './telegram';
import { App } from './ui/App';
import './ui/styles.css';

initTelegram();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
