// Keyboard handling. Inputs keep font-size 16px (styles.css) so iOS never zooms; a focused
// field scrolls into view once the keyboard has settled, and the keyboard height lands in the
// --kb custom property so sticky footers and sheet footers can lift above it.

const FOCUS_SCROLL_DELAY_MS = 300;

let installed = false;

export function keyboardHeight(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

export function installViewport(): void {
  if (installed) return;
  installed = true;

  let scrollTimer: number | undefined;
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('input')) return;
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      if (document.activeElement === target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, FOCUS_SCROLL_DELAY_MS);
  });

  const update = () => document.documentElement.style.setProperty('--kb', `${keyboardHeight()}px`);
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
}
