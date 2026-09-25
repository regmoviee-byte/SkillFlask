import type { SVGProps } from 'react';

// One stroke icon set, 24px grid, fixed meanings: flask — level/skill, flag — milestone,
// pennant — mark («засечка»), trophy — completed skill, medal — achievement, sun — today,
// sliders — settings, more — a context menu, palette — a skill's appearance («Оформление»).
// The four tab icons have filled variants. No emoji anywhere in the chrome.

const STROKE: Record<string, string> = {
  flask: 'M9.5 3h5M10 3v6.5L5.2 18a2 2 0 0 0 1.8 3h10a2 2 0 0 0 1.8-3L14 9.5V3M7.5 14h9',
  flag: 'M5 21V4M5 4h12l-2.5 4 2.5 4H5',
  pennant: 'M6 21V3M6 4l12 4.5L6 13',
  more: 'M6 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0zM13 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0zM20 12a1 1 0 1 0-2 0 1 1 0 0 0 2 0z',
  trophy: 'M8 4h8v4a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 12v4M8.5 20h7M10 16h4v4h-4z',
  medal: 'M12 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM8.5 12 6 3h4l2 4 2-4h4l-2.5 9',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  sliders: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
  sparkle: 'M12 3l2.2 6.3L20 12l-5.8 2.7L12 21l-2.2-6.3L4 12l5.8-2.7L12 3z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  archive: 'M4 5h16v4H4zM5 9v11h14V9M10 13h4',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8h.01M12 11v6',
  close: 'M6 6l12 12M18 6 6 18',
  laurel: 'M12 20c-4 0-7-3-7-8V8M12 20c4 0 7-3 7-8V8M5 12c-2-1-3-3-3-5 2 0 3 1 4 3M19 12c2-1 3-3 3-5-2 0-3 1-4 3M7 16c-2 0-3-1-4-3 2-1 3 0 4 1M17 16c2 0 3-1 4-3-2-1-3 0-4 1',
  cloud: 'M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9.5 4.3 4.3 0 0 1 17 18H7z',
  download: 'M12 4v11M7 10l5 5 5-5M4 19h16',
  upload: 'M12 15V4M7 9l5-5 5 5M4 19h16',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  palette: 'M12 3a9 9 0 0 0 0 18c1.2 0 1.6-.9 1.2-1.7-.5-1 .2-2.3 1.5-2.3H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10zM7.5 12.5h.01M9 8h.01M14 7.5h.01M17 11h.01',
};

const FILLED: Partial<Record<keyof typeof STROKE, string>> = {
  flask: 'M9.5 2h5a1 1 0 0 1 0 2H15v5.2l4.7 8.3A3 3 0 0 1 17 22H7a3 3 0 0 1-2.7-4.5L9 9.2V4h-.5a1 1 0 0 1 0-2z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  medal: 'M12 22a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.6 10.5 6 3h4l2 4 2-4h4l-2.6 7.5a7 7 0 0 0-6.8 0z',
  sliders: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM9 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
};

export type IconName = keyof typeof STROKE;

export const ICON_NAMES = Object.keys(STROKE) as IconName[];

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Filled variant (tab icons); falls back to the stroke variant. */
  filled?: boolean;
}

export function Icon({ name, size = 24, filled = false, ...rest }: IconProps) {
  const d = (filled && FILLED[name]) || STROKE[name];
  const isFilled = filled && FILLED[name] !== undefined;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" {...rest}>
      <path
        d={d}
        fill={isFilled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={isFilled ? 1.5 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
