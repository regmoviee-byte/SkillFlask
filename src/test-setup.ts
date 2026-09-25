import 'fake-indexeddb/auto';

// jsdom has no layout: window.scrollTo only logs "Not implemented" (Sheet.tsx restores the
// page scroll after a sheet closes). Silence it so real warnings stay visible.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
  // Not implemented by jsdom either (the «Ачивки» tab scrolls ?focus=id into view).
  Element.prototype.scrollIntoView ??= () => {};
}

// A CI runner is several times slower than a laptop, and some screens hold a row for a beat on
// purpose (a completed «Осталось» row shows its ✓ for BUSY_TAIL_MS before it goes). The default
// 1 s of findBy*/waitFor is too tight there; 5 s still fails fast on a real regression.
if (typeof window !== 'undefined') {
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 5000 });
}
