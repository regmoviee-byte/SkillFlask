import { useEffect, useState } from 'react';
import { localDate } from '../../lib/dates';

/**
 * The local calendar date, updated at the next local midnight and whenever the app comes
 * back to the foreground (a timer does not run while the WebView sleeps). Live queries that
 * depend on «today» list it in their deps so they re-run when the day changes.
 */
export function useToday(): string {
  const [today, setToday] = useState(localDate);

  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      setToday(localDate());
      window.clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = window.setTimeout(refresh, midnight.getTime() - now.getTime());
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return today;
}
