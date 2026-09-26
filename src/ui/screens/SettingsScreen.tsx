import { Suspense, useCallback, useEffect, useId, useRef, useState, type ComponentType } from 'react';
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
import { clearErrors, getErrors, onErrorsChange, type LoggedError } from '../../platform/errorLog';
import { haptics, isHapticsEnabled, setHapticsEnabled } from '../../platform/haptics';
import { addToHomeScreen, refreshHomeScreen, useHomeScreenOffer, type InstallPlatform } from '../../platform/homeScreen';
import { applyUpdate, checkForUpdate, useUpdateWaiting } from '../../platform/sw';
import { isTelegram } from '../../platform/telegram';
import { appearancePreference, setAppearancePreference, useAppearancePreference, type AppearancePreference } from '../../platform/theme';
import { ASK_NOTE_KEY, errorMessage } from '../completionFeedback';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { SettingsGroup, SettingsRow } from '../components/Settings';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { motionMode, setMotionPreference, type MotionPreference } from '../hooks/useMotion';
import { useToday } from '../hooks/useToday';
import { lazySafe } from '../lazySafe';
import { ReminderForm } from '../reminder/ReminderForm';
import { reminderCopy } from '../reminder/strings';
import { BackupTextSheet } from '../sheets/BackupTextSheet';
import { ImportSheet } from '../sheets/ImportSheet';

// The install instructions are a lazy chunk (v0.5 package 14 won back the initial load with it):
// it starts loading with this screen, long before «Добавить на главный экран» can be tapped.
// A chunk that failed to load answers the tap with a toast instead of nothing.
function InstallUnavailable({ os, onClose }: InstallSheetProps) {
  const { showToast } = useToast();
  useEffect(() => {
    if (os === null) return;
    showToast(copy.errors.sheetChunk);
    onClose();
  }, [os, onClose, showToast]);
  return null;
}

type InstallSheetProps = { os: InstallPlatform | null; onClose(): void };

const InstallSheet = lazySafe<ComponentType<InstallSheetProps>>(
  () => import('../sheets/InstallSheet').then((m) => ({ default: m.InstallSheet })),
  'InstallSheet',
  InstallUnavailable,
);

// «Настройки» (replaces «Аккаунт»): data and backups, «Выполнение» (ask for a note after every
// completion), «Напоминание» (a recurring event in the phone's calendar, ui/reminder), appearance (the «Тема» choice, motion, haptics), about (the home-screen
// shortcut, version, update), danger zone.

const t = copy.settings;
const ERRORS_SHOWN = 20;
/** How long a shortcut request started here waits for Telegram's homeScreenAdded. */
const SHORTCUT_PENDING_MS = 60_000;
/** A second tap this soon after the first is the same request (Telegram's dialog is opening). */
const SHORTCUT_DOUBLE_TAP_MS = 1500;

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
    const [lastFileAt, lastCloudAt, motion, askNote] = await Promise.all([
      getSetting<string | null>('lastFileBackupAt', null),
      getSetting<string | null>('lastCloudBackupAt', null),
      getSetting<MotionPreference>('motion', 'system'),
      getSetting<boolean>(ASK_NOTE_KEY, false),
    ]);
    return { lastFileAt, lastCloudAt, motion, askNote: askNote === true };
  });
  const cloud = useCloudStatus();
  const cloudReady = cloud.state !== 'unavailable';
  const [busy, setBusy] = useState<Busy>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [hapticsOn, setHapticsOn] = useState(isHapticsEnabled);
  // «Спрашивать заметку»: the switch as tapped until the stored value catches up with it.
  const [askNoteShown, setAskNoteShown] = useState<boolean | null>(null);
  const askNoteStored = stored?.askNote;
  useEffect(() => {
    if (askNoteStored !== undefined) setAskNoteShown((shown) => (shown === askNoteStored ? null : shown));
  }, [askNoteStored]);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [errors, setErrors] = useState<LoggedError[]>(getErrors);
  const [installOs, setInstallOs] = useState<InstallPlatform | null>(null);
  const closeInstall = useCallback(() => setInstallOs(null), []);
  const homeScreen = useHomeScreenOffer();
  const updateWaiting = useUpdateWaiting();
  // What is applied (the boot syncs it from the settings table): pressed at once on a tap.
  const theme = useAppearancePreference();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const reminderTitleId = useId();
  // Set synchronously on the first tap: the busy state lands a render later, too late for a
  // fast double tap, and a confirm the handler waits for counts as busy too.
  const busyRef = useRef(false);

  useEffect(() => {
    if (cloudReady) void refreshCloudMeta();
  }, [cloudReady]);

  useEffect(() => {
    // A shortcut may have been removed, or a new version published, since the last visit.
    refreshHomeScreen();
    checkForUpdate();
  }, []);

  // «Ярлык добавлен» only for an add started here: a status read on opening says nothing.
  // Telegram reports a cancelled dialog with no event at all, so a request started here counts
  // for SHORTCUT_PENDING_MS only; a shortcut added later through Telegram's own menu gets no toast.
  const addingShortcut = useRef(false);
  const shortcutTimer = useRef<number | undefined>(undefined);
  /** The browser's install prompt is open, or the last tap was a moment ago. */
  const shortcutInFlight = useRef(false);
  const shortcutTapAt = useRef(0);
  const endShortcutRequest = useCallback(() => {
    addingShortcut.current = false;
    window.clearTimeout(shortcutTimer.current);
  }, []);
  useEffect(() => endShortcutRequest, [endShortcutRequest]);
  useEffect(() => {
    if (homeScreen.kind !== 'added' || !addingShortcut.current) return;
    endShortcutRequest();
    haptics.success();
    showToast(t.homeScreenAddedToast);
  }, [homeScreen.kind, showToast, endShortcutRequest]);

  // An error logged while Settings is open (a failed cloud save) shows up in «Ошибки (n)».
  useEffect(() => onErrorsChange(() => setErrors(getErrors())), []);

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

  /** Runs a handler unless another one is still going; the handler starts synchronously. */
  async function guarded(handler: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await handler();
    } finally {
      busyRef.current = false;
    }
  }

  async function run(kind: Exclude<Busy, null>, action: () => Promise<void>) {
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

  const saveNow = () =>
    guarded(async () => {
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
    });

  const restoreFromCloud = () =>
    guarded(async () => {
      if (cloud.remote === null) return;
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
    });

  const deleteFromCloud = () =>
    guarded(async () => {
      const ok = await dialogs.confirm(t.confirmCloudDelete, { okLabel: t.cloudDeleteOk, danger: true });
      if (!ok) return;
      await run('delete', async () => {
        await cloudDelete({ disable: true });
        haptics.warning();
        showToast(t.cloudDeleted);
      });
    });

  const exportFile = () =>
    guarded(() =>
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
      }),
    );

  const deleteEverything = () =>
    guarded(async () => {
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
    });

  async function setMotion(reduced: boolean) {
    const next: MotionPreference = reduced ? 'reduced' : 'system';
    setMotionPreference(next);
    await setSetting('motion', next).catch((error: unknown) => showToast(errorMessage(error)));
  }

  async function setAskNote(on: boolean) {
    // Shown at once; the live query takes over once the row is written (or the switch goes back).
    setAskNoteShown(on);
    await setSetting(ASK_NOTE_KEY, on).catch((error: unknown) => {
      setAskNoteShown(null);
      showToast(errorMessage(error));
    });
  }

  async function setAppearance(next: AppearancePreference) {
    if (next === appearancePreference()) return;
    haptics.select();
    // Applied at once (the mirror too); the settings table is written after.
    setAppearancePreference(next, { animate: motionMode() === 'full' });
    await setSetting('appearance', next).catch((error: unknown) => showToast(errorMessage(error)));
  }

  async function addShortcut() {
    if (homeScreen.kind === 'instructions') {
      setInstallOs(homeScreen.os);
      return;
    }
    // A double tap, or a tap while the browser's prompt is open, does not ask twice. A tap after
    // a cancelled Telegram dialog (which reports nothing) asks again.
    const now = Date.now();
    if (shortcutInFlight.current || now - shortcutTapAt.current < SHORTCUT_DOUBLE_TAP_MS) return;
    shortcutTapAt.current = now;
    shortcutInFlight.current = true;
    endShortcutRequest();
    addingShortcut.current = true;
    let outcome: Awaited<ReturnType<typeof addToHomeScreen>>;
    try {
      outcome = await addToHomeScreen();
    } finally {
      shortcutInFlight.current = false;
    }
    if (outcome === 'instructions') {
      endShortcutRequest();
      setInstallOs('other');
    }
    if (outcome === 'dismissed') endShortcutRequest();
    if (outcome === 'requested') shortcutTimer.current = window.setTimeout(endShortcutRequest, SHORTCUT_PENDING_MS);
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

      <SettingsGroup title={t.groupCompletion}>
        <SettingsRow
          label={t.askNote}
          hint={t.askNoteHint}
          toggle={{ checked: askNoteShown ?? stored?.askNote === true, onChange: (on) => void setAskNote(on), disabled: stored === undefined }}
        />
      </SettingsGroup>

      <section className="settings-group" aria-labelledby={reminderTitleId}>
        <h2 className="section-title" id={reminderTitleId}>
          {reminderCopy.section}
        </h2>
        <ReminderForm skill={null} inCard />
      </section>

      <SettingsGroup title={t.groupAppearance}>
        <ThemeRow value={theme} onChange={(next) => void setAppearance(next)} />
        <SettingsRow
          label={t.reduceMotion}
          hint={t.reduceMotionHint}
          toggle={{ checked: stored?.motion === 'reduced', onChange: (on) => void setMotion(on), disabled: stored === undefined }}
        />
        <SettingsRow label={t.haptics} toggle={{ checked: hapticsOn, onChange: setHaptics }} />
      </SettingsGroup>

      <SettingsGroup title={t.groupAbout}>
        {homeScreen.kind === 'added' && <SettingsRow icon="home" label={t.homeScreenAdded} value={<Icon name="check" size={20} className="settings-row-check" />} />}
        {(homeScreen.kind === 'telegram' || homeScreen.kind === 'prompt' || homeScreen.kind === 'instructions') && (
          <SettingsRow
            icon="home"
            label={t.homeScreenAdd}
            hint={homeScreen.kind === 'telegram' ? t.homeScreenHintTelegram : t.homeScreenHintBrowser}
            tone="accent"
            onClick={() => void addShortcut()}
          />
        )}
        <SettingsRow label={t.version(__APP_VERSION__)} />
        <SettingsRow label={t.reload} hint={updateWaiting ? t.updateReady : t.reloadHint} tone="accent" onClick={() => applyUpdate()} />
        <SettingsRow label={overview ? t.activeDays(overview.activeDays14) : copy.common.loading} />
        <SettingsRow label={t.errors(errors.length)} onClick={toggleErrors} chevron={errorsOpen ? 'up' : 'down'} expanded={errorsOpen} />
        {errorsOpen && <ErrorLog errors={errors} onClear={clearErrorLog} />}
      </SettingsGroup>

      <SettingsGroup title={t.groupDanger}>
        <SettingsRow icon="trash" label={t.deleteAll} tone="danger" onClick={deleteEverything} disabled={busy !== null} />
      </SettingsGroup>

      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
      <BackupTextSheet text={exportText} onClose={() => setExportText(null)} />
      <Suspense fallback={null}>
        <InstallSheet os={installOs} onClose={closeInstall} />
      </Suspense>
    </Screen>
  );
}

const THEMES: AppearancePreference[] = ['auto', 'light', 'dark'];

/** «Тема»: a segmented control under the label, the whole width of the card. */
function ThemeRow({ value, onChange }: { value: AppearancePreference; onChange(next: AppearancePreference): void }) {
  const labelId = useId();
  const label = (theme: AppearancePreference) =>
    theme === 'auto' ? t.themeAuto(isTelegram()) : theme === 'light' ? t.themeLight : t.themeDark;
  return (
    <li>
      <div className="settings-row settings-row--stacked">
        <span className="settings-row-label" id={labelId}>
          {t.theme}
        </span>
        <div className="segmented settings-segmented" role="group" aria-labelledby={labelId}>
          {THEMES.map((theme) => (
            <button key={theme} type="button" className={value === theme ? 'active' : undefined} aria-pressed={value === theme} onClick={() => onChange(theme)}>
              {label(theme)}
            </button>
          ))}
        </div>
      </div>
    </li>
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
