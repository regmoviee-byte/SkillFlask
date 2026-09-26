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

/** How long a primed keyboard waits for the field that should take it over, by default. */
const PRIMER_MS = 1000;

/**
 * Call in a tap that opens something to type into once it has rendered (a sheet that waits for
 * its data, a screen after a navigation). iOS WebKit raises the keyboard only for a focus()
 * made inside a user gesture, and the field does not exist yet during the tap: an invisible
 * input takes the focus now, and the field that focuses itself a moment later takes the
 * keyboard over from it. The stand-in removes itself once it loses the focus, or after `waitMs`
 * (then the keyboard goes down again). Elsewhere it only does the same a little earlier.
 */
export function primeKeyboard(waitMs: number = PRIMER_MS): void {
  if (typeof document === 'undefined') return;
  const primer = document.createElement('input');
  primer.setAttribute('aria-hidden', 'true');
  primer.tabIndex = -1;
  // 16px: iOS zooms into a smaller field. Off-screen by opacity, not display: a hidden input takes no focus.
  primer.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;pointer-events:none;';
  const remove = () => {
    window.clearTimeout(timer);
    primer.remove();
  };
  const timer = window.setTimeout(() => {
    if (document.activeElement === primer) primer.blur();
    remove();
  }, waitMs);
  primer.addEventListener('blur', remove, { once: true });
  document.body.appendChild(primer);
  primer.focus({ preventScroll: true });
}
