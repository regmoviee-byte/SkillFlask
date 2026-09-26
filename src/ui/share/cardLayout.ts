// The share card's texts and their layout (v0.5 package 19), pure: what the picture says
// (cardModel) and how a text breaks into the lines of a column (wrapLines, fitLines). The
// canvas drawing (renderCard.ts) only places what these return, measured with the canvas's
// own measureText, so the rules are tested here without a canvas.

import type { ProgressState, ProgressThemeKey } from '../progress/contract';
import type { SkillColor } from '../../domain/appearance';
import { formatNumber } from '../../lib/format';
import { fromDeci, toDeci } from '../../domain/points';
import { copy } from '../copy';
import { copyForSkill, skillTheme } from '../progress/registry';
import type { ShareCardData } from '../../services/shareCard';
import { shareCopy } from './strings';

/** The width of a text in the current font, in canvas pixels. */
export type Measure = (text: string) => number;

const ELLIPSIS = '…';

/** Breaks a word wider than the line between its characters. */
function breakWord(word: string, maxWidth: number, measure: Measure): string[] {
  const parts: string[] = [];
  let part = '';
  for (const char of word) {
    if (part && measure(part + char) > maxWidth) {
      parts.push(part);
      part = char;
    } else part += char;
  }
  if (part) parts.push(part);
  return parts;
}

/** Cuts a line until it fits with «…» at its end. */
export function ellipsize(line: string, maxWidth: number, measure: Measure): string {
  let text = line.trimEnd();
  while (text && measure(text + ELLIPSIS) > maxWidth) text = text.slice(0, -1).trimEnd();
  return text + ELLIPSIS;
}

/**
 * The text in at most `maxLines` lines no wider than `maxWidth`: greedy, breaking at spaces
 * (a no-break space keeps «17 сентября» together) and inside a word only when the word alone
 * is wider than a line. When the text needs more lines, the last one ends with «…».
 */
export function wrapLines(text: string, maxWidth: number, measure: Measure, maxLines = Infinity): string[] {
  const words = text.trim().split(/[ \t\n\r]+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (measure(word) <= maxWidth) {
      line = word;
      continue;
    }
    const parts = breakWord(word, maxWidth, measure);
    lines.push(...parts.slice(0, -1));
    line = parts.at(-1) ?? '';
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(kept[maxLines - 1]!, maxWidth, measure);
  return kept;
}

/**
 * The largest of `sizes` (largest first) at which the text fits `maxLines` without «…»; the
 * smallest size, cut with «…», when none does. `measureAt(size)` measures in that font size.
 */
export function fitLines(
  text: string,
  maxWidth: number,
  maxLines: number,
  sizes: readonly number[],
  measureAt: (size: number) => Measure,
): { size: number; lines: string[] } {
  for (const size of sizes) {
    const lines = wrapLines(text, maxWidth, measureAt(size));
    if (lines.length <= maxLines) return { size, lines };
  }
  const size = sizes.at(-1)!;
  return { size, lines: wrapLines(text, maxWidth, measureAt(size), maxLines) };
}

export interface CardTile {
  /** The number, formatted: «12», «1 240». */
  value: string;
  /** Its words under it: «дней подряд», «лучшая серия». */
  caption: string;
  note: string;
}

export interface CardModel {
  theme: ProgressThemeKey;
  color: SkillColor | null;
  /** What the theme's hero draws. */
  hero: { fill: number; level: number; state: ProgressState; capacity: number | undefined };
  name: string;
  /** Under the name: the pause pill's words, or «B1 → B2»; null without either. */
  status: string | null;
  /** Over the number: the level noun («Колба»), or «Навык достигнут». */
  eyebrow: string;
  /** The big number: the current level, or the levels of a completed skill. */
  level: string;
  /** «45» and « / 150» (the points in the current level); null for a completed skill. */
  points: { value: string; capacity: string } | null;
  /** «30% · ещё 105 до колбы 4», or the levels of a completed skill in words. */
  detail: string;
  total: string;
  milestone: { text: string; share: number } | null;
  tiles: CardTile[];
  brand: string;
  /** The app's link as printed: «t.me/SkillFlaskBot/app». */
  link: string;
  /** The one line that goes with the picture or the link. */
  message: string;
}

/** The link as the card prints it: no scheme, no trailing slash. */
export function printedLink(link: string): string {
  return link.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/** Everything the card says about the skill, formatted in its theme's nouns. */
export function cardModel(data: ShareCardData, appLink: string): CardModel {
  const { skill, milestone, progress: p } = data;
  const lc = copyForSkill(skill);
  const t = shareCopy.card;
  const completed = skill.status === 'COMPLETED';
  const percent = Math.floor(p.fill * 100);
  const left = fromDeci(toDeci(p.currentCapacity) - toDeci(p.pointsInCurrentFlask));
  const labels = [skill.startLabel, skill.targetLabel].filter(Boolean).join(' → ');

  const tiles: CardTile[] = [];
  if (data.bestStreak) tiles.push({ value: formatNumber(data.bestStreak.days), caption: t.streak(data.bestStreak.days, data.bestStreak.bridged), note: t.streakNote });
  // The past as what happened: days of the last month, or of all time when the month had none.
  if (data.activeDays30 > 0) tiles.push({ value: formatNumber(data.activeDays30), caption: t.activeDays(data.activeDays30), note: t.last30 });
  else if (data.activeDaysTotal > 0) tiles.push({ value: formatNumber(data.activeDaysTotal), caption: t.activeDays(data.activeDaysTotal), note: t.allTime });

  let milestoneLine: CardModel['milestone'] = null;
  if (milestone && !completed) {
    const target = milestone.targetFlaskNumber;
    const done = Math.min(p.completedFlasks, target);
    milestoneLine =
      done >= target
        ? { text: t.milestoneReached(skill.targetLabel, milestone.name), share: 1 }
        : { text: t.milestone(lc.milestoneProgress(done, target), skill.targetLabel, milestone.name), share: target > 0 ? done / target : 0 };
  }

  return {
    theme: skillTheme(skill.theme),
    color: skill.color ?? null,
    hero: {
      fill: p.fill,
      level: p.currentFlask,
      state: completed ? 'complete' : p.totalPoints === 0 ? 'empty' : 'active',
      capacity: completed ? undefined : p.currentCapacity,
    },
    name: skill.name,
    status: data.pause ? copy.pause.pill(data.pause.until) : labels || null,
    eyebrow: completed ? t.reached : lc.name,
    level: formatNumber(completed ? p.completedFlasks : p.currentFlask),
    points: completed ? null : { value: formatNumber(p.pointsInCurrentFlask), capacity: t.capacity(p.currentCapacity) },
    detail: completed ? t.reachedDetail(lc.levels(p.completedFlasks), skill.completedAt ?? skill.updatedAt) : lc.toNext(percent, left, p.currentFlask + 1),
    total: t.total(p.totalPoints),
    milestone: milestoneLine,
    tiles,
    brand: t.brand,
    link: printedLink(appLink),
    message: shareCopy.message(lc, skill.name, completed, p.completedFlasks, p.totalPoints),
  };
}
