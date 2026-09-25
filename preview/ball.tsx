// Dev-only preview of the «Мяч в корзину» theme: npx vite, then /preview/ball.html
// (?dark, ?tg=purple, ?motion=reduced, ?levels=3, ?marks=0.3,0.6, ?after=0.35). Not part of the production build.
// «Мячи» shows the pile of past levels; the stage hero starts on level 4 and, like the app, renders
// the new level with the new fill before each level-up.
import { useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import type { ProgressHeroHandle, ProgressState } from '../src/ui/progress/contract';
import { ballTheme } from '../src/ui/progress/themes/ball';

const params = Object.fromEntries(new URLSearchParams(location.search)) as Record<string, string | undefined>;
const root = document.documentElement;
if ('dark' in params || params.tg === 'purple') {
  root.dataset.theme = 'dark';
  root.style.colorScheme = 'dark';
}
if (params.tg === 'purple') {
  const vars: Record<string, string> = {
    '--tg-theme-button-color': '#8774e1',
    '--tg-theme-button-text-color': '#ffffff',
    '--tg-theme-bg-color': '#1e1b2e',
    '--tg-theme-secondary-bg-color': '#151321',
    '--tg-theme-section-bg-color': '#1e1b2e',
    '--tg-theme-text-color': '#f0eefb',
    '--tg-theme-hint-color': '#9b95b8',
    '--tg-theme-link-color': '#a597ff',
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}
const motion = params.motion === 'reduced' ? 'reduced' : 'full';
if (motion === 'reduced') root.dataset.motion = 'reduced';

const { Hero, Mini, text } = ballTheme;
const FILLS = [0, 0.25, 0.5, 0.75, 0.999];
const CASES: { fill: number; state: ProgressState; caption: string }[] = [
  ...FILLS.map((fill) => ({ fill, state: (fill === 0 ? 'empty' : 'active') as ProgressState, caption: `${fill * 100}%` })),
  { fill: 1, state: 'complete', caption: 'complete' },
];
const LEVELS = [1, 2, 5, 12, 25, 60];
const LABELS = ['Пробный тест', 'Длинное название засечки', 'Экзамен', 'Зачёт'];
// ?marks=0.3,0.6 tries other heights; the default shows three marks with a long label.
const MARKS = (params.marks?.split(',').map(Number) ?? [0.2, 0.45, 0.8]).map((height, i) => ({ id: String(i), label: LABELS[i % 4]!, height }));

const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: 8,
  borderRadius: 16,
  background: 'var(--color-bg-elevated)',
};
const caption: CSSProperties = { fontSize: 12, color: 'var(--color-fg-secondary)' };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 };

function Preview() {
  const stage = useRef<ProgressHeroHandle>(null);
  const [beats, setBeats] = useState(0);
  const [tapped, setTapped] = useState('');
  const [fill, setFill] = useState(0.9);
  const [level, setLevel] = useState(4);
  const levels = Number(params.levels ?? 1);
  // Like the app: the new level and fill render first, then the level-up plays. ?after=0.35 is a
  // later write that lands during the level-up (the ball glides on to it afterwards).
  const levelUp = () => {
    const from = fill;
    flushSync(() => {
      setLevel((l) => l + levels);
      setFill(0.2);
    });
    void stage.current?.playLevelUp({ fromFill: from, toFill: 0.2, levels, onOverflow: () => setBeats((n) => n + 1) });
    if (params.after) window.setTimeout(() => setFill(Number(params.after)), 300);
  };

  return (
    <main style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, color: 'var(--color-fg)' }}>
      <header>
        <div className="t-title-m">{text.name}</div>
        <div style={caption}>
          {text.hint} · {text.completed(3)} · {motion}
        </div>
      </header>
      <section style={grid}>
        {CASES.map((c) => (
          <div key={c.caption} style={card}>
            <Hero fill={c.fill} state={c.state} capacity={100} motion={motion} />
            <span style={caption}>{c.caption}</span>
          </div>
        ))}
      </section>
      <section style={{ ...card, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end' }}>
        {CASES.map((c, i) => (
          <div key={c.caption} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <Mini fill={c.fill} state={c.state} level={i + 1} size={28} motion={motion} />
            <Mini fill={c.fill} state={c.state} level={i + 1} size={40} motion={motion} />
          </div>
        ))}
      </section>
      <section id="balls" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="t-title-s">Мячи</div>
        <div style={grid}>
          {LEVELS.map((l) => (
            <div key={l} style={card}>
              <Hero fill={0.5} level={l} capacity={100} motion={motion} />
              <span style={caption}>
                {text.levelNoun} {l}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section id="marks" style={{ ...card, alignItems: 'flex-start' }}>
        <Hero fill={0.6} level={12} capacity={100} motion={motion} marks={MARKS} onMarkTap={setTapped} />
        <span style={caption}>marks · tapped: {tapped || '—'}</span>
      </section>
      <section style={{ ...card, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <div id="stage" style={{ padding: 8 }}>
          <Hero ref={stage} fill={fill} level={level} capacity={100} motion={motion} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <button id="levelup" type="button" onClick={levelUp} style={{ padding: '10px 16px', borderRadius: 12, border: 0, background: 'var(--color-accent)', color: 'var(--color-on-accent)', font: 'inherit' }}>
            Level up
          </button>
          <span style={caption}>
            level {level} · levels={levels} · beats: {beats}
          </span>
        </div>
      </section>
    </main>
  );
}

document.body.style.background = 'var(--color-bg)';
document.body.style.margin = '0';
createRoot(document.getElementById('root')!).render(<Preview />);
