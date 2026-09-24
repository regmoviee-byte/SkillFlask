import type { ReactNode } from 'react';

// A progress ring: level on the home cards and the Today groups, achievement ladders and the
// level-up TopCard. The value animates through stroke-dashoffset only.

interface RingProps {
  /** 0..1 */
  value: number;
  size?: number;
  stroke?: number;
  /** 'muted' for an archived skill: the level stays readable without the accent. */
  tone?: 'accent' | 'gold' | 'muted';
  /** Accessible name; the ring is decorative without one. */
  label?: string;
  children?: ReactNode;
}

export function Ring({ value, size = 48, stroke = 4, tone = 'accent', label, children }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <span
      className={`ring ring--${tone}`}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          // A zero-length round cap still draws a dot.
          opacity={v > 0 ? 1 : 0}
        />
      </svg>
      {children !== undefined && <span className="ring-label">{children}</span>}
    </span>
  );
}
