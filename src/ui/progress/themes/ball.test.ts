import { describe, expect, it } from 'vitest';
import { plural } from '../../../lib/format';
import { MAX_CYCLES } from '../../components/flaskAnimation';
import {
  APEX_SHARE,
  BALL_IDLE,
  BEAT_FLOOR,
  BEAT_HAND,
  BEAT_HEM,
  BEAT_RIM,
  CHEER,
  HERO_CURVE,
  PILE_SLOTS,
  RELEASE,
  arcPoint,
  ballPhaseTiming,
  ballPose,
  ballRefillTarget,
  ballStage,
  ballTheme,
  captionPad,
  captionSpots,
  cheerFrames,
  dropFrames,
  flagY,
  flightFrames,
  joinPath,
  markPoint,
  miniPoint,
  nextBallPhase,
  pennantTop,
  pileBall,
  pileCount,
  pileLayout,
  playerPoints,
  playerPose,
  poleFoot,
  poseKeyframes,
  poseTransforms,
  shortLabel,
  type BallAnimState,
  type Point,
} from './ball';

const SAMPLES = [0, 0.25, 0.5, 0.75, 0.999, 1];
const MARK_SETS = [
  [0.8, 0.95, 0.9, 0.85],
  [0, 0.02, 0.04, 0.06],
  [0.2, 0.45, 0.8],
  [0.1, 0.3, 0.5, 0.7],
  [0.9, 0.95, 0.99],
  [0.5, 0.9, 1],
  [0.7, 0.76, 0.8, 0.84],
  [0.1, 0.35, 0.6, 0.85],
  [0.3, 0.6],
];
const FORBIDDEN = /просроч|пропущ|штраф|долг|провал|сгорел|потерян|баллы/i;

describe('ball geometry', () => {
  it('starts in the hands and ends above the rim', () => {
    expect(arcPoint(0)).toEqual(HERO_CURVE[0]);
    const end = arcPoint(1);
    expect(end.x).toBeCloseTo(HERO_CURVE[3].x, 5);
    expect(end.y).toBeCloseTo(HERO_CURVE[3].y, 5);
  });

  it('moves the ball right and turns it as the fill grows, inside the box', () => {
    const poses = SAMPLES.map(ballPose);
    for (const p of poses) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(160);
      expect(p.y).toBeGreaterThanOrEqual(11);
      expect(p.y).toBeLessThanOrEqual(260);
    }
    for (let i = 1; i < poses.length; i++) {
      expect(poses[i]!.x).toBeGreaterThan(poses[i - 1]!.x);
      expect(poses[i]!.rotate).toBeGreaterThan(poses[i - 1]!.rotate);
    }
    expect(ballPose(-1)).toEqual(ballPose(0));
    expect(ballPose(2)).toEqual(ballPose(1));
    expect(ballPose(Number.NaN)).toEqual(ballPose(0));
  });

  it('spaces the arc evenly: equal fill steps cover equal distances', () => {
    const steps = Array.from({ length: 20 }, (_, i) => {
      const a = arcPoint(i / 20);
      const b = arcPoint((i + 1) / 20);
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    const mean = steps.reduce((s, d) => s + d, 0) / steps.length;
    for (const d of steps) expect(Math.abs(d - mean) / mean).toBeLessThan(0.05);
  });

  it('derives the stage from the fill', () => {
    expect(APEX_SHARE).toBeGreaterThan(0.75);
    expect(APEX_SHARE).toBeLessThan(0.9);
    expect(SAMPLES.map(ballStage)).toEqual(['hand', 'rising', 'rising', 'rising', 'falling', 'score']);
    expect(ballStage(-0.2)).toBe('hand');
    expect(ballStage(1.5)).toBe('score');
  });

  it('keeps the mini ball inside its square', () => {
    for (const f of SAMPLES) {
      const p = miniPoint(f);
      expect(p.x).toBeGreaterThanOrEqual(5);
      expect(p.x).toBeLessThanOrEqual(35);
      expect(p.y).toBeGreaterThanOrEqual(5);
      expect(p.y).toBeLessThanOrEqual(35);
    }
  });

  it('builds flight keyframes from one fill to another', () => {
    const { ball, trail } = flightFrames(0.9, 1);
    expect(ball.length).toBeGreaterThanOrEqual(3);
    expect(ball[0]!.transform).toContain(`translate(${Number(ballPose(0.9).x.toFixed(2))}px`);
    expect(trail).toEqual([{ strokeDashoffset: '0.1' }, { strokeDashoffset: '0' }]);
    expect(flightFrames(0, 1).ball.length).toBe(25);
  });
});

describe('ball player', () => {
  const FLOOR = 251;
  const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const poses = SAMPLES.map(playerPose);
  const points = poses.map(playerPoints);

  it('holds the ball at the start of the arc in the shooting stance', () => {
    const ball = arcPoint(0);
    const [front, back] = points[0]!.hands;
    // The hands at the ball's lower edge (radius 11), under its centre.
    for (const hand of [front!, back!]) {
      expect(gap(hand, ball)).toBeGreaterThan(8);
      expect(gap(hand, ball)).toBeLessThan(13.5);
      expect(hand.y).toBeGreaterThan(ball.y);
    }
    expect(poses[0]!.crouch).toBeGreaterThan(0);
    // Looking up at the ball.
    expect(poses[0]!.lean + poses[0]!.nod).toBeLessThan(-10);
  });

  it('follows through, then relaxes as the ball flies', () => {
    const [, quarter, half, three, last] = points;
    // Just released: crouched with both arms up over the head.
    expect(poses[1]!.crouch).toBeGreaterThan(3);
    for (const hand of quarter!.hands) expect(hand.y).toBeLessThan(quarter!.head.y - 5);
    // The arms come down and the knees straighten as the fill grows.
    for (const [a, b] of [
      [quarter!, half!],
      [half!, three!],
      [three!, last!],
    ]) {
      expect(b!.hands[0]!.y).toBeGreaterThan(a!.hands[0]!.y);
    }
    for (let i = 2; i < 5; i++) expect(poses[i]!.crouch).toBeLessThan(poses[i - 1]!.crouch);
    expect(last!.hands[0]!.y).toBeGreaterThan(last!.head.y + 12);
    // The release blends out of the stance, with no jump at its start.
    const early = playerPoints(playerPose(0.001)).hands[0]!;
    expect(gap(early, points[0]!.hands[0]!)).toBeLessThan(1);
    expect(playerPose(RELEASE).armF[0]).toBeLessThan(-140);
  });

  it('raises both arms at the basket', () => {
    expect(poses[5]).toBe(CHEER);
    const { hands, head } = points[5]!;
    for (const hand of hands) expect(hand.y).toBeLessThan(head.y - 5);
    // A V: one hand either side of the head.
    expect(Math.min(...hands.map((h) => h.x))).toBeLessThan(head.x);
    expect(Math.max(...hands.map((h) => h.x))).toBeGreaterThan(head.x);
  });

  it('keeps the feet on the floor and the figure in the box, clear of the pile', () => {
    for (const { hands, head, ankles } of points) {
      for (const a of ankles) expect(a.y).toBeCloseTo(FLOOR - 3, 5);
      // Front foot, back foot.
      expect(ankles[0]!.x).toBeGreaterThan(ankles[1]!.x);
      for (const p of [...hands, head]) {
        expect(p.x).toBeGreaterThanOrEqual(4);
        expect(p.x).toBeLessThanOrEqual(80);
        expect(p.y).toBeGreaterThan(150);
        expect(p.y).toBeLessThan(FLOOR);
      }
    }
    // The pile starts past the front foot.
    for (const { ankles } of points) expect(pileBall(0).x - 5).toBeGreaterThan(ankles[0]!.x);
  });

  it('clamps the fill and draws each pose as transforms of its joints', () => {
    expect(playerPose(-1)).toEqual(playerPose(0));
    expect(playerPose(Number.NaN)).toEqual(playerPose(0));
    expect(playerPose(2)).toBe(CHEER);
    const t = poseTransforms(playerPose(0.5));
    expect(t).toHaveLength(13);
    expect(t[0]).toMatch(/^translate\(31px, 251px\) scale\(1, 1\)$/);
    for (const joint of t.slice(1)) expect(joint).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\) rotate\(-?[\d.]+deg\)$/);
    // Flights move the player with the ball, joint by joint.
    const { ball, player } = flightFrames(0, 0.5);
    expect(player).toHaveLength(13);
    for (const frames of player) expect(frames).toHaveLength(ball.length);
    expect(player[11]![0]!.transform).toBe(poseTransforms(playerPose(0))[11]);
  });

  it('jumps at the basket, lands with a squash and ends in the stance', () => {
    const from = playerPose(0.999);
    const frames = cheerFrames(from);
    expect(frames[0]!.pose).toBe(from);
    expect(frames.at(-1)!.pose).toEqual(playerPose(0));
    expect(Math.max(...frames.map((f) => f.pose.lift))).toBeGreaterThanOrEqual(10);
    expect(Math.max(...frames.map((f) => f.pose.squash))).toBeGreaterThan(0.05);
    const offsets = frames.flatMap((f) => (f.offset === undefined ? [] : [f.offset]));
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1]!);
    // The dip meets the ball at the rim: the beat's offset scaled to the beat plus the reset.
    expect(offsets[0]).toBeLessThan(0.3);
    const keyframes = poseKeyframes(frames);
    expect(keyframes).toHaveLength(13);
    expect(keyframes[0]![2]).toMatchObject({ offset: frames[2]!.offset });
  });
});

describe('ball pile', () => {
  const R = 5;
  const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  it('keeps one ball per past level', () => {
    expect([undefined, 0, Number.NaN, Infinity, 1, 2, 4.7, 5, 60].map(pileCount)).toEqual([0, 0, 0, 0, 0, 1, 3, 4, 59]);
    for (const n of [0, 1, 4, 11, 15, 22, 59]) expect(pileLayout(n)).toHaveLength(Math.min(n, PILE_SLOTS));
    expect(PILE_SLOTS).toBeGreaterThanOrEqual(20);
  });

  it('never moves a ball once placed', () => {
    const all = pileLayout(PILE_SLOTS);
    expect(pileLayout(10)).toEqual(all.slice(0, 10));
    expect(pileLayout(5)).toEqual(pileLayout(PILE_SLOTS).slice(0, 5));
    expect(pileBall(7)).toEqual(all[7]);
  });

  it('rests each ball on the floor, on two others or in the cart, without overlaps', () => {
    const all = pileLayout(PILE_SLOTS);
    all.forEach((b, i) => {
      // Inside the box, on the floor or above it.
      expect(b.x - R).toBeGreaterThanOrEqual(0);
      expect(b.y + R).toBeLessThanOrEqual(251 + 1e-9);
      for (let j = 0; j < i; j++) expect(gap(b, all[j]!)).toBeGreaterThanOrEqual(2 * R - 1e-6);
      const inCart = b.x + R <= 25;
      const onFloor = Math.abs(b.y + R - 251) < 1e-9;
      const below = all.slice(0, i).filter((o) => o.y > b.y && Math.abs(gap(o, b) - 2 * R) < 1e-6);
      expect(inCart || onFloor || below.length === 2).toBe(true);
      // Placed after the balls it rests on.
      if (!inCart && !onFloor) for (const o of below) expect(all.indexOf(o)).toBeLessThan(i);
    });
    // The heap first rolls along the floor: five balls, then the rows above.
    expect(all.slice(0, 5).every((b) => b.y === 246)).toBe(true);
    for (let i = 1; i < 5; i++) expect(all[i]!.x).toBeGreaterThan(all[i - 1]!.x);
  });

  it('stays clear of the arc, the ball in the hands and the captions', () => {
    const arc = Array.from({ length: 201 }, (_, s) => arcPoint(s / 200));
    for (const b of pileLayout(PILE_SLOTS)) {
      // Left of the captions' column and its leaders (x ≥ 93), under the lowest caption beside a flag.
      expect(b.x + R).toBeLessThan(91);
      expect(b.y - R).toBeGreaterThan(200);
      for (const p of arc) expect(gap(b, p)).toBeGreaterThan(R + 11);
    }
  });

  it('varies the colours and the seams', () => {
    const all = pileLayout(PILE_SLOTS);
    const tones = all.map((b) => b.tone);
    expect(new Set(tones.slice(0, 12)).size).toBe(4);
    // Mostly orange; the skill colour now and then.
    expect(tones.filter((t) => t < 2).length).toBeGreaterThan(all.length / 2);
    expect(tones.filter((t) => t === 3).length).toBeLessThanOrEqual(Math.ceil(all.length / 8));
    expect(new Set(all.map((b) => Math.round(b.rotate))).size).toBe(all.length);
  });

  it('brings each ball from the net to its place: a fall, a bounce, then a roll or a hop', () => {
    for (let i = 0; i < PILE_SLOTS; i++) {
      const path = joinPath(i, 125);
      const to = pileBall(i);
      expect(path[0]).toMatchObject({ x: 124, y: 98, at: 0, scale: 11 / 5 });
      // On the floor at the moment the ball in the net's drop lands there.
      expect(path[1]).toMatchObject({ x: 124, y: 246, at: 125, scale: 1 });
      const last = path.at(-1)!;
      expect(last).toEqual({ x: to.x, y: to.y, at: last.at, rotate: to.rotate, scale: 1 });
      expect(last.at).toBeLessThanOrEqual(640);
      for (let k = 1; k < path.length; k++) expect(path[k]!.at).toBeGreaterThan(path[k - 1]!.at);
      for (const p of path) {
        expect(p.y + 5).toBeLessThanOrEqual(251 + 1e-9);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(160);
      }
    }
    // A floor ball rolls: its turn matches the distance.
    const roll = joinPath(0, 125).slice(-2);
    expect(roll[0]!.y).toBe(246);
    expect((roll[0]!.rotate - roll[1]!.rotate) * (Math.PI / 180) * 5).toBeCloseTo(roll[0]!.x - roll[1]!.x, 5);
    // A cart ball flies over the player's head (y < 185 above x 33).
    const cart = joinPath(PILE_SLOTS - 1, 125);
    expect(cart.some((p) => p.x > 25 && p.x < 45 && p.y < 185)).toBe(true);
  });
});

describe('ball marks', () => {
  it('places marks along the arc, monotonic and inside the box', () => {
    let previous = markPoint(0);
    for (let i = 0; i <= 100; i++) {
      const p = markPoint(i / 100);
      expect(p.x).toBeGreaterThanOrEqual(previous.x);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(160);
      previous = p;
    }
    expect(markPoint(1).x).toBeGreaterThan(markPoint(0).x);
    expect(markPoint(-1)).toEqual(markPoint(0));
    expect(markPoint(5)).toEqual(markPoint(1));
    expect(ballTheme.markPoint).toBe(markPoint);
  });

  it('hangs every pennant on the path at its own mark, in the order of the marks', () => {
    const arc = Array.from({ length: 1001 }, (_, s) => markPoint(s / 1000));
    const gap = (q: Point, p: Point) => Math.hypot(q.x - p.x, q.y - p.y);
    // The share of the flight nearest to a point, and how far the point is from the flight.
    const nearest = (q: Point) => arc.reduce((best, p, s) => (gap(q, p) < best.d ? { s: s / 1000, d: gap(q, p) } : best), { s: 0, d: Infinity });
    let previous: { top: Point; s: number } | null = null;
    for (let i = 0; i <= 200; i++) {
      const h = i / 200;
      const top = pennantTop(h);
      // The anchor sits within 8 units of markPoint(h), past the ticks (±3): on the path, also over the board.
      const d = gap(top, markPoint(h));
      expect(d).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(d).toBeLessThanOrEqual(8);
      const at = nearest(top);
      expect(Math.abs(at.s - h)).toBeLessThan(0.01);
      // Anchors move along the path with the height.
      if (previous) {
        expect(top.x).toBeGreaterThan(previous.top.x);
        expect(at.s).toBeGreaterThanOrEqual(previous.s);
      }
      // The flag's tip stays clear of the flight's trail (3 units wide) where it falls to the hoop.
      expect(nearest({ x: top.x + 9, y: top.y + 3.5 }).d).toBeGreaterThan(3);
      // The pole (13 units) stays in the box.
      expect(top.y).toBeGreaterThanOrEqual(0);
      expect(poleFoot(h).y).toBeLessThanOrEqual(260);
      previous = { top, s: at.s };
    }
  });

  it('puts a mark on the same scale as the ball and the ticks', () => {
    for (const h of SAMPLES) expect(markPoint(h)).toEqual(arcPoint(h));
    // A mark at 0.9 is still ahead of a ball at 0.85.
    expect(markPoint(0.9).x).toBeGreaterThan(ballPose(0.85).x);
  });

  it('shortens captions and keeps them apart', () => {
    expect(shortLabel('Экзамен')).toBe('Экзамен');
    expect(shortLabel('Пробный тест')).toBe('Пробный тест');
    expect(shortLabel('Длинное название засечки')).toBe('Длинное наз…');
    for (const heights of MARK_SETS) {
      const ys = captionSpots(heights).map((s) => s.y);
      // The highest mark on top, at least 28 units apart.
      const byHeight = heights.map((h, i) => ({ h, y: ys[i]! })).sort((a, b) => b.h - a.h);
      for (let i = 1; i < byHeight.length; i++) expect(byHeight[i]!.y - byHeight[i - 1]!.y).toBeGreaterThanOrEqual(28 - 1e-9);
      // Under the net's hem, inside the box.
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(102);
      expect(Math.max(...ys)).toBeLessThanOrEqual(248);
    }
  });

  it('keeps a caption at its own flag, or a full 44 px tap target away from the next', () => {
    const ysOf = (heights: number[]) => captionSpots(heights).map((s) => s.y);
    for (const heights of [[0.3, 0.6], [0.2], [0.05, 0.3], [0.2, 0.45, 0.8]]) {
      const ys = ysOf(heights);
      heights.forEach((h, i) => {
        if (Math.abs(ys[i]! - flagY(h)) > 8) expect(captionPad(ys, i)).toBeGreaterThanOrEqual(12);
      });
    }
    // Flags far apart below the hem: each caption beside its own flag.
    const low = ysOf([0.05, 0.3]);
    expect(Math.abs(low[0]! - flagY(0.05))).toBeLessThan(8);
    expect(low[1]).toBeCloseTo(flagY(0.3), 5);
    // One flag above the hem, one below: 44 px tap targets.
    const split = ysOf([0.3, 0.6]);
    expect([captionPad(split, 0), captionPad(split, 1)]).toEqual([14, 14]);
    // Column captions spread over the free height: three always get 44 px, four about 42 px.
    for (const heights of [[0.9, 0.95, 0.99], [0.76, 0.8, 0.84], [0.5, 0.9, 1]]) {
      const ys = ysOf(heights);
      expect(ys.map((_, i) => captionPad(ys, i))).toEqual([14, 14, 14]);
    }
    const four = ysOf([0.7, 0.76, 0.8, 0.84]);
    for (let i = 0; i < 4; i++) expect(captionPad(four, i)).toBeGreaterThanOrEqual(13);
  });

  it('joins column captions to their pennants with leaders that cross no caption and no other leader', () => {
    type Seg = [Point, Point];
    const cross = ([a, b]: Seg, [c, d]: Seg) => {
      const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
    };
    for (const heights of MARK_SETS) {
      const spots = captionSpots(heights);
      const leaders = heights.flatMap((h, i) => (spots[i]!.x >= 96 ? [[poleFoot(h), { x: spots[i]!.x - 3, y: spots[i]!.y }] as Seg] : []));
      for (const [a, b] of leaders) {
        // Past every caption above its end: the text band (±9 units) starts right of the leader.
        for (const s of spots) {
          if (s.y >= b.y) continue;
          for (const y of [s.y - 9, s.y, s.y + 9]) if (y > a.y) expect(a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y)).toBeLessThan(s.x - 2);
        }
      }
      for (let i = 0; i < leaders.length; i++) for (let j = 0; j < i; j++) expect(cross(leaders[i]!, leaders[j]!)).toBe(false);
      // The staircase stays within the room for captions.
      for (const s of spots) expect(s.x).toBeLessThanOrEqual(116);
    }
  });

  it('pads the captions without overlapping tap boxes', () => {
    for (const ys of [[0.3, 0.31, 0.32, 0.33], [0.1, 0.3, 0.6], [0.7, 0.76, 0.8, 0.84]].map((h) => captionSpots(h).map((s) => s.y)).concat([[102, 140]])) {
      // A box is the 16 px line plus the padding above and below; hero units are 0.875 px.
      const boxes = ys.map((y, i) => ({ y: y * 0.875, half: 8 + captionPad(ys, i) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y - boxes[i]!.half).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.half);
    }
    expect(captionPad([140], 0)).toBe(14);
  });
});

describe('ball beat', () => {
  const y = (k: Keyframe) => Number(/translate\([\d.]+px, ([\d.]+)px\)/.exec(String(k.transform))![1]);

  it('meets the rim at BEAT_RIM, the moment the haptic, the ripple and the spark use', () => {
    const { ball } = dropFrames();
    expect(String(ball[0]!.transform)).toBe(`${flightFrames(1, 1).ball[0]!.transform} scale(1)`);
    const rim = ball.find((k) => k.offset === BEAT_RIM)!;
    expect(y(rim)).toBe(56);
    // Each segment eases on its own: no whole-effect easing reshapes the offsets.
    for (const k of ball.slice(0, 3)) expect(k.easing).toMatch(/^cubic-bezier/);
    const ys = ball.map(y);
    for (let i = 1; i < 4; i++) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
    expect(ys[4]).toBe(ys[3]);
  });

  it('keeps the ball opaque until it clears the net, then hands it to the pile on the way down', () => {
    const { ball, fade } = dropFrames();
    const hem = ball.find((k) => k.offset === BEAT_HEM)!;
    // The net's hem is at y 87; the ball (radius 11) has cleared it.
    expect(y(hem)).toBeGreaterThanOrEqual(98);
    expect(fade.slice(0, 2)).toEqual([{ opacity: 1 }, { opacity: 1, offset: BEAT_HEM }]);
    expect(fade[2]).toMatchObject({ opacity: 0 });
    // Gone before the new ball appears in the hands, which cancels the drop.
    expect(fade[2]!.offset).toBeLessThan(BEAT_HAND);
    // It lands where the pile's ball does, at the pile's size.
    const floor = ball.find((k) => k.offset === BEAT_FLOOR)!;
    expect(y(floor)).toBe(246);
    expect(String(floor.transform)).toMatch(/scale\(0.45\)$/);
    // Inside the net for at least 150 ms of the first beat: nine frames at 60 fps.
    const beat = ballPhaseTiming({ phase: 'beat', cyclesLeft: 1, cycle: 0 }).duration;
    expect((BEAT_HEM - BEAT_RIM) * beat).toBeGreaterThanOrEqual(150);
  });
});

describe('ball level-up state machine', () => {
  const run = (levels: number) => {
    const phases: BallAnimState[] = [];
    let state = nextBallPhase(BALL_IDLE, { type: 'start', levels });
    while (state.phase !== 'idle' && phases.length < 50) {
      phases.push(state);
      state = nextBallPhase(state, { type: 'done' });
    }
    return phases;
  };

  it('plays rise → beat → reset → refill for one level', () => {
    expect(run(1).map((s) => s.phase)).toEqual(['rising', 'beat', 'reset', 'refilling']);
  });

  it('scores again for every extra level, at most three times', () => {
    expect(run(2).map((s) => s.phase)).toEqual(['rising', 'beat', 'reset', 'refilling', 'beat', 'reset', 'refilling']);
    const many = run(10);
    expect(many.filter((s) => s.phase === 'beat')).toHaveLength(MAX_CYCLES);
    expect(many.at(-1)!.cyclesLeft).toBe(1);
  });

  it('refills to the hoop between levels and to toFill on the last', () => {
    const phases = run(3).filter((s) => s.phase === 'refilling');
    expect(phases.map((s) => ballRefillTarget(s, 0.2))).toEqual([1, 1, 0.2]);
    expect(ballRefillTarget(phases[2]!, 7)).toBe(1);
  });

  it('ignores a bad start and out-of-order events, and aborts to idle', () => {
    expect(nextBallPhase(BALL_IDLE, { type: 'start', levels: 0 })).toBe(BALL_IDLE);
    expect(nextBallPhase(BALL_IDLE, { type: 'start', levels: Number.NaN })).toBe(BALL_IDLE);
    expect(nextBallPhase(BALL_IDLE, { type: 'done' })).toBe(BALL_IDLE);
    const rising = nextBallPhase(BALL_IDLE, { type: 'start', levels: 1 });
    expect(nextBallPhase(rising, { type: 'start', levels: 2 })).toBe(rising);
    expect(nextBallPhase(rising, { type: 'abort' })).toBe(BALL_IDLE);
  });

  it('fits one level in 1.2 s and compresses the repeats', () => {
    const total = (states: BallAnimState[]) => states.reduce((sum, s) => sum + ballPhaseTiming(s).delay + ballPhaseTiming(s).duration, 0);
    const one = run(1);
    expect(total(one)).toBeLessThanOrEqual(1200);
    // As played, the reset starts at BEAT_HAND of the beat, and the ball joining the pile lands
    // before the new ball reaches toFill: about 1.1 s.
    const [rising, beat, reset, refill] = one.map((s) => ballPhaseTiming(s).duration);
    const played = rising! + beat! * BEAT_HAND + reset! + refill!;
    expect(played).toBeLessThanOrEqual(1100);
    const joined = Math.max(...Array.from({ length: PILE_SLOTS }, (_, i) => joinPath(i, beat! * (BEAT_FLOOR - BEAT_HEM)).at(-1)!.at));
    expect(rising! + beat! * BEAT_HEM + joined).toBeLessThanOrEqual(1150);
    const three = run(3);
    const repeat = three.filter((s) => s.cycle === 1);
    expect(repeat.map((s) => s.phase)).toEqual(['beat', 'reset', 'refilling']);
    expect(total(repeat)).toBeLessThan(total(one.slice(1)));
    expect(total(three)).toBeLessThanOrEqual(1200 * 3);
    expect(ballPhaseTiming(BALL_IDLE).duration).toBe(0);
  });
});

describe('ball text', () => {
  const { text } = ballTheme;

  it('names the level in every form', () => {
    const count = (n: number) => `${n} ${plural(n, text.levelForms)}`;
    expect([1, 2, 5, 11, 21].map(count)).toEqual(['1 бросок', '2 броска', '5 бросков', '11 бросков', '21 бросок']);
    const of = (n: number) => `из ${n} ${plural(n, text.levelFormsOf)}`;
    expect([1, 2, 5, 11, 21].map(of)).toEqual(['из 1 броска', 'из 2 бросков', 'из 5 бросков', 'из 11 бросков', 'из 21 броска']);
    expect(`${text.levelNoun} 3`).toBe('Бросок 3');
    expect(`ещё 5 до ${text.levelGenitive} 4`).toBe('ещё 5 до броска 4');
  });

  it('describes completion and the fill', () => {
    expect(text.name).toBe('Мяч в корзину');
    expect(text.completed(3)).toBe('Бросок 3: попадание');
    expect(text.fillLabel(45)).toBe('Мяч пролетел 45% пути к кольцу');
    expect(text.hint).toBe('Мяч летит по дуге в корзину');
  });

  it('keeps the tone: no forbidden words, no exclamation marks', () => {
    const strings = [text.name, text.levelNoun, text.levelGenitive, ...text.levelForms, ...text.levelFormsOf, text.completed(1), text.completed(21), text.fillLabel(0), text.fillLabel(100), text.hint];
    for (const s of strings) {
      expect(s).not.toMatch(FORBIDDEN);
      expect(s).not.toContain('!');
    }
  });

  it('is registered under its key and shown in the picker', () => {
    expect(ballTheme.key).toBe('ball');
    expect(ballTheme.available).toBe(true);
  });
});
