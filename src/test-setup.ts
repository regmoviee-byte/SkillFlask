import 'fake-indexeddb/auto';

// jsdom has no layout: window.scrollTo only logs "Not implemented" (Sheet.tsx restores the
// page scroll after a sheet closes). Silence it so real warnings stay visible.
if (typeof window !== 'undefined') window.scrollTo = () => {};
