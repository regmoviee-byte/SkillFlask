import { useId } from 'react';

// Tube with a rounded bottom; the liquid rectangle is clipped to the inner shape.
const TOP = 22;
const BOTTOM = 210;
const TUBE = `M24 ${TOP} V174 A36 36 0 0 0 96 174 V${TOP} Z`;

interface FlaskProps {
  /** Fill ratio 0..1. */
  fill: number;
}

export function Flask({ fill }: FlaskProps) {
  // useId() may contain characters that break url(#id) references.
  const id = `flask${useId().replace(/[^\w-]/g, '')}`;
  const ratio = Math.min(1, Math.max(0, fill));
  const liquidTop = TOP + (1 - ratio) * (BOTTOM - TOP);

  return (
    <svg className="flask" viewBox="0 0 120 220" role="img" aria-label={`Колба заполнена на ${Math.floor(ratio * 100)}%`}>
      <defs>
        <clipPath id={`${id}-clip`}>
          <path d={TUBE} />
        </clipPath>
        <linearGradient id={`${id}-liquid`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--liquid-deep)" />
          <stop offset="0.45" stopColor="var(--liquid)" />
          <stop offset="1" stopColor="var(--liquid-deep)" />
        </linearGradient>
      </defs>
      <path d={TUBE} className="flask-glass" />
      <g clipPath={`url(#${id}-clip)`}>
        <rect className="flask-liquid" x="0" y={liquidTop} width="120" height={BOTTOM - liquidTop + 4} fill={`url(#${id}-liquid)`} />
        {ratio > 0 && ratio < 1 && <rect x="0" y={liquidTop} width="120" height="3" className="flask-surface" />}
        <rect x="34" y={TOP + 8} width="7" height="150" rx="3.5" className="flask-shine" />
      </g>
      {[0.25, 0.5, 0.75].map((mark) => {
        const y = TOP + (1 - mark) * (BOTTOM - TOP);
        return <line key={mark} x1="80" x2="96" y1={y} y2={y} className="flask-mark" />;
      })}
      <path d={TUBE} className="flask-outline" />
      <rect x="14" y="10" width="92" height="14" rx="7" className="flask-rim" />
    </svg>
  );
}
