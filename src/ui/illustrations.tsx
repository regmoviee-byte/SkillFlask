// Five small inline illustrations for empty states, drawn with the tokens (currentColor is
// the accent, --color-fg-secondary the secondary stroke). Each stays well under 2 KB.

import type { ReactNode } from 'react';

export type IllustrationName = 'skills' | 'steps' | 'history' | 'achievements' | 'today';

const FLASK = 'M44 22h32M50 22v28L28 94a10 10 0 0 0 9 14h46a10 10 0 0 0 9-14L70 50V22';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const soft = { ...stroke, stroke: 'var(--color-fg-secondary)' } as const;

const art: Record<IllustrationName, ReactNode> = {
  skills: (
    <>
      <path d={FLASK} {...stroke} strokeDasharray="6 6" />
      <circle cx="92" cy="26" r="9" {...soft} />
      <path d="M92 21v10M87 26h10" {...soft} />
      <circle cx="18" cy="48" r="7" {...soft} />
      <path d="M18 44v8M14 48h8" {...soft} />
      <circle cx="100" cy="66" r="6" {...soft} />
      <path d="M100 63v6M97 66h6" {...soft} />
    </>
  ),
  steps: (
    <>
      <path d={FLASK} {...stroke} />
      <path d="M36 82h48" {...soft} />
      <circle cx="88" cy="88" r="16" fill="var(--color-bg-elevated)" stroke="currentColor" strokeWidth="3" />
      <path d="M80 88l6 6 11-12" {...stroke} />
    </>
  ),
  history: (
    <>
      <path d={FLASK} {...stroke} />
      <path d="M36 82h48" {...soft} />
      <circle cx="90" cy="34" r="17" fill="var(--color-bg-elevated)" stroke="currentColor" strokeWidth="3" />
      <path d="M90 25v9l6 4" {...stroke} />
    </>
  ),
  achievements: (
    <>
      <circle cx="30" cy="70" r="18" {...soft} strokeDasharray="5 5" />
      <circle cx="60" cy="48" r="22" {...stroke} strokeDasharray="5 5" />
      <circle cx="92" cy="70" r="18" {...soft} strokeDasharray="5 5" />
      <path d="M52 30 46 12h9l5 9 5-9h9l-6 18" {...stroke} />
    </>
  ),
  today: (
    <>
      <circle cx="60" cy="34" r="13" {...stroke} />
      <path d="M60 10v6M60 52v6M36 34h6M78 34h6M43 17l4 4M73 51l4 4M43 51l4-4M73 17l-4 4" {...stroke} />
      <path d="M28 80h16M52 80h40M28 100h16M52 100h40" {...soft} />
      <path d="M31 80l3 3 5-6" {...stroke} />
    </>
  ),
};

export function Illustration({ name, className = 'illustration' }: { name: IllustrationName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      {art[name]}
    </svg>
  );
}
