import { useEffect, useRef } from 'react';
import { API, isTelegram, supports, tgCall } from './telegram';

// Native bottom buttons. Inside Telegram ≥ 6.1 the MainButton replaces the screen's HTML
// footer button; the SecondaryButton exists from 7.10, below that the screen keeps its own
// secondary HTML button. Outside Telegram both render as HTML (Screen.tsx).

export interface ButtonSpec {
  /** ≤ 24 characters so it fits the native button on narrow phones. */
  text: string;
  onClick(): void;
  disabled?: boolean;
  loading?: boolean;
}

export interface SecondaryButtonSpec extends ButtonSpec {
  position?: 'left' | 'right' | 'top' | 'bottom';
}

export interface BottomButtons {
  main?: ButtonSpec;
  secondary?: SecondaryButtonSpec;
}

export interface BottomButtonsResult {
  /** True when the main button is rendered natively (no HTML footer button needed). */
  native: boolean;
  /** True when the secondary button is native too. */
  nativeSecondary: boolean;
}

export const MAX_BUTTON_TEXT = 24;

function checkLength(text: string): string {
  if (import.meta.env.DEV && text.length > MAX_BUTTON_TEXT) console.warn(`Bottom button text longer than ${MAX_BUTTON_TEXT} chars: «${text}»`);
  return text;
}

function useNativeButton(kind: 'MainButton' | 'SecondaryButton', spec: ButtonSpec | SecondaryButtonSpec | undefined, active: boolean): void {
  const ref = useRef(spec);
  ref.current = spec;
  const bound = active && spec !== undefined;
  const text = spec?.text;
  const disabled = spec?.disabled ?? false;
  const loading = spec?.loading ?? false;
  const position = spec && 'position' in spec ? spec.position : undefined;

  // The click handler is bound once through a ref; the SDK keeps its own listener list.
  useEffect(() => {
    if (!bound) return;
    const click = () => {
      const current = ref.current;
      if (current && !current.disabled && !current.loading) current.onClick();
    };
    tgCall(API.backButton, (tg) => tg[kind].onClick(click));
    return () => {
      tgCall(API.backButton, (tg) => {
        tg[kind].offClick(click);
        tg[kind].hide();
      });
    };
  }, [bound, kind]);

  useEffect(() => {
    if (!bound || text === undefined) return;
    tgCall(API.backButton, (tg) => {
      const button = tg[kind];
      button.setParams({ text: checkLength(text), is_visible: true, is_active: !disabled && !loading, ...(position ? { position } : {}) });
      if (loading) button.showProgress(false);
      else button.hideProgress();
    });
  }, [bound, kind, text, disabled, loading, position]);
}

export function useBottomButtons({ main, secondary }: BottomButtons): BottomButtonsResult {
  const native = isTelegram() && supports(API.backButton);
  const nativeSecondary = native && supports(API.secondaryButton);
  useNativeButton('MainButton', main, native);
  useNativeButton('SecondaryButton', secondary, nativeSecondary);
  return { native, nativeSecondary };
}

/** Asks before the mini app (or tab) closes while a form has unsaved changes. */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    if (isTelegram()) {
      if (!supports(API.closingConfirmation)) return;
      tgCall(API.closingConfirmation, (tg) => tg.enableClosingConfirmation());
      return () => {
        tgCall(API.closingConfirmation, (tg) => tg.disableClosingConfirmation());
      };
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
