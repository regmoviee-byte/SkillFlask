import { API, tgCall, type PopupButton } from './telegram';

// Confirmations and popups through one promise queue: Telegram shows one popup at a time
// and throws on a second, and the in-app fallback (ConfirmSheet / ContextSheet mounted once
// by DialogHost) has the same constraint. The first call runs synchronously inside the click
// handler so the native dialog keeps its user-gesture context; later calls wait their turn.

export interface ConfirmOptions {
  /** Label of the confirming button; inside Telegram it turns the dialog into a labelled popup. */
  okLabel?: string;
  cancelLabel?: string;
  /** Renders the confirming button in the danger colour (destructive popup button in Telegram). */
  danger?: boolean;
}

export interface PopupOptions {
  /** ≤ 64 characters. */
  title?: string;
  /** ≤ 256 characters. */
  message: string;
  /** ≤ 3 buttons. */
  buttons: (PopupButton & { id: string; text: string })[];
}

export interface DialogHost {
  confirm(message: string, options: ConfirmOptions): Promise<boolean>;
  popup(options: PopupOptions): Promise<string | undefined>;
}

let host: DialogHost | null = null;

/** DialogHost (App.tsx) registers the in-app sheets here; returns the unregister function. */
export function registerDialogHost(next: DialogHost): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

let pending: Promise<void> | null = null;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const start = pending ? pending.then(task, task) : task();
  const done: Promise<void> = start.then(
    () => undefined,
    () => undefined,
  );
  pending = done;
  void done.then(() => {
    if (pending === done) pending = null;
  });
  return start;
}

function fallbackConfirm(message: string): Promise<boolean> {
  // Last resort when no host is mounted (tests, early boot).
  return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(message) : false);
}

export function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return enqueue(() => {
    // showConfirm always says OK / Cancel; with a custom label («Отменить» / «Оставить») the
    // answer only reads right as a labelled popup (same Bot API version).
    const native = tgCall(API.confirm, (tg) =>
      options.okLabel
        ? new Promise<boolean>((resolve) =>
            tg.showPopup(
              {
                message: message.slice(0, 256),
                buttons: [
                  { id: 'cancel', type: 'default', text: options.cancelLabel ?? 'Отмена' },
                  { id: 'ok', type: options.danger ? 'destructive' : 'default', text: options.okLabel },
                ],
              },
              (id) => resolve(id === 'ok'),
            ),
          )
        : new Promise<boolean>((resolve) => tg.showConfirm(message, (ok) => resolve(Boolean(ok)))),
    );
    if (native) return native;
    return host ? host.confirm(message, options) : fallbackConfirm(message);
  });
}

/** Resolves with the pressed button id, or undefined when dismissed. */
export function popup(options: PopupOptions): Promise<string | undefined> {
  const params = {
    title: options.title?.slice(0, 64),
    message: options.message.slice(0, 256),
    buttons: options.buttons.slice(0, 3),
  };
  return enqueue(() => {
    const native = tgCall(API.popup, (tg) => new Promise<string | undefined>((resolve) => tg.showPopup(params, (id) => resolve(id))));
    if (native) return native;
    return host ? host.popup({ ...params, buttons: params.buttons }) : Promise.resolve(undefined);
  });
}

export const dialogs = { confirm, popup };
