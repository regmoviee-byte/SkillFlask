import { useEffect, useRef, useState } from 'react';
import { Ring } from '../components/Ring';
import { copy } from '../copy';

// A flask filled where its flask is not on screen (Today, «Задним числом», a scrolled skill
// screen): an opaque card slides in under the safe area, the ring fills, and it leaves by
// itself after 3.5 s. Tap or swipe up dismisses. Not a modal: the screen stays usable.

export interface TopCardContent {
  /** Fill of the flask before the write; the ring animates from here to full. */
  fromFill: number;
  /** The flask that filled. */
  flask: number;
  skillName: string;
}

const SHOW_MS = 3500;
const EXIT_MS = 240;

export function TopCard({ content, onDone }: { content: TopCardContent; onDone(): void }) {
  const [state, setState] = useState<'enter' | 'shown' | 'leaving'>('enter');
  const [ring, setRing] = useState(content.fromFill);
  const startY = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setState('shown');
      setRing(1);
    });
    const timer = window.setTimeout(() => setState('leaving'), SHOW_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (state !== 'leaving') return;
    const timer = window.setTimeout(() => onDoneRef.current(), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const dismiss = () => setState('leaving');

  return (
    <div
      className="top-card anim-func"
      data-state={state}
      role="status"
      onClick={dismiss}
      onTouchStart={(event) => {
        startY.current = event.touches[0]?.clientY ?? null;
      }}
      onTouchMove={(event) => {
        const y = event.touches[0]?.clientY;
        if (startY.current !== null && y !== undefined && startY.current - y > 16) {
          startY.current = null;
          dismiss();
        }
      }}
    >
      <Ring value={ring} size={48} stroke={4}>
        {content.flask}
      </Ring>
      <span className="top-card-text">
        <span className="t-body-strong">{copy.celebration.topTitle}</span>
        <span className="top-card-caption">{copy.celebration.topText(content.skillName, content.flask + 1)}</span>
      </span>
    </div>
  );
}
