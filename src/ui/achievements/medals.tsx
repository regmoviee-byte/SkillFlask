import type { MedalGlyph } from '../../domain/achievements/types';

// Glyphs of the achievement medals: one stroke drawing per catalogue icon on the 24 px grid of
// the app's icon set (components/Icon.tsx), drawn white on an earned medal and in the tertiary
// tone on one still ahead. Typed against the domain's MedalGlyph, so a new catalogue icon
// without a drawing fails the typecheck.

export const MEDAL_GLYPHS: Record<MedalGlyph, string> = {
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.7 2.7L16.2 9.6',
  'calendar-check': 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4',
  infinity: 'M7.5 15.5C5.6 15.5 4 13.9 4 12s1.6-3.5 3.5-3.5c3.5 0 5.5 7 9 7 1.9 0 3.5-1.6 3.5-3.5s-1.6-3.5-3.5-3.5c-3.5 0-5.5 7-9 7z',
  chain: 'M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  'flask-stack':
    'M4 4h5M5 4v4.5L2.8 14a1.5 1.5 0 0 0 1.4 2h4.6a1.5 1.5 0 0 0 1.4-2L8 8.5V4M14 7h5M15 7v4.5L12.8 17a1.5 1.5 0 0 0 1.4 2h5.6a1.5 1.5 0 0 0 1.4-2L19 11.5V7',
  flag: 'M6 21V4M6 4h12l-2.5 4 2.5 4H6',
  trophy: 'M8 4h8v4a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 12v4M8.5 20h7M10 16h4v4h-4z',
  seedling: 'M12 21v-9M12 12C12 8 9 6 5 6c0 4 3 6 7 6zM12 14.5c0-4 3-6 7-6 0 4-3 6-7 6z',
  sparkle: 'M12 3l2.2 6.3L20 12l-5.8 2.7L12 21l-2.2-6.3L4 12l5.8-2.7L12 3z',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  list: 'M9.5 6H20M9.5 12H20M9.5 18H20M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  pair: 'M9 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM15 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5z',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5 5-2z',
  layers: 'M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z',
  mountain: 'M3 19l6.5-11 4 6.5 2-3L21 19H3z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
  hourglass: 'M7 3h10M7 21h10M8 3v3.5a4 4 0 0 0 1.6 3.2L12 12l-2.4 2.3A4 4 0 0 0 8 17.5V21M16 3v3.5a4 4 0 0 1-1.6 3.2L12 12l2.4 2.3a4 4 0 0 1 1.6 3.2V21',
  stopwatch: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2.5M10 2h4M12 2v3M18.5 5.5 20 4',
};

export function MedalGlyphIcon({ glyph, size }: { glyph: MedalGlyph; size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={MEDAL_GLYPHS[glyph]} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
