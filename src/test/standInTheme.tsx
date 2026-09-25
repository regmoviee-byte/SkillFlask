import { useImperativeHandle, useRef } from 'react';
import type { ProgressHeroProps, ProgressMiniProps, ProgressThemeDefinition, ProgressThemeKey } from '../ui/progress/contract';
import { THEME_TEXT } from '../ui/progress/texts';

/**
 * A theme drawn as plain elements that report their props, for DOM tests of the engine: the
 * screens, the picker and the celebrations talk to it exactly as to a real theme
 * (registry.ts registerTheme), whether or not the real theme file ships in this build.
 */
export function standInTheme(key: ProgressThemeKey): ProgressThemeDefinition {
  function Hero({ fill, state = 'active', level, label, marks, ref }: ProgressHeroProps) {
    const el = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => ({ element: () => el.current, playLevelUp: async ({ onOverflow }) => onOverflow?.() }), []);
    return (
      <div
        ref={el}
        role="img"
        aria-label={label ?? THEME_TEXT[key].fillLabel(Math.floor(fill * 100))}
        data-testid={`${key}-hero`}
        data-fill={fill.toFixed(2)}
        data-state={state}
        data-level={level ?? ''}
        data-marks={(marks ?? []).length}
      />
    );
  }
  function Mini({ fill, state = 'active', level, size = 32 }: ProgressMiniProps) {
    return <span data-testid={`${key}-mini`} data-fill={fill.toFixed(2)} data-state={state} data-level={level ?? ''} style={{ width: size, height: size }} />;
  }
  return { key, text: THEME_TEXT[key], available: true, Hero, Mini, markPoint: (h) => ({ x: 80, y: 250 - Math.min(1, Math.max(0, h)) * 240 }) };
}
