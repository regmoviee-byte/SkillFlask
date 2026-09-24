// Compatibility shim: the Telegram wrapper moved to src/platform/. Kept for one package so
// imports migrate gradually; new code imports from '../platform/...' directly.
export { initTelegram, isTelegram, useTelegramBackButton, webApp, supports, API } from './platform/telegram';
export { haptics } from './platform/haptics';
export { dialogs } from './platform/dialogs';
