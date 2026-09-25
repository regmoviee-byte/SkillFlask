import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import { DONE_EVENT, IDLE, MAX_CYCLES, nextPhase, refillTarget, type AnimationState } from '../../components/flaskAnimation';
import {
  NATURAL_TONES,
  STACK_MIN,
  STACK_TRAVEL,
  bookPhaseTiming,
  bookTheme,
  bookTone,
  bookcase,
  booksBefore,
  caseTop,
  flight,
  landingTransform,
  markPoint,
  newestBook,
  pageLabel,
  stackHeights,
  turnKeyframes,
  type Bookcase,
  type ShelfBook,
} from './book';

const FILLS = [0, 0.25, 0.5, 0.75, 0.999, 1];
const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i;

/** Every phase of a level-up of `levels`, in order. */
function run(levels: number): AnimationState[] {
  const phases: AnimationState[] = [];
  let state = nextPhase(IDLE, { type: 'start', levels });
  while (state.phase !== 'idle') {
    phases.push(state);
    state = nextPhase(state, { type: DONE_EVENT[state.phase] } as Parameters<typeof nextPhase>[1]);
  }
  return phases;
}

describe('book stacks', () => {
  it('moves pages from the unread stack to the read one as the level fills', () => {
    const heights = FILLS.map(stackHeights);
    expect(heights.map((h) => Number(h.read.toFixed(3)))).toEqual([2, 7.5, 13, 18.5, 23.978, 24]);
    expect(heights.map((h) => Number(h.unread.toFixed(3)))).toEqual([24, 18.5, 13, 7.5, 2.022, 2]);
    for (const h of heights) {
      // The book keeps its thickness: pages only move from one side to the other.
      expect(h.read + h.unread).toBeCloseTo(2 * STACK_MIN + STACK_TRAVEL);
      expect(h.read).toBeGreaterThanOrEqual(STACK_MIN);
      expect(h.unread).toBeGreaterThanOrEqual(STACK_MIN);
    }
  });

  it('clamps fills outside 0..1 and non-numbers', () => {
    expect(stackHeights(-1)).toEqual(stackHeights(0));
    expect(stackHeights(2)).toEqual(stackHeights(1));
    expect(stackHeights(Number.NaN)).toEqual(stackHeights(0));
  });
});

describe('page label', () => {
  it('counts pages against the capacity', () => {
    expect(FILLS.map((f) => pageLabel(f, 100))).toEqual([
      'стр. 0 из 100',
      'стр. 25 из 100',
      'стр. 50 из 100',
      'стр. 75 из 100',
      'стр. 100 из 100',
      'стр. 100 из 100',
    ]);
    expect(pageLabel(0.45, 100)).toBe('стр. 45 из 100');
    expect(pageLabel(0.5, 21)).toBe('стр. 11 из 21');
  });

  it('shows a percentage without a capacity', () => {
    expect(FILLS.map((f) => pageLabel(f))).toEqual(['0 %', '25 %', '50 %', '75 %', '99 %', '100 %']);
    expect(pageLabel(0.45, 0)).toBe('45 %');
  });
});

describe('book marks', () => {
  it('climbs the fore-edge monotonically and stays inside the box', () => {
    let previous = Infinity;
    for (let i = 0; i <= 100; i++) {
      const { x, y } = markPoint(i / 100);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(160);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(260);
      expect(y).toBeLessThan(previous);
      previous = y;
    }
    expect(markPoint(-1)).toEqual(markPoint(0));
    expect(markPoint(2)).toEqual(markPoint(1));
  });

  it('is exposed on the theme', () => {
    expect(bookTheme.markPoint).toBe(markPoint);
  });
});

/** The four corners of a book as drawn: its rect turned by its lean around the pivot. */
function corners(b: ShelfBook): { x: number; y: number }[] {
  const a = (b.lean * Math.PI) / 180;
  const turn = (dx: number, dy: number) => ({ x: b.x + dx * Math.cos(a) - dy * Math.sin(a), y: b.y + dx * Math.sin(a) + dy * Math.cos(a) });
  return [turn(0, 0), turn(b.w, 0), turn(b.w, -b.h), turn(0, -b.h)];
}

const allBooks = (layout: Bookcase) => layout.rows.flatMap((row) => row.books);
/** The smallest count with `test` true. */
const firstCount = (test: (layout: Bookcase) => boolean) => {
  for (let n = 0; n < 400; n++) if (test(bookcase(n))) return n;
  return -1;
};

describe('book bookcase', () => {
  it('holds a book for every level before the current one', () => {
    expect([undefined, 1, 2, 3, 6, 14, 30, 70].map((level) => booksBefore(level))).toEqual([0, 0, 1, 2, 5, 13, 29, 69]);
    expect(booksBefore(0)).toBe(0);
    expect(booksBefore(-4)).toBe(0);
    expect(booksBefore(Number.NaN)).toBe(0);
    expect(booksBefore(4.7)).toBe(3);
  });

  it('draws no shelf at all before the first book', () => {
    expect(bookcase(0)).toEqual({ rows: [], tier: -1, shown: 0 });
    expect(bookcase(-3).rows).toEqual([]);
    expect(bookcase(Number.NaN).rows).toEqual([]);
    expect(bookcase(1).rows).toHaveLength(1);
  });

  it('shows every book, oldest first, well past 60 levels', () => {
    for (let n = 1; n <= 150; n++) {
      const layout = bookcase(n);
      expect(layout.shown).toBe(n);
      expect(allBooks(layout).map((b) => b.i)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(newestBook(layout)!.i).toBe(n - 1);
    }
  });

  it('is deterministic', () => {
    for (const n of [1, 5, 13, 29, 69, 120]) expect(bookcase(n)).toEqual(bookcase(n));
  });

  it('fills the near shelf first, then adds shelves upward, then a denser tier', () => {
    const near = bookcase(200).rows[0]!.books.length;
    expect(near).toBeGreaterThanOrEqual(12);
    for (let n = 1; n <= near; n++) expect(bookcase(n).rows).toHaveLength(1);
    // The pinned thresholds: the bookcase above appears with book 16, its second shelf with
    // book 43, the denser tier with book 83.
    expect(near).toBe(15);
    expect(firstCount((l) => l.rows.length === 2)).toBe(16);
    expect(firstCount((l) => l.rows.length === 3)).toBe(43);
    expect(firstCount((l) => l.tier === 1)).toBe(83);
    // Clear spines: the near shelf and the first shelf above hold well over 24.
    expect(bookcase(200).rows.length).toBeGreaterThan(2);
    expect(bookcase(42).rows[1]!.books.length + near).toBeGreaterThanOrEqual(24);
    // Within a tier, shelves are only ever added; further shelves are higher and smaller.
    let previous = bookcase(1);
    for (let n = 2; n <= 150; n++) {
      const layout = bookcase(n);
      expect(layout.tier).toBeGreaterThanOrEqual(previous.tier);
      if (layout.tier === previous.tier) expect(layout.rows.length).toBeGreaterThanOrEqual(previous.rows.length);
      for (let r = 1; r < layout.rows.length; r++) {
        expect(layout.rows[r]!.y).toBeLessThan(layout.rows[r - 1]!.y);
        expect(layout.rows[r]!.s).toBeLessThan(layout.rows[r - 1]!.s);
      }
      previous = layout;
    }
  });

  it('only ever grows the bookcase upward', () => {
    let top = Infinity;
    for (let n = 0; n <= 170; n++) {
      const t = caseTop(bookcase(n));
      if (n < 16) expect(t).toBeNull();
      else {
        expect(t).not.toBeNull();
        expect(t!).toBeLessThanOrEqual(top);
        expect(t!).toBeGreaterThanOrEqual(2.6);
        top = t!;
      }
    }
  });

  it('keeps the books in place as new ones arrive (only the last one straightens up)', () => {
    for (let n = 1; n < 150; n++) {
      const a = bookcase(n);
      const b = bookcase(n + 1);
      if (a.tier !== b.tier) continue;
      const after = allBooks(b);
      for (const book of allBooks(a).slice(0, -1)) expect(after[book.i]).toEqual(book);
    }
  });

  it('stays inside the box, clear of the open book and of the page label', () => {
    for (let n = 1; n <= 160; n++) {
      const layout = bookcase(n);
      layout.rows.forEach((row, r) => {
        for (const book of row.books) {
          for (const { x, y } of corners(book)) {
            expect(x).toBeGreaterThanOrEqual(10);
            expect(x).toBeLessThanOrEqual(150);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(260);
            // The near shelf stands under the label (its text ends at y ≈ 208); the bookcase
            // above ends where the open book's highest page can reach (y 36).
            if (r === 0) expect(y).toBeGreaterThan(211);
            else expect(y).toBeLessThanOrEqual(38.5);
          }
        }
        // Books never overlap on a shelf.
        for (let k = 1; k < row.books.length; k++) {
          const left = row.books[k - 1]!;
          const book = row.books[k]!;
          if (!book.lean) expect(book.x).toBeGreaterThanOrEqual(left.x + left.w);
          else {
            // A leaning book touches its neighbour at most at the neighbour's top corner.
            const a = (-book.lean * Math.PI) / 180;
            const edgeAt = (h: number) => book.x - h * Math.tan(a);
            const reach = Math.min(left.h, book.h * Math.cos(a));
            expect(edgeAt(reach)).toBeGreaterThanOrEqual(left.x + left.w - 1e-6);
          }
        }
      });
    }
  });

  it('varies sizes, leans a few books and puts bookends on the near shelf only', () => {
    const books = allBooks(bookcase(150));
    const widths = new Set(books.map((b) => Math.round(b.w / (b.y === 246 ? 1 : 0.5))));
    expect(widths.size).toBeGreaterThan(3);
    const leaning = Array.from({ length: 60 }, (_, n) => bookcase(n + 1)).filter((l) => allBooks(l).some((b) => b.lean !== 0));
    expect(leaning.length).toBeGreaterThan(10);
    const ends = Array.from({ length: 60 }, (_, n) => bookcase(n + 1)).filter((l) => l.rows[0]!.end !== null);
    expect(ends.length).toBeGreaterThan(3);
    for (let n = 1; n <= 150; n++) {
      const layout = bookcase(n);
      layout.rows.slice(1).forEach((row) => expect(row.end).toBeNull());
      const nearRow = layout.rows[0]!;
      if (nearRow.end !== null) expect(nearRow.end).toBeGreaterThanOrEqual(nearRow.books.at(-1)!.x + nearRow.books.at(-1)!.w);
    }
  });

  it('colours neighbours differently, every third or fourth book in the skill colour', () => {
    const tones = Array.from({ length: 70 }, (_, i) => bookTone(i));
    for (let i = 1; i < tones.length; i++) expect(tones[i]).not.toBe(tones[i - 1]);
    for (const t of tones) expect(t).toBeLessThan(NATURAL_TONES + 2);
    const skill = tones.map((t, i) => (t >= NATURAL_TONES ? i : -1)).filter((i) => i >= 0);
    expect(skill.slice(0, 6)).toEqual([0, 4, 7, 11, 14, 18]);
    expect(new Set(tones.filter((t) => t < NATURAL_TONES)).size).toBe(NATURAL_TONES);
  });

  it('lands the closed book exactly on its slot', () => {
    // CSS transforms apply right to left: translate(-80, -187), scale, rotate, translate(x, y).
    const apply = (t: ReturnType<typeof landingTransform>, px: number, py: number) => {
      const a = (t.r * Math.PI) / 180;
      const dx = (px - 80) * t.sx;
      const dy = (py - 187) * t.sy;
      return { x: t.x + dx * Math.cos(a) - dy * Math.sin(a), y: t.y + dx * Math.sin(a) + dy * Math.cos(a) };
    };
    for (let n = 1; n <= 120; n += 7) {
      const book = newestBook(bookcase(n))!;
      const t = landingTransform(book);
      const [bottomLeft, bottomRight, topRight, topLeft] = corners(book);
      const near = (p: { x: number; y: number }, q: { x: number; y: number }) => {
        expect(p.x).toBeCloseTo(q.x, 6);
        expect(p.y).toBeCloseTo(q.y, 6);
      };
      // The closed book's box is x 80..155, y 50..187.
      near(apply(t, 80, 187), bottomLeft!);
      near(apply(t, 155, 187), bottomRight!);
      near(apply(t, 155, 50), topRight!);
      near(apply(t, 80, 50), topLeft!);
      expect(flight(t)).toMatch(/^translate\(.+px, .+px\) rotate\(.+deg\) scale\(.+, .+\) translate\(-80px, -187px\)$/);
    }
  });
});

describe('book level-up', () => {
  it('plays rise → page turn → close → new book for one level', () => {
    expect(run(1).map((s) => s.phase)).toEqual(['rising', 'overflow', 'draining', 'refilling']);
  });

  it('fits one level into 1.2 s', () => {
    const total = run(1).reduce((sum, s) => sum + bookPhaseTiming(s).delay + bookPhaseTiming(s).duration, 0);
    expect(total).toBeLessThanOrEqual(1200);
  });

  it('compresses many levels into at most three shelved books, each within 1.2 s', () => {
    const phases = run(7);
    expect(phases.filter((s) => s.phase === 'draining')).toHaveLength(MAX_CYCLES);
    expect(phases.filter((s) => s.phase === 'overflow')).toHaveLength(1);
    const total = phases.reduce((sum, s) => sum + bookPhaseTiming(s).delay + bookPhaseTiming(s).duration, 0);
    expect(total).toBeLessThanOrEqual(1200 * MAX_CYCLES);
    // Middle books fill to the last page; only the last one stops at toFill.
    const refills = phases.filter((s) => s.phase === 'refilling').map((s) => refillTarget(s, 0.2));
    expect(refills).toEqual([1, 1, 0.2]);
    // The repeats run faster than the first cycle.
    const first = phases.find((s) => s.phase === 'draining' && s.cycle === 0)!;
    const repeat = phases.find((s) => s.phase === 'draining' && s.cycle > 0)!;
    expect(bookPhaseTiming(repeat).duration).toBeLessThan(bookPhaseTiming(first).duration);
  });

  it('turns a page from the right stack over the spine onto the left one', () => {
    const frames = turnKeyframes(10, 20);
    expect(frames[0]!.transform).toBe('translate(0px, -10px) skewY(0deg) scale(1, 1)');
    expect(frames.at(-1)!.transform).toBe('translate(0px, -20px) skewY(0deg) scale(-1, 1)');
    // Only transform and opacity move.
    for (const frame of frames) {
      expect(Object.keys(frame).filter((k) => k !== 'offset' && k !== 'easing').sort()).toEqual(['opacity', 'transform']);
    }
  });
});

describe('book text', () => {
  const { text } = bookTheme;

  it('names the level', () => {
    expect(text.name).toBe('Книжка');
    expect(text.levelNoun).toBe('Книга');
    expect(text.levelGenitive).toBe('книги');
    expect(text.completed(3)).toBe('Книга 3 прочитана');
    expect(text.fillLabel(45)).toBe('Книга прочитана на 45%');
    expect(text.hint).toBe('Страницы перелистываются до последней');
  });

  it('declines the counts', () => {
    const count = (n: number) => `${n} ${plural(n, text.levelForms)}`;
    expect([1, 2, 5, 11, 21].map(count)).toEqual(['1 книга', '2 книги', '5 книг', '11 книг', '21 книга']);
    const of = (n: number) => `из ${n} ${plural(n, text.levelFormsOf)}`;
    expect([1, 2, 5, 11, 21].map(of)).toEqual(['из 1 книги', 'из 2 книг', 'из 5 книг', 'из 11 книг', 'из 21 книги']);
    expect(`ещё 5 до ${text.levelGenitive} 4`).toBe('ещё 5 до книги 4');
  });

  it('keeps the tone: no forbidden words, no exclamation marks', () => {
    const strings = [
      text.name,
      text.levelNoun,
      text.levelGenitive,
      ...text.levelForms,
      ...text.levelFormsOf,
      text.completed(1),
      text.completed(21),
      text.fillLabel(0),
      text.fillLabel(100),
      text.hint,
      pageLabel(0.5, 100),
      pageLabel(0.5),
    ];
    for (const s of strings) {
      expect(s).not.toMatch(FORBIDDEN);
      expect(s).not.toContain('!');
    }
  });

  it('is available with a hero and a mini', () => {
    expect(bookTheme.key).toBe('book');
    expect(bookTheme.available).toBe(true);
    expect(typeof bookTheme.Hero).toBe('function');
    expect(typeof bookTheme.Mini).toBe('function');
  });
});
