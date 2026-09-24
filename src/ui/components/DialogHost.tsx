import { useEffect, useRef, useState } from 'react';
import { registerDialogHost, type ConfirmOptions, type PopupOptions } from '../../platform/dialogs';
import { ConfirmSheet } from './ConfirmSheet';
import { ContextSheet } from './ContextSheet';

type Pending =
  | { kind: 'confirm'; message: string; options: ConfirmOptions; resolve(ok: boolean): void }
  | { kind: 'popup'; options: PopupOptions; resolve(id: string | undefined): void };

const EXIT_MS = 300;

/** Mounted once in App: renders the in-app fallbacks for dialogs.confirm / dialogs.popup outside Telegram. */
export function DialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);
  const settled = useRef(false);

  useEffect(() => {
    return registerDialogHost({
      confirm: (message, options) =>
        new Promise<boolean>((resolve) => {
          settled.current = false;
          setPending({ kind: 'confirm', message, options, resolve });
          setOpen(true);
        }),
      popup: (options) =>
        new Promise<string | undefined>((resolve) => {
          settled.current = false;
          setPending({ kind: 'popup', options, resolve });
          setOpen(true);
        }),
    });
  }, []);

  // Resolves once (a button answer may be followed by the sheet's own dismissal callback),
  // then keeps the sheet mounted for its exit animation.
  function settle(value: boolean | string | undefined) {
    if (!pending || settled.current) return;
    settled.current = true;
    if (pending.kind === 'confirm') pending.resolve(Boolean(value));
    else pending.resolve(typeof value === 'string' ? value : undefined);
    setOpen(false);
    window.setTimeout(() => setPending((current) => (current === pending ? null : current)), EXIT_MS);
  }

  if (!pending) return null;
  if (pending.kind === 'confirm') {
    const { message, options } = pending;
    return <ConfirmSheet open={open} message={message} okLabel={options.okLabel} cancelLabel={options.cancelLabel} danger={options.danger} onResult={settle} />;
  }
  const { title, message, buttons } = pending.options;
  return (
    <ContextSheet
      open={open}
      onClose={(selected) => {
        if (!selected) settle(undefined);
      }}
      title={title}
      message={message}
      items={buttons.map((button) => ({
        label: button.text,
        tone: button.type === 'destructive' ? 'danger' : undefined,
        onSelect: () => settle(button.id),
      }))}
    />
  );
}
