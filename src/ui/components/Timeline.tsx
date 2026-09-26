import type { ReactNode } from 'react';
import type { HistoryEvent, MarkEvent, TransactionEvent } from '../../domain/events';
import { formatDayLabel } from '../../lib/dates';
import { formatDelta } from '../../lib/format';
import { copy, type LevelCopy } from '../copy';
import { Icon } from './Icon';

// The skill's history as a timeline: day groups with sticky headers, a thin line with a dot
// per operation, and the moments an operation caused (a flask filled, the milestone) as chips
// on the line right above it, named in the skill's theme («Пицца 2 съедена»). A cancelled completion stays, struck through (principle 3.8).
// Marks («засечки») sit at their own date with a pennant on the line and open their sheet.
// Search results (ui/search, package 17) are drawn by the same timeline, with the matched words
// of the names, notes and marks highlighted by `highlight`.

/** Draws a text with its matches marked; plain text without a search. */
export type Highlight = (text: string) => ReactNode;

const plainText: Highlight = (text) => text;

interface TimelineProps {
  /** Newest first (services/history.ts). */
  events: HistoryEvent[];
  /** The skill's level strings (its theme's nouns). */
  levels: LevelCopy;
  today: string;
  hasMore: boolean;
  onMore(): void;
  /** Opens the completion sheet. */
  onOpen(completionId: string): void;
  /** Opens the mark sheet. */
  onOpenMark(markId: string): void;
  /** Search results: marks the matched words (ui/search). */
  highlight?: Highlight;
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

export function Timeline({ events, levels, today, hasMore, onMore, onOpen, onOpenMark, highlight = plainText }: TimelineProps) {
  return (
    <div className="timeline">
      {groupByDay(events).map((group) => (
        <section key={group.date} className="timeline-day">
          <h3 className="timeline-day-head">{formatDayLabel(group.date, today)}</h3>
          <ul className="timeline-list card">
            {group.events.map((event) => (
              <TimelineItem key={event.id} event={event} levels={levels} onOpen={onOpen} onOpenMark={onOpenMark} highlight={highlight} />
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

interface ItemProps {
  event: HistoryEvent;
  levels: LevelCopy;
  onOpen(completionId: string): void;
  onOpenMark(markId: string): void;
  highlight: Highlight;
}

function TimelineItem({ event, levels, onOpen, onOpenMark, highlight }: ItemProps) {
  const t = copy.history;
  switch (event.type) {
    case 'COMPLETION':
    case 'CANCELLATION':
    case 'RESTORE':
    case 'CORRECTION':
      return <OperationRow event={event} levels={levels} onOpen={onOpen} highlight={highlight} />;
    case 'LEVEL_UP':
      return <Separator tone="accent" text={levels.completed(event.flask, event.levels)} />;
    case 'LEVEL_DOWN':
      return <Separator tone="muted" text={levels.rollback(event.flask)} />;
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
    case 'MARK':
      return <MarkRow event={event} levels={levels} onOpen={onOpenMark} highlight={highlight} />;
  }
}

/** A mark: pennant on the line, its title, where it sits and the description on one line. */
function MarkRow({ event: { mark }, levels, onOpen, highlight }: { event: MarkEvent; levels: LevelCopy; onOpen(markId: string): void; highlight: Highlight }) {
  return (
    <li>
      <button type="button" className="timeline-row timeline-mark pressable-row" onClick={() => onOpen(mark.id)}>
        <span className="timeline-mark-icon" aria-hidden="true">
          <Icon name="pennant" size={16} />
        </span>
        <span className="timeline-main">
          <span className="timeline-name-line">
            <span className="visually-hidden">{copy.marks.mark}: </span>
            <span className="timeline-name">{highlight(mark.title)}</span>
          </span>
          <span className="timeline-caption">{levels.markHistory(mark.flaskNumber, mark.pointsInFlask)}</span>
          {mark.description && <span className="history-note">{highlight(mark.description)}</span>}
        </span>
      </button>
    </li>
  );
}

function Separator({ tone, text }: { tone: 'accent' | 'positive' | 'gold' | 'muted'; text: string }) {
  return (
    <li className="timeline-sep">
      <span className={`timeline-chip tone-${tone}`}>{text}</span>
    </li>
  );
}

function OperationRow({ event, levels, onOpen, highlight }: { event: TransactionEvent; levels: LevelCopy; onOpen(completionId: string): void; highlight: Highlight }) {
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
          <span className="timeline-name">{highlight(name)}</span>
          {cancelled && <span className="badge badge-muted">{t.cancelledBadge}</span>}
        </span>
        <span className="timeline-caption">
          {levels.state(after.currentFlask, after.pointsInCurrentFlask, after.currentCapacity)}
          {event.minutes && ` · ${t.duration(event.minutes.from, event.minutes.to)}`}
          {event.type === 'CORRECTION' && !event.minutes && delta === 0 && ` · ${t.minutesChanged}`}
          {/* A TIMED completion shows its minutes as they are now (corrections included). */}
          {event.type === 'COMPLETION' && completion?.durationMinutes != null && ` · ${t.minutes(completion.durationMinutes)}`}
        </span>
        {note && <span className="history-note">{highlight(note)}</span>}
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
