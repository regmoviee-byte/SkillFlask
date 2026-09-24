import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatDateTime, formatDateTimeRelative } from '../../lib/dates';
import { getDataOverview } from '../../services/queries';
import { getSetting, setSetting } from '../../services/settings';
import {
  cloudBackupNow,
  cloudDelete,
  cloudRestore,
  deleteAllData,
  getCloudStatus,
  refreshCloudMeta,
  setCloudBackupEnabled,
  useCloudStatus,
  type CloudStatus,
} from '../../services/backupSync';
import { exportToFile, fileBackupReminder } from '../../services/exportFile';
import { CloudConflictError } from '../../platform/cloud';
import { dialogs } from '../../platform/dialogs';
import { clearErrors, getErrors, type LoggedError } from '../../platform/errorLog';
import { haptics, isHapticsEnabled, setHapticsEnabled } from '../../platform/haptics';
import { isTelegram } from '../../platform/telegram';
import { errorMessage } from '../completionFeedback';
import { Screen } from '../components/Screen';
import { SettingsGroup, SettingsRow } from '../components/Settings';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { setMotionPreference, type MotionPreference } from '../hooks/useMotion';
import { useToday } from '../hooks/useToday';
import { BackupTextSheet } from '../sheets/BackupTextSheet';
import { ImportSheet } from '../sheets/ImportSheet';

// «Настройки» (replaces «Аккаунт»): data and backups, appearance, about, danger zone.

const t = copy.settings;
const ERRORS_SHOWN = 20;

const kb = (bytes: number | null) => Math.max(1, Math.round((bytes ?? 0) / 1024));

function cloudStatusText(status: CloudStatus, today: string): string {
  if (status.state === 'unavailable') return isTelegram() ? t.cloudUpdateTelegram : t.cloudOutside;
  if (!status.enabled) return t.cloudOff;
  switch (status.state) {
    case 'saving':
      return status.progress ? t.cloudSaving(status.progress.done, status.progress.total) : t.cloudSavingStart;
    case 'dirty':
      return t.cloudDirty;
    case 'error':
      return t.cloudError(status.message ?? '');
    case 'conflict':
      return t.cloudConflict(status.remote ? formatDateTimeRelative(status.remote.at, today) : null);
    default:
      return status.lastAt ? t.cloudSaved(formatDateTimeRelative(status.lastAt, today), kb(status.bytes)) : t.cloudNoCopy;
  }
}

type Busy = 'save' | 'restore' | 'delete' | 'export' | 'wipe' | null;

export function SettingsScreen() {
  const today = useToday();
  const overview = useLiveQuery(() => getDataOverview(today), [today]);
  const stored = useLiveQuery(async () => {
    const [lastFileAt, lastCloudAt, motion] = await Promise.all([
      getSetting<string | null>('lastFileBackupAt', null),
      getSetting<string | null>('lastCloudBackupAt', null),
      getSetting<MotionPreference>('motion', 'system'),
    ]);
    return { lastFileAt, lastCloudAt, motion };
  });
  const cloud = useCloudStatus();
  const cloudReady = cloud.state !== 'unavailable';
  const [busy, setBusy] = useState<Busy>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [hapticsOn, setHapticsOn] = useState(isHapticsEnabled);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [errors, setErrors] = useState<LoggedError[]>(getErrors);
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (cloudReady) void refreshCloudMeta();
  }, [cloudReady]);

  useEffect(() => {
    let cancelled = false;
    navigator.storage
      ?.persisted?.()
      .then((value) => !cancelled && setPersisted(value))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(kind: Exclude<Busy, null>, action: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    try {
      await action();
    } catch (error) {
      haptics.error();
      showToast(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const confirmOverwrite = (remote: CloudStatus['remote']) =>
    dialogs.confirm(t.confirmCloudOverwrite(remote ? formatDateTime(remote.at) : null), { okLabel: t.cloudOverwriteOk, danger: true });

  async function saveNow() {
    if (busy) return;
    // A copy another device wrote is replaced only after a confirmation; when the conflict is
    // known already, ask right in the click handler.
    let overwrite = false;
    if (cloud.state === 'conflict') {
      if (!(await confirmOverwrite(cloud.remote))) return;
      overwrite = true;
    }
    await run('save', async () => {
      try {
        await cloudBackupNow({ overwrite });
      } catch (error) {
        if (!(error instanceof CloudConflictError)) throw error;
        if (!(await confirmOverwrite(error.remote))) return;
        await cloudBackupNow({ overwrite: true });
      }
      haptics.success();
      showToast(t.cloudSavedToast);
    });
  }

  async function restoreFromCloud() {
    if (busy || cloud.remote === null) return;
    let remote: CloudStatus['remote'] = cloud.remote;
    if (remote === undefined) {
      // Reading the cloud failed (or is still running): try again, then go on if a copy is there.
      remote = await refreshCloudMeta();
      if (remote === null) showToast(t.cloudRemoteNone);
      if (remote === undefined) {
        haptics.error();
        showToast(getCloudStatus().remoteError ?? t.cloudRemoteError);
      }
      if (!remote) return;
    }
    const ok = await dialogs.confirm(t.confirmCloudRestore(formatDateTime(remote.at)), { okLabel: t.replaceOk, danger: true });
    if (!ok) return;
    await run('restore', async () => {
      await cloudRestore(remote);
      haptics.success();
      showToast(t.cloudRestored);
      navigate('/skills');
    });
  }

  async function deleteFromCloud() {
    if (busy) return;
    const ok = await dialogs.confirm(t.confirmCloudDelete, { okLabel: t.cloudDeleteOk, danger: true });
    if (!ok) return;
    await run('delete', async () => {
      await cloudDelete({ disable: true });
      haptics.warning();
      showToast(t.cloudDeleted);
    });
  }

  const exportFile = () =>
    run('export', async () => {
      const outcome = await exportToFile();
      if (outcome.kind === 'cancelled') return;
      if (outcome.kind === 'text') {
        setExportText(outcome.text);
        return;
      }
      haptics.success();
      if (outcome.kind === 'download') showToast(t.fileSaved);
      else if (outcome.kind === 'share') showToast(t.fileShared);
      else showToast(t.fileCopied(outcome.kb), { durationMs: 6000 });
    });

  async function deleteEverything() {
    if (busy) return;
    const ok = await dialogs.confirm(t.confirmDeleteAll, { okLabel: t.deleteAllOk, danger: true });
    if (!ok) return;
    // A kept cloud copy is offered back on the next start (the wipe clears restoreOfferShown).
    // Asked unless the cloud certainly holds nothing: a failed read may hide a copy.
    const alsoCloud =
      cloudReady && cloud.enabled && cloud.remote !== null
        ? await dialogs.confirm(t.confirmDeleteCloud, { okLabel: t.deleteCloudOk, cancelLabel: t.keepCloud, danger: true })
        : false;
    await run('wipe', async () => {
      await deleteAllData({ cloud: alsoCloud });
      haptics.warning();
      showToast(t.deletedAll);
      navigate('/skills');
    });
  }

  async function setMotion(reduced: boolean) {
    const next: MotionPreference = reduced ? 'reduced' : 'system';
    setMotionPreference(next);
    await setSetting('motion', next).catch((error: unknown) => showToast(errorMessage(error)));
  }

  function setHaptics(on: boolean) {
    setHapticsEnabled(on);
    setHapticsOn(on);
  }

  function toggleErrors() {
    setErrors(getErrors());
    setErrorsOpen((open) => !open);
  }

  function clearErrorLog() {
    clearErrors();
    setErrors([]);
    showToast(t.errorsCleared);
  }

  function setCloudEnabled(on: boolean) {
    setCloudBackupEnabled(on).catch((error: unknown) => {
      haptics.error();
      showToast(errorMessage(error));
    });
  }

  // The browser has no cloud copy: remind to download a file once the last copy gets old.
  const reminder = !isTelegram() && overview && stored ? fileBackupReminder(stored.lastFileAt, stored.lastCloudAt, overview.completions, today) : null;
  const remote = cloud.remote;
  // Unprotected storage matters only while no cloud copy is kept (the browser, or the switch off).
  const storageLine = persisted === true ? t.storagePersisted : persisted === false && !(cloudReady && cloud.enabled) ? t.storageNotPersisted : null;
  const remoteText =
    remote === undefined
      ? cloud.remoteError
        ? t.cloudRemoteError
        : t.cloudRemoteLoading
      : remote === null ? t.cloudRemoteNone : t.cloudRemote(formatDateTimeRelative(remote.at, today), remote.skills, remote.completions);

  return (
    <Screen title={t.title} largeTitle>
      <SettingsGroup title={t.groupData} footer={cloudReady ? t.cloudHint : undefined}>
        <SettingsRow icon="cloud" label={t.cloud} hint={cloudStatusText(cloud, today)} />
        {cloudReady && (
          <>
            <SettingsRow label={t.cloudToggle} toggle={{ checked: cloud.enabled, onChange: setCloudEnabled, disabled: busy !== null }} />
            <SettingsRow label={t.cloudSaveNow} tone="accent" onClick={saveNow} disabled={busy !== null} />
            <SettingsRow label={t.cloudRestore} hint={remoteText} tone="accent" onClick={restoreFromCloud} disabled={busy !== null || remote === null || (remote === undefined && !cloud.remoteError)} />
            <SettingsRow label={t.cloudDelete} tone="danger" onClick={deleteFromCloud} disabled={busy !== null || remote === null} />
          </>
        )}
      </SettingsGroup>

      <SettingsGroup footer={t.fileHint}>
        {reminder !== null && (
          <li className="settings-reminder" role="note">
            {reminder === 'never' ? t.reminderNever : t.reminder(reminder)}
          </li>
        )}
        <SettingsRow icon="download" label={t.fileDownload} tone="accent" onClick={exportFile} disabled={busy !== null} />
        <SettingsRow icon="upload" label={t.fileImport} tone="accent" onClick={() => setImportOpen(true)} disabled={busy !== null} />
        <SettingsRow
          label={t.onDevice}
          hint={
            <>
              {overview ? t.counts(overview.skills, overview.steps, overview.completions) : copy.common.loading}
              {storageLine && (
                <>
                  <br />
                  {storageLine}
                </>
              )}
            </>
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t.groupAppearance}>
        <SettingsRow
          label={t.reduceMotion}
          hint={t.reduceMotionHint}
          toggle={{ checked: stored?.motion === 'reduced', onChange: (on) => void setMotion(on), disabled: stored === undefined }}
        />
        <SettingsRow label={t.haptics} toggle={{ checked: hapticsOn, onChange: setHaptics }} />
      </SettingsGroup>

      <SettingsGroup title={t.groupAbout}>
        <SettingsRow label={t.version(__APP_VERSION__)} />
        <SettingsRow label={t.reload} hint={t.reloadHint} tone="accent" onClick={() => window.location.reload()} />
        <SettingsRow label={overview ? t.activeDays(overview.activeDays14) : copy.common.loading} />
        <SettingsRow label={t.errors(errors.length)} onClick={toggleErrors} chevron={errorsOpen ? 'up' : 'down'} expanded={errorsOpen} />
        {errorsOpen && <ErrorLog errors={errors} onClear={clearErrorLog} />}
      </SettingsGroup>

      <SettingsGroup title={t.groupDanger}>
        <SettingsRow icon="trash" label={t.deleteAll} tone="danger" onClick={deleteEverything} disabled={busy !== null} />
      </SettingsGroup>

      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
      <BackupTextSheet text={exportText} onClose={() => setExportText(null)} />
    </Screen>
  );
}

function ErrorLog({ errors, onClear }: { errors: LoggedError[]; onClear(): void }) {
  if (errors.length === 0) {
    return <li className="settings-log-empty hint small">{t.errorsEmpty}</li>;
  }
  return (
    <>
      {errors
        .slice(-ERRORS_SHOWN)
        .reverse()
        .map((entry, i) => (
          <li key={`${entry.at}-${i}`} className="settings-log-entry">
            <span className="hint small">
              {formatDateTime(entry.at)} · {entry.version}
            </span>
            <span className="settings-log-message">{entry.message}</span>
          </li>
        ))}
      <SettingsRow label={t.errorsClear} tone="danger" onClick={onClear} />
    </>
  );
}
