import { useEffect, useRef } from 'react';
import { API, isTelegram, supports, tgCall } from './telegram';

// Native bottom buttons. Inside Telegram ≥ 6.1 the MainButton replaces the screen's HTML
// footer button; the SecondaryButton exists from 7.10, below that the screen keeps its own
// secondary HTML button. Outside Telegram both render as HTML (Screen.tsx). A sheet may take
// the MainButton over while it is open (layer 1) and gives it back to the screen on close.

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

type Kind = 'MainButton' | 'SecondaryButton';

/** Who shows a native button: a screen (layer 0) or a sheet over it (layer 1). */
export type ButtonLayer = 0 | 1;

interface Owner {
  spec: ButtonSpec | SecondaryButtonSpec;
  layer: ButtonLayer;
}

// Telegram has one MainButton and one SecondaryButton for the whole app. Every mounted user
// (a screen, a sheet opened on top of it) registers here; the topmost one — highest layer,
// latest among equals — owns the button, and closing a sheet hands it back to the screen.
const owners: Record<Kind, Owner[]> = { MainButton: [], SecondaryButton: [] };
const clickHandlers: Record<Kind, (() => void) | null> = { MainButton: null, SecondaryButton: null };

function topOwner(kind: Kind): Owner | undefined {
  let top: Owner | undefined;
  for (const owner of owners[kind]) if (!top || owner.layer >= top.layer) top = owner;
  return top;
}

/** Shows the owner's text and state, or hides the button when nobody owns it. */
function render(kind: Kind): void {
  const owner = topOwner(kind);
  tgCall(API.backButton, (tg) => {
    const button = tg[kind];
    if (!owner) {
      button.hide();
      return;
    }
    const { text, disabled = false, loading = false } = owner.spec;
    const position = 'position' in owner.spec ? owner.spec.position : undefined;
    button.setParams({ text: checkLength(text), is_visible: true, is_active: !disabled && !loading, ...(position ? { position } : {}) });
    if (loading) button.showProgress(false);
    else button.hideProgress();
  });
}

function register(kind: Kind, owner: Owner): () => void {
  owners[kind].push(owner);
  if (!clickHandlers[kind]) {
    // One SDK listener per button; it asks the current owner at click time.
    const click = () => {
      const top = topOwner(kind);
      if (top && !top.spec.disabled && !top.spec.loading) top.spec.onClick();
    };
    clickHandlers[kind] = click;
    tgCall(API.backButton, (tg) => tg[kind].onClick(click));
  }
  render(kind);
  return () => {
    owners[kind] = owners[kind].filter((o) => o !== owner);
    if (owners[kind].length > 0) {
      render(kind);
      return;
    }
    const click = clickHandlers[kind];
    clickHandlers[kind] = null;
    tgCall(API.backButton, (tg) => {
      if (click) tg[kind].offClick(click);
      tg[kind].hide();
    });
  };
}

function useNativeButton(kind: Kind, spec: ButtonSpec | SecondaryButtonSpec | undefined, active: boolean, layer: ButtonLayer): void {
  const owner = useRef<Owner | null>(null);
  // The latest spec for the click handler, without re-registering on every render.
  if (owner.current && spec) owner.current.spec = spec;
  const bound = active && spec !== undefined;
  const text = spec?.text;
  const disabled = spec?.disabled ?? false;
  const loading = spec?.loading ?? false;
  const position = spec && 'position' in spec ? spec.position : undefined;

  useEffect(() => {
    if (!bound || !spec) return;
    const o: Owner = { spec, layer };
    owner.current = o;
    const unregister = register(kind, o);
    return () => {
      owner.current = null;
      unregister();
    };
    // `spec` is read once here and kept fresh through the ref above.
  }, [bound, kind, layer]);

  useEffect(() => {
    if (!owner.current || text === undefined) return;
    if (topOwner(kind) === owner.current) render(kind);
  }, [kind, text, disabled, loading, position]);
}

export function useBottomButtons({ main, secondary }: BottomButtons, layer: ButtonLayer = 0): BottomButtonsResult {
  const native = isTelegram() && supports(API.backButton);
  const nativeSecondary = native && supports(API.secondaryButton);
  useNativeButton('MainButton', main, native, layer);
  useNativeButton('SecondaryButton', secondary, nativeSecondary, layer);
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
