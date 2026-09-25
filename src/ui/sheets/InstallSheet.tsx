import { useRef } from 'react';
import type { InstallPlatform } from '../../platform/homeScreen';
import { Icon, type IconName } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { copy } from '../copy';

const t = copy.install;

const STEP_ICONS: Record<InstallPlatform, IconName[]> = {
  ios: ['share', 'plus-square', 'check'],
  'ios-other': ['share', 'plus-square', 'check'],
  other: ['more-vertical', 'plus-square', 'check'],
};

const NOTES: Record<InstallPlatform, string> = { ios: t.noteIos, 'ios-other': t.noteIosOther, other: t.noteOther };

/**
 * «На главный экран» in a browser without an install prompt (Safari, or Chrome before it
 * offers one): three steps with the browser's own button drawn next to each, and what the
 * shortcut means for the data.
 */
export function InstallSheet({ os, onClose }: { os: InstallPlatform | null; onClose(): void }) {
  // The last platform stays drawn while the sheet slides away.
  const last = useRef<InstallPlatform>('other');
  if (os) last.current = os;
  const shown = os ?? last.current;
  const steps = t.steps[shown];
  return (
    <Sheet
      open={os !== null}
      onClose={onClose}
      title={t.title}
      className="install-sheet"
      footer={
        <button type="button" className="button button-primary button-block" onClick={onClose}>
          {t.done}
        </button>
      }
    >
      <HomeScreenArt />
      <ol className="install-steps">
        {steps.map((step, i) => (
          <li key={step} className="install-step">
            <span className="install-step-number" aria-hidden="true">
              {i + 1}
            </span>
            <span className="install-step-text">{step}</span>
            <Icon name={STEP_ICONS[shown][i]!} size={22} className="install-step-icon" />
          </li>
        ))}
      </ol>
      <p className="hint small">{NOTES[shown]}</p>
    </Sheet>
  );
}

/** A phone's home screen with the Skill Flask icon among the others. */
function HomeScreenArt() {
  const others = [
    [34, 26],
    [66, 26],
    [98, 26],
    [34, 58],
    [98, 58],
  ];
  return (
    <svg className="install-art" viewBox="0 0 132 104" aria-hidden="true" focusable="false">
      <rect x="18" y="6" width="96" height="120" rx="16" fill="none" stroke="var(--color-fg-secondary)" strokeWidth="2.5" />
      {others.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x! - 11} y={y! - 11} width="22" height="22" rx="6" fill="var(--color-bg-sunken)" />
      ))}
      <g transform="translate(55 47)">
        <rect width="22" height="22" rx="6" fill="#2481cc" />
        <path d="M8.5 5h5M9.2 5v4.8L5.9 15.4a1.4 1.4 0 0 0 1.2 2.1h7.8a1.4 1.4 0 0 0 1.2-2.1l-3.3-5.6V5" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7.2 13.6h7.6l1.1 1.9a.9.9 0 0 1-.8 1.4H6.9a.9.9 0 0 1-.8-1.4z" fill="#8fd3ff" />
      </g>
      <circle cx="66" cy="58" r="17" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
    </svg>
  );
}
