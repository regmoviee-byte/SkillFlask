import { memo, useCallback, useEffect, useId, useState } from 'react';
import { SKILL_COLORS, type ProgressThemeKey, type SkillColor } from '../../domain/appearance';
import { haptics } from '../../platform/haptics';
import { copy } from '../copy';
import { useMotion } from '../hooks/useMotion';
import { ProgressHero, ProgressMini } from './ProgressHero';
import { availableThemes, colorScope, loadTheme, themeText } from './registry';

// «Оформление»: the progress theme and the colour of a skill, in the skill form and in the ⋯
// sheet of the skill screen. A live preview (the chosen theme's hero at 45 %, in the chosen
// colour) above a 3-column grid of theme cards (each mini fills gently from 0 to 60 % once when
// the picker appears) and nine colour swatches. Both groups are native radio buttons, so the
// arrow keys and screen readers work as for any radio group; every tap target is 44 px or more.

export interface Appearance {
  theme: ProgressThemeKey;
  color: SkillColor | null;
}

interface AppearancePickerProps {
  value: Appearance;
  onChange(next: Appearance): void;
  disabled?: boolean;
}

/** The fill of the cards' minis: from 0 to 60 % once, over 900 ms; at once under reduced motion. */
const CARD_FILL = 0.6;
const CARD_FILL_MS = 900;
/**
 * In a few ease-out steps rather than every frame: each step re-renders every card's SVG, and
 * the weakest Android WebViews (the main target) would stutter at 60 re-renders a second.
 * The themes' own fill transitions smooth the steps.
 */
const CARD_FILL_STEPS = 6;
const PREVIEW_FILL = 0.45;

function useAppearFill(): number {
  const motion = useMotion();
  const [fill, setFill] = useState(motion === 'reduced' ? CARD_FILL : 0);
  useEffect(() => {
    if (motion === 'reduced') {
      setFill(CARD_FILL);
      return;
    }
    const timers = Array.from({ length: CARD_FILL_STEPS }, (_, i) => {
      const t = (i + 1) / CARD_FILL_STEPS;
      // ease-out: fast at first, settling at 60 %.
      return window.setTimeout(() => setFill(CARD_FILL * (1 - (1 - t) ** 3)), (CARD_FILL_MS / CARD_FILL_STEPS) * i);
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // Once when the picker appears, not again when the motion setting changes.
  }, []);
  return fill;
}

/** The live preview; memoised so the cards' fill steps do not redraw the big hero. */
const Preview = memo(function Preview({ theme, label }: { theme: ProgressThemeKey; label: string }) {
  return (
    <div className="appearance-preview">
      <ProgressHero theme={theme} fill={PREVIEW_FILL} capacity={100} level={1} label={label} />
    </div>
  );
});

interface ThemeCardProps {
  themeKey: ProgressThemeKey;
  group: string;
  checked: boolean;
  fill: number;
  onPick(key: ProgressThemeKey): void;
}

/** One card of the «Образ» grid; memoised so a choice redraws only the cards that change. */
const ThemeCard = memo(function ThemeCard({ themeKey, group, checked, fill, onPick }: ThemeCardProps) {
  const text = themeText(themeKey);
  return (
    <label className="theme-card">
      <input
        type="radio"
        className="visually-hidden"
        name={group}
        value={themeKey}
        checked={checked}
        onChange={() => onPick(themeKey)}
        aria-label={copy.appearance.themeLabel(text.name, text.hint)}
      />
      <span className="theme-card-body" aria-hidden="true">
        <ProgressMini theme={themeKey} fill={fill} size={44} level={1} />
        <span className="theme-card-name">{text.name}</span>
      </span>
    </label>
  );
});

export function AppearancePicker({ value, onChange, disabled = false }: AppearancePickerProps) {
  const t = copy.appearance;
  const name = useId();
  const fill = useAppearFill();
  const colorName = value.color ? t.colors[value.color] : t.colorAuto;

  // The cards show every theme's mini: start their chunks together rather than one by one.
  useEffect(() => {
    availableThemes().forEach((key) => void loadTheme(key));
  }, []);

  const pick = (next: Appearance) => {
    if (disabled || (next.theme === value.theme && next.color === value.color)) return;
    haptics.select();
    onChange(next);
  };
  // Stable between the cards' fill steps, so the memoised cards skip them unless their fill moves.
  const pickTheme = useCallback((theme: ProgressThemeKey) => {
    if (disabled || theme === value.theme) return;
    haptics.select();
    onChange({ ...value, theme });
  }, [disabled, value, onChange]);

  return (
    <div className="appearance" {...colorScope(value.color)}>
      <Preview theme={value.theme} label={t.previewLabel(themeText(value.theme).name, colorName)} />

      <fieldset className="appearance-group" disabled={disabled}>
        <legend className="field-label">{t.theme}</legend>
        <div className="theme-grid">
          {availableThemes().map((key) => (
            <ThemeCard key={key} themeKey={key} group={`${name}-theme`} checked={value.theme === key} fill={fill} onPick={pickTheme} />
          ))}
        </div>
      </fieldset>

      <fieldset className="appearance-group" disabled={disabled}>
        <legend className="field-label">{t.color}</legend>
        <div className="swatches">
          {[null, ...SKILL_COLORS].map((color) => (
            <label key={color ?? 'auto'} className="swatch">
              <input
                type="radio"
                className="visually-hidden"
                name={`${name}-color`}
                value={color ?? ''}
                checked={value.color === color}
                onChange={() => pick({ ...value, color })}
                aria-label={color ? t.colors[color] : t.colorAuto}
              />
              {/* The dot carries its own colour scope, so it shows the colour it stands for. */}
              <span className={`swatch-dot${color ? '' : ' swatch-dot--auto'}`} data-liquid-color={color ?? undefined} aria-hidden="true" />
            </label>
          ))}
        </div>
        <p className="hint small appearance-color-name" aria-hidden="true">
          {colorName}
        </p>
      </fieldset>
    </div>
  );
}
