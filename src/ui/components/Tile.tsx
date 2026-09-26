import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { formatNumber } from '../../lib/format';
import { copy } from '../copy';
import { useCountUp } from '../hooks/useCountUp';
import { WeekStrip } from './WeekStrip';

// Bento tiles of «Сегодня» and the home screen: a label, one big number, a caption. A tile
// with `to` is a link (the home tiles open «Сегодня» and «Ачивки»).

interface TileProps {
  label: string;
  to?: string;
  className?: string;
  children: ReactNode;
}

export function Tile({ label, to, className = '', children }: TileProps) {
  const body = (
    <>
      <span className="tile-label t-label">{label}</span>
      {children}
    </>
  );
  const classes = `tile${to ? ' pressable' : ''}${className ? ` ${className}` : ''}`;
  return to ? (
    <Link to={to} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/**
 * Width of a string in the tile's bold display face, in em, a little generous: digits and
 * signs are 0.55–0.7 em in the system faces (widest in DejaVu Sans, the Linux fallback), the
 * group space and the comma about half that.
 */
function widthEm(text: string): number {
  let em = 0;
  for (const ch of text) em += /[\d+−-]/.test(ch) ? 0.72 : 0.36;
  return Math.max(em, 1);
}

/** The big number of a tile with its caption; zero is shown quietly, in the tertiary tone. */
export function TileNumber({ value, caption, prefix = '' }: { value: number; caption: string; prefix?: string }) {
  const shown = useCountUp(value);
  // Whole points count in whole steps; tenths only when the value has them.
  const rounded = Number.isInteger(value) ? Math.round(shown) : Math.round(shown * 10) / 10;
  // Sized for the final value, so the number does not grow while it counts up.
  const style = { '--tile-em': widthEm(`${prefix}${formatNumber(value)}`) } as CSSProperties;
  return (
    <span className="tile-value">
      <span className={`tile-number t-display-l${value === 0 ? ' is-zero' : ''}`} style={style}>
        {value === 0 ? '0' : `${prefix}${formatNumber(rounded)}`}
      </span>
      <span className="tile-caption t-caption">{caption}</span>
    </span>
  );
}

/** «СЕГОДНЯ +35 очков» with the week's dots: tile A of «Сегодня» and the first home tile. */
export function TodayTile({ points, week, rest, today, to }: { points: number; week: boolean[]; rest?: boolean[]; today: string; to?: string }) {
  return (
    <Tile label={copy.today.tileToday} to={to} className="tile--today">
      <TileNumber value={points} prefix="+" caption={copy.today.pointsCaption(points)} />
      <WeekStrip days={week} today={today} rest={rest} />
    </Tile>
  );
}
