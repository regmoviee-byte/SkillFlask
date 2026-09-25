import { useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { paceInActions, requiredPace } from '../../domain/forecast';
import { addDays, addMonths, isValidLocalDate } from '../../lib/dates';
import { getSkillForecast, type ForecastView } from '../../services/insights';
import { haptics } from '../../platform/haptics';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { skillTheme, copyForSkill, themeText } from '../progress/registry';
import { ForecastPlaceholder } from './skeleton';
import { insightsCopy, type PaceExample } from './strings';

// «Когда дойду» (lazy chunk, see lazy.tsx): one quiet line under the hero of an active skill —
// «В таком темпе колба 3 заполнится ≈ 12 октября», in the nouns of the skill's theme — when
// the last four weeks give a forecast (domain/forecast.ts); nothing at all otherwise. The line
// opens «Прогноз»: the pace, the level and milestone dates, and «А если к дате?», which turns a
// chosen date into points per week and a couple of the skill's own actions.

const t = insightsCopy.forecast;

/** Steps named as examples of a pace; more than this many a week is no example. */
const MAX_EXAMPLES = 2;
const MAX_TIMES_PER_WEEK = 14;

export default function ForecastLine({ skillId, today }: { skillId: string; today: string }) {
  const forecast = useLiveQuery(() => getSkillForecast(skillId, today), [skillId, today]);
  const [open, setOpen] = useState(false);
  // The screen only renders the line when getSkillDetails found a forecast: its place is kept
  // until this query answers (null only if the journal changed in between).
  if (forecast === undefined) return <ForecastPlaceholder />;
  if (forecast === null) return null;
  const { skill, level } = forecast;
  const text = themeText(skillTheme(skill.theme));

  return (
    <>
      <button
        type="button"
        className="forecast-line pressable-row"
        aria-haspopup="dialog"
        onClick={() => {
          haptics.tap();
          setOpen(true);
        }}
      >
        <Icon name="trend" size={20} className="forecast-line-icon" />
        <span className="forecast-line-text">{t.line(text, forecast.progress.currentFlask, t.when(level.date, level.days))}</span>
        <Icon name="chevron-right" size={18} className="forecast-line-chevron" />
      </button>
      <ForecastSheet open={open} forecast={forecast} today={today} onClose={() => setOpen(false)} />
    </>
  );
}

function ForecastSheet({ open, forecast, today, onClose }: { open: boolean; forecast: ForecastView; today: string; onClose(): void }) {
  const { skill, milestone, progress, pace, level, milestoneDate } = forecast;
  const lc = copyForSkill(skill);
  const reached = !milestone || progress.completedFlasks >= milestone.targetFlaskNumber;

  return (
    <Sheet open={open} onClose={onClose} title={t.title} className="forecast-sheet">
      <p className="forecast-pace">{t.pace(pace.perWeek, pace.days)}</p>
      <ul className="list forecast-dates">
        <li className="info-row">
          <span className="info-row-text">
            <span className="info-row-title">{lc.noun(progress.currentFlask)}</span>
          </span>
          <span className="info-row-value">{t.when(level.date, level.days)}</span>
        </li>
        {milestone && milestoneDate && (
          <li className="info-row">
            <span className="info-row-text">
              <span className="info-row-title">{t.milestone(skill.targetLabel, milestone.name)}</span>
              <span className="info-row-meta">{lc.milestoneProgress(progress.completedFlasks, milestone.targetFlaskNumber)}</span>
            </span>
            <span className="info-row-value">{t.when(milestoneDate.date, milestoneDate.days)}</span>
          </li>
        )}
      </ul>
      {!reached && <ByDate forecast={forecast} today={today} />}
      <p className="t-caption hint forecast-note">{t.note}</p>
    </Sheet>
  );
}

/** «А если к дате?»: three months ahead by default, any day after today. */
function ByDate({ forecast, today }: { forecast: ForecastView; today: string }) {
  const { milestone, progress, config, pace, steps } = forecast;
  const id = useId();
  const [date, setDate] = useState(() => addMonths(today, 3));
  const min = addDays(today, 1);
  const need = milestone && isValidLocalDate(date) && date >= min ? requiredPace(progress.totalPoints, milestone.targetFlaskNumber, config, today, date, pace) : null;
  const examples: PaceExample[] = need
    ? paceInActions(need.perWeek, steps)
        .filter((s) => s.timesPerWeek <= MAX_TIMES_PER_WEEK)
        .slice(0, MAX_EXAMPLES)
        .map((s) => ({ name: s.name, minutes: s.minutes, times: s.timesPerWeek }))
    : [];

  return (
    <section className="forecast-by-date">
      <h3 className="forecast-by-date-title">{t.ifDate}</h3>
      <div className="field">
        <label className="field-label" htmlFor={id}>
          {t.date}
        </label>
        <input id={id} className="input" type="date" min={min} value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <p className="forecast-answer" aria-live="polite">
        {!need ? t.pickDate : need.onPace ? t.onPace : t.required(need.perWeek, examples)}
      </p>
    </section>
  );
}
