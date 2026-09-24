import { useState } from 'react';
import type { CloudMeta } from '../../platform/cloud';
import { useBottomButtons } from '../../platform/buttons';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { cloudRestore, dismissRestoreOffer } from '../../services/backupSync';
import { logError } from '../../platform/errorLog';
import { errorMessage } from '../completionFeedback';
import { Icon } from '../components/Icon';
import { copy } from '../copy';

const t = copy.restoreOffer;

/**
 * Shown by DbBoundary before the app, on an empty database inside Telegram when the cloud
 * holds a copy (Telegram's «Очистить кэш», a reinstall, a new phone). Never restores by
 * itself; either answer is remembered and the offer does not come back.
 * Rendered outside the router, so it uses the bottom buttons directly instead of Screen.
 */
export function RestoreOfferScreen({ meta, onDone }: { meta: CloudMeta; onDone(): void }) {
  const [busy, setBusy] = useState<'restore' | 'fresh' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (busy) return;
    setBusy('restore');
    setError(null);
    try {
      await cloudRestore(meta);
      haptics.success();
      onDone();
    } catch (e) {
      haptics.error();
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  async function fresh() {
    if (busy) return;
    // A mistaken tap here lets the first new write replace the copy: ask when it holds history.
    if (meta.completions > 0) {
      const ok = await dialogs.confirm(t.freshConfirm, { okLabel: t.freshOk, cancelLabel: t.freshCancel, danger: true });
      if (!ok) return;
    }
    setBusy('fresh');
    try {
      await dismissRestoreOffer(meta);
    } catch (e) {
      // At worst the offer comes back on the next start.
      logError(e, 'restore offer');
    }
    onDone();
  }

  const { native, nativeSecondary } = useBottomButtons({
    main: { text: t.restore, onClick: () => void restore(), loading: busy === 'restore', disabled: busy === 'fresh' },
    secondary: { text: t.fresh, onClick: () => void fresh(), disabled: busy !== null, position: 'bottom' },
  });

  return (
    <div className="restore-offer">
      <main className="restore-offer-body">
        <span className="restore-offer-icon">
          <Icon name="cloud" size={40} />
        </span>
        <h1 className="t-title-l">{t.title}</h1>
        <p className="restore-offer-text">{t.text(meta.at, meta.skills, meta.completions)}</p>
        <div aria-live="polite">
          {busy === 'restore' && <p className="hint small">{t.restoring}</p>}
          {error && <p className="error">{error}</p>}
        </div>
      </main>
      {(!native || !nativeSecondary) && (
        <div className="restore-offer-footer">
          {!native && (
            <button type="button" className="button button-primary button-block" disabled={busy !== null} onClick={() => void restore()}>
              {t.restore}
            </button>
          )}
          {!nativeSecondary && (
            <button type="button" className="button button-secondary button-block" disabled={busy !== null} onClick={() => void fresh()}>
              {t.fresh}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
