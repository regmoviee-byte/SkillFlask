// html.paused while the page is hidden, so idle animations (.anim-decor, motion.css) stop
// burning frames in a background tab or a minimised Mini App. One listener for the whole app:
// every theme's hero calls this from an effect, the first call installs it.

let installed = false;

export function installPauseWhenHidden(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const sync = () => document.documentElement.classList.toggle('paused', document.visibilityState === 'hidden');
  document.addEventListener('visibilitychange', sync);
  sync();
}
