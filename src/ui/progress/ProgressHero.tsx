import type { ProgressHeroProps, ProgressMiniProps, ProgressThemeKey } from './contract';
import { useThemeDefinition } from './registry';

// What screens render: the hero and the mini of a skill's theme, through the contract. The
// skill screen, the celebrations and the flying points talk to the ProgressHeroHandle only, so
// they work the same for every theme. While a theme's chunk loads, a quiet placeholder of the
// same size keeps the layout still (the handle is null meanwhile: a level-up then goes to the
// TopCard, as when the hero is not on screen).

export function ProgressHero({ theme, ...props }: ProgressHeroProps & { theme: ProgressThemeKey }) {
  const def = useThemeDefinition(theme);
  if (!def) return <div className="progress-hero-placeholder" role={props.label ? 'img' : undefined} aria-label={props.label} aria-hidden={props.label ? undefined : true} />;
  const { Hero } = def;
  // A new theme is a new drawing: nothing of the old one's choreography state carries over.
  return <Hero key={theme} {...props} />;
}

export function ProgressMini({ theme, ...props }: ProgressMiniProps & { theme: ProgressThemeKey }) {
  const def = useThemeDefinition(theme);
  const size = props.size ?? 32;
  if (!def) return <span className="progress-mini-placeholder" style={{ width: size, height: size }} aria-hidden="true" />;
  const { Mini } = def;
  return <Mini key={theme} {...props} />;
}
