import { useEffect, useId, useRef, useState } from 'react';
import { completeSkill, continueAfterMilestone } from '../../services/skills';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { formatNumber } from '../../lib/format';
import { errorMessage } from '../completionFeedback';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import type { CelebrationEvent } from './orderCelebrations';

// The milestone moment: a sheet, not a toast and not a native popup — it has room for the
// wreath and for «Решу позже» everywhere. Deciding later keeps the choice on the milestone
// card of the skill screen (FR-MS-005: reaching the milestone never completes the skill).

type MilestoneEvent = Extract<CelebrationEvent, { kind: 'milestone' }>;

/** What the two choices write; the styleguide passes stubs for its demo skill. */
export interface MilestoneActions {
  complete(skillId: string): Promise<void>;
  keepGoing(skillId: string): Promise<void>;
}

const SERVICE_ACTIONS: MilestoneActions = { complete: completeSkill, keepGoing: continueAfterMilestone };

interface MilestoneSheetProps {
  event: MilestoneEvent | null;
  onClose(): void;
  /** The skill was completed from the sheet: the provider plays the skillCompleted moment. */
  onCompleted(skillId: string): void;
  actions?: MilestoneActions;
}

export function MilestoneSheet({ event, onClose, onCompleted, actions = SERVICE_ACTIONS }: MilestoneSheetProps) {
  // Keep the content while the sheet animates out.
  const [shown, setShown] = useState(event);
  if (event !== null && event !== shown) setShown(event);
  const closeRef = useRef<() => void>(() => {});
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const t = copy.celebration;

  useEffect(() => {
    if (event) setBusy(false);
  }, [event]);

  if (!shown) return <Sheet open={false} onClose={onClose} />;
  const { skillId, skillName, milestoneName, flasks, totalPoints, days } = shown;

  async function finish() {
    // Rule: dialogs.confirm runs synchronously in the click handler, before any await.
    const ok = await dialogs.confirm(copy.milestone.confirmFinish(skillName), { okLabel: copy.milestone.finish });
    if (!ok) return;
    setBusy(true);
    try {
      await actions.complete(skillId);
      closeRef.current();
      onCompleted(skillId);
    } catch (error) {
      haptics.error();
      showToast(errorMessage(error));
      setBusy(false);
    }
  }

  async function keepGoing() {
    setBusy(true);
    try {
      await actions.keepGoing(skillId);
      haptics.tap();
      closeRef.current();
      showToast(t.continued);
    } catch (error) {
      haptics.error();
      showToast(errorMessage(error));
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={event !== null}
      onClose={onClose}
      ariaLabel={t.milestoneLabel(milestoneName)}
      closeRef={closeRef}
      className="milestone-sheet"
      footer={
        <>
          <button type="button" className="button button-primary button-block" disabled={busy} onClick={finish}>
            {t.finishSkill}
          </button>
          <button type="button" className="button button-block" disabled={busy} onClick={keepGoing}>
            {t.keepGoing}
          </button>
          <button type="button" className="text-button milestone-later" disabled={busy} onClick={() => closeRef.current()}>
            {t.later}
          </button>
        </>
      }
    >
      <div className="milestone-hero">
        <MilestoneArt />
        <h2 className="t-title-l">{t.milestoneTitle}</h2>
        <p className="milestone-sheet-name t-title-s">{milestoneName}</p>
        <p className="t-caption hint">{skillName}</p>
      </div>
      <ul className="milestone-tiles">
        <li>
          <span className="t-title-m">{formatNumber(flasks)}</span>
          <span className="t-caption hint">{t.tileFlasks(flasks)}</span>
        </li>
        <li>
          <span className="t-title-m">{formatNumber(totalPoints)}</span>
          <span className="t-caption hint">{t.tilePoints(totalPoints)}</span>
        </li>
        <li>
          <span className="t-title-m">{formatNumber(days)}</span>
          <span className="t-caption hint">{t.tileDays(days)}</span>
        </li>
      </ul>
    </Sheet>
  );
}

// Leaves of the wreath: the left branch climbs from the bottom (250°) to the upper left
// (130°) along a circle around the flask, each leaf along the tangent and tilted outwards;
// the right branch mirrors it.
const LEAVES = Array.from({ length: 7 }, (_, i) => {
  const theta = ((250 - i * 20) * Math.PI) / 180;
  const x = 70 + 50 * Math.cos(theta);
  const y = 76 - 50 * Math.sin(theta);
  const tangent = (Math.atan2(-Math.cos(theta), -Math.sin(theta)) * 180) / Math.PI;
  return { x, y, rotate: tangent - 90 - 28 };
});

/** A gold, corked flask in a laurel wreath (140 px, drawn with the tokens). */
export function MilestoneArt() {
  // Ids per copy: two mounted wreaths must not share (and break) each other's gradient.
  const id = `milestone${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg className="milestone-art" viewBox="0 0 140 140" width="140" height="140" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-gold`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--gold-1)" />
          <stop offset="1" stopColor="var(--gold-3)" />
        </linearGradient>
        <clipPath id={`${id}-inner`}>
          <path d="M59 36 V92 A11 11 0 0 0 81 92 V36 Z" />
        </clipPath>
      </defs>
      <circle cx="70" cy="74" r="58" fill="var(--gold-1)" opacity="0.14" />
      {LEAVES.map((leaf, i) => (
        <g key={i}>
          <ellipse cx={leaf.x} cy={leaf.y} rx="4.5" ry="10" fill="var(--gold-2)" transform={`rotate(${leaf.rotate} ${leaf.x} ${leaf.y})`} />
          <ellipse cx={140 - leaf.x} cy={leaf.y} rx="4.5" ry="10" fill="var(--gold-2)" transform={`rotate(${-leaf.rotate} ${140 - leaf.x} ${leaf.y})`} />
        </g>
      ))}
      <path d="M56 34 V92 A14 14 0 0 0 84 92 V34 Z" fill="var(--color-bg-elevated)" />
      <rect x="50" y="52" width="40" height="60" fill={`url(#${id}-gold)`} clipPath={`url(#${id}-inner)`} />
      <path d="M56 34 V92 A14 14 0 0 0 84 92 V34 Z" fill="none" stroke="var(--color-fg)" strokeOpacity="0.45" strokeWidth="2.5" />
      <rect x="62" y="20" width="16" height="11" rx="3" fill="var(--color-fg)" fillOpacity="0.6" />
      <rect x="51" y="28" width="38" height="8" rx="4" fill="var(--color-bg-elevated)" stroke="var(--color-fg)" strokeOpacity="0.45" strokeWidth="2.5" />
    </svg>
  );
}
