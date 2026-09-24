import { useEffect, useRef } from 'react';

// Thin wrapper over the Telegram Mini App API (https://core.telegram.org/bots/webapps).
// Outside Telegram every call is a no-op, so the same build runs in a mobile browser.

interface TelegramWebApp {
  platform: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  disableVerticalSwipes?(): void;
  showConfirm?(message: string, callback: (ok: boolean) => void): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback?: {
    notificationOccurred(type: 'success' | 'warning' | 'error'): void;
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

function webApp(): TelegramWebApp | undefined {
  const tg = window.Telegram?.WebApp;
  // telegram-web-app.js reports platform "unknown" when opened outside Telegram.
  return tg && tg.platform !== 'unknown' ? tg : undefined;
}

export const isTelegram = (): boolean => webApp() !== undefined;

function supports(version: string): boolean {
  return webApp()?.isVersionAtLeast(version) ?? false;
}

export function initTelegram(): void {
  const tg = webApp();
  if (!tg) return;
  document.documentElement.classList.add('in-telegram');
  tg.ready();
  tg.expand();
  if (supports('6.1')) {
    tg.setHeaderColor?.('secondary_bg_color');
    tg.setBackgroundColor?.('secondary_bg_color');
  }
  // Keeps vertical scrolling from collapsing the mini app.
  if (supports('7.7')) tg.disableVerticalSwipes?.();
}

export function haptic(type: 'success' | 'warning' | 'error'): void {
  if (supports('6.1')) webApp()?.HapticFeedback?.notificationOccurred(type);
}

export function confirmDialog(message: string): Promise<boolean> {
  const tg = webApp();
  if (tg?.showConfirm && supports('6.2')) {
    return new Promise((resolve) => tg.showConfirm!(message, resolve));
  }
  return Promise.resolve(window.confirm(message));
}

/** Shows Telegram's native back button while `onBack` is set. */
export function useTelegramBackButton(onBack: (() => void) | undefined): void {
  const handler = useRef(onBack);
  handler.current = onBack;
  const visible = onBack !== undefined;

  useEffect(() => {
    const button = supports('6.1') ? webApp()?.BackButton : undefined;
    if (!button || !visible) return;
    const click = () => handler.current?.();
    button.onClick(click);
    button.show();
    return () => {
      button.offClick(click);
      button.hide();
    };
  }, [visible]);
}
