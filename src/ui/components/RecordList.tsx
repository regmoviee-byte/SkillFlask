import { useId } from 'react';
import { Link } from 'react-router';
import { weekStart } from '../../lib/dates';
import { RECORD_KINDS, type RecordKind, type Records } from '../../domain/records';
import { copy } from '../copy';
import { copyForSkill } from '../progress/registry';
import { Icon, type IconName } from './Icon';

// Personal records («Рекорды»): rows of an icon, what the record is, then its value with where
// and when. A row opens what it points at — the week of a date record («Итоги недели»), the skill
// of a skill record. The same rows list the records a week set in «Итоги недели».

const t = copy.records;

export interface InfoRowSpec {
  key: string;
  icon: IconName;
  title: string;
  meta: string;
  value?: string;
  /** Opens this route; a plain row without it. */
  to?: string;
}

const ICONS: Record<RecordKind, IconName> = {
  bestDay: 'sun',
  bestWeek: 'calendar',
  mostCompletions: 'check',
  bestStreak: 'bolt',
  longestSession: 'clock',
  fastestFlask: 'flask',
};

const recapOf = (date: string) => `/recap/${weekStart(date)}`;

/**
 * The row of one record, or null while the journal holds none. `weekLinks: false` leaves the
 * date records without a link (they are already on their week's recap).
 */
export function recordRow(
  kind: RecordKind,
  records: Records,
  skillNames: Record<string, string>,
  /** The skills' stored themes: the fastest level is named in its skill's nouns («Пицца 3»). */
  skillThemes: Record<string, string>,
  weekLinks = true,
): InfoRowSpec | null {
  const name = (skillId: string) => skillNames[skillId] ?? '';
  const row = (meta: string, value: string, to: string | undefined): InfoRowSpec => ({ key: kind, icon: ICONS[kind], title: t[kind], meta, value, to });
  switch (kind) {
    case 'bestDay': {
      const r = records.bestDay;
      return r && row(t.date(r.date), t.points(r.points), weekLinks ? recapOf(r.date) : undefined);
    }
    case 'bestWeek': {
      const r = records.bestWeek;
      return r && row(t.week(r.weekStart), t.points(r.points), weekLinks ? recapOf(r.weekStart) : undefined);
    }
    case 'mostCompletions': {
      const r = records.mostCompletions;
      return r && row(t.date(r.date), t.completions(r.count), weekLinks ? recapOf(r.date) : undefined);
    }
    case 'bestStreak': {
      const r = records.bestStreak;
      return r && row(t.streakDates(r.start, r.days), t.streak(r.days), weekLinks ? recapOf(r.end) : undefined);
    }
    case 'longestSession': {
      const r = records.longestSession;
      return r && row(t.withSkill(name(r.skillId), t.date(r.date)), t.minutes(r.minutes), `/skills/${r.skillId}`);
    }
    case 'fastestFlask': {
      const r = records.fastestFlask;
      return r && row(copyForSkill({ theme: skillThemes[r.skillId] }).record(name(r.skillId), r.flask, r.date), t.flaskDays(r.days), `/skills/${r.skillId}`);
    }
  }
}

/** A card of rows. */
export function InfoList({ rows }: { rows: readonly InfoRowSpec[] }) {
  return (
    <ul className="card list info-list">
      {rows.map((row) => (
        <li key={row.key}>
          <InfoRow row={row} />
        </li>
      ))}
    </ul>
  );
}

function InfoRow({ row }: { row: InfoRowSpec }) {
  const body = (
    <>
      <span className="info-row-icon" aria-hidden="true">
        <Icon name={row.icon} size={20} />
      </span>
      <span className="info-row-text">
        <span className="info-row-title">{row.title}</span>
        {/* The value leads the second line, so a narrow row wraps the details, never the value. */}
        <span className="info-row-meta">
          {row.value && (
            <>
              <span className="info-row-value">{row.value}</span>
              {row.meta && '\u00a0· '}
            </>
          )}
          {row.meta}
        </span>
      </span>
      {row.to && <Icon name="chevron-right" size={18} className="info-row-chevron" />}
    </>
  );
  return row.to ? (
    <Link to={row.to} className="info-row pressable">
      {body}
    </Link>
  ) : (
    <div className="info-row">{body}</div>
  );
}

/** «Рекорды» on the «Ачивки» tab; nothing before the first completion. */
export function RecordsSection({ records, skillNames, skillThemes }: { records: Records; skillNames: Record<string, string>; skillThemes: Record<string, string> }) {
  const titleId = useId();
  const rows = RECORD_KINDS.map((kind) => recordRow(kind, records, skillNames, skillThemes)).filter((row) => row !== null);
  if (rows.length === 0) return null;
  // With one skill its best day is the overall one: the list per skill starts from two.
  const perSkill = records.bestDayBySkill.length >= 2 ? records.bestDayBySkill : [];
  return (
    <section className="records" aria-labelledby={titleId}>
      <h2 className="section-title" id={titleId}>
        {t.title}
      </h2>
      <InfoList rows={rows} />
      {perSkill.length > 0 && (
        <details className="disclosure records-by-skill">
          <summary>
            {t.bySkill(perSkill.length)}
            <Icon name="chevron-down" size={18} className="disclosure-chevron" />
          </summary>
          <InfoList
            rows={perSkill.map((r) => ({
              key: r.skillId,
              icon: 'flask',
              title: skillNames[r.skillId] ?? '',
              meta: t.date(r.date),
              value: t.points(r.points),
              to: `/skills/${r.skillId}`,
            }))}
          />
        </details>
      )}
    </section>
  );
}
