import type { HistoryEvent, TransactionEvent } from '../../domain/events';
import { formatDayLabel } from '../../lib/dates';
import { formatDelta } from '../../lib/format';
import { copy } from '../copy';

// The skill's history as a timeline: day groups with sticky headers, a thin line with a dot
// per operation, and the moments an operation caused (a flask filled, the milestone) as chips
// on the line right above it. A cancelled completion stays, struck through (principle 3.8).

interface TimelineProps {
  /** Newest first (services/history.ts). */
  events: HistoryEvent[];
  today: string;
  hasMore: boolean;
  onMore(): void;
  /** Opens the completion sheet. */
  onOpen(completionId: string): void;
}

interface DayGroup {
  date: string;
  events: HistoryEvent[];
}

function groupByDay(events: HistoryEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last && last.date === event.date) last.events.push(event);
    else groups.push({ date: event.date, events: [event] });
  }
  return groups;
}

export function Timeline({ events, today, hasMore, onMore, onOpen }: TimelineProps) {
  return (
    <div className="timeline">
      {groupByDay(events).map((group) => (
        <section key={group.date} className="timeline-day">
          <h3 className="timeline-day-head">{formatDayLabel(group.date, today)}</h3>
          <ul className="timeline-list card">
            {group.events.map((event) => (
              <TimelineItem key={event.id} event={event} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
      {hasMore && (
        <button type="button" className="text-button timeline-more" onClick={onMore}>
          {copy.skill.showMore}
        </button>
      )}
    </div>
  );
}

function TimelineItem({ event, onOpen }: { event: HistoryEvent; onOpen(completionId: string): void }) {
  const t = copy.history;
  switch (event.type) {
    case 'COMPLETION':
    case 'CANCELLATION':
    case 'RESTORE':
    case 'CORRECTION':
      return <OperationRow event={event} onOpen={onOpen} />;
    case 'LEVEL_UP':
      return <Separator tone="accent" text={t.flaskFilled(event.flask, event.levels)} />;
    case 'LEVEL_DOWN':
      return <Separator tone="muted" text={t.flaskRollback(event.flask)} />;
    case 'MILESTONE_REACHED':
      return <Separator tone="positive" text={t.milestoneReached(event.name)} />;
    case 'MILESTONE_LOST':
      return <Separator tone="muted" text={t.milestoneAgain(event.name)} />;
    case 'SKILL_COMPLETED':
      return <Separator tone="gold" text={t.skillCompleted} />;
    case 'SKILL_CREATED':
      return <Separator tone="muted" text={t.skillCreated} />;
    case 'SKILL_ARCHIVED':
      return <Separator tone="muted" text={t.skillArchived} />;
    case 'SKILL_RESTORED':
      return <Separator tone="muted" text={t.skillRestored} />;
  }
}

function Separator({ tone, text }: { tone: 'accent' | 'positive' | 'gold' | 'muted'; text: string }) {
  return (
    <li className="timeline-sep">
      <span className={`timeline-chip tone-${tone}`}>{text}</span>
    </li>
  );
}

function OperationRow({ event, onOpen }: { event: TransactionEvent; onOpen(completionId: string): void }) {
  const t = copy.history;
  const { completion, after, delta } = event;
  const cancelled = event.type === 'COMPLETION' && completion?.status === 'CANCELLED';
  const name = !completion
    ? t.correction
    : event.type === 'CANCELLATION'
      ? t.cancellationOf(completion.stepName)
      : event.type === 'RESTORE'
        ? t.restoreOf(completion.stepName)
        : event.type === 'CORRECTION'
          ? t.correctionOf(completion.stepName)
          : completion.stepName;
  const tone = cancelled ? 'muted' : delta < 0 ? 'negative' : 'positive';
  const note = event.type === 'COMPLETION' ? completion?.note : null;

  const content = (
    <>
      <span className={`timeline-dot tone-${tone}`} aria-hidden="true" />
      <span className="timeline-main">
        <span className="timeline-name-line">
          <span className="timeline-name">{name}</span>
          {cancelled && <span className="badge badge-muted">{t.cancelledBadge}</span>}
        </span>
        <span className="timeline-caption">
          {t.flaskState(after.currentFlask, after.pointsInCurrentFlask, after.currentCapacity)}
          {event.minutes && ` · ${t.duration(event.minutes.from, event.minutes.to)}`}
        </span>
        {note && <span className="history-note">{note}</span>}
      </span>
      <span className="timeline-delta">{formatDelta(delta)}</span>
    </>
  );

  const className = `timeline-row${cancelled ? ' is-cancelled' : ''}`;
  if (!completion) return <li className={className}>{content}</li>;
  return (
    <li>
      <button type="button" className={`${className} pressable-row`} onClick={() => onOpen(completion.id)}>
        {content}
      </button>
    </li>
  );
}
