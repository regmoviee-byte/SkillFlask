// Dev-only preview of the «Ракета» progress theme: heroes at 0 / 25 / 50 / 75 / 99.9 % and
// complete, a row of minis, a hero with marks, «Планеты» (levels 1–12, one generated planet and
// route each) and a stage hero whose level-up hands the destination over as the next ground.
// URL params: ?dark, ?tg=purple, ?motion=reduced, ?levels=N (levels per level-up), ?level=N (the
// stage's first level).
import { StrictMode, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import type { ProgressHeroHandle, ProgressState } from '../src/ui/progress/contract';
import { RocketMini, planetFor, rocketTheme, routeFor } from '../src/ui/progress/themes/rocket';

const params = Object.fromEntries(new URLSearchParams(location.search).entries()) as Record<string, string | undefined>;
const root = document.documentElement;
const purple = params.tg === 'purple';
if ('dark' in params || purple) {
  root.dataset.theme = 'dark';
  root.style.colorScheme = 'dark';
} else {
  root.dataset.theme = 'light';
}
if (purple) {
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

const { Hero, Mini, text } = rocketTheme;
const FILLS = [0, 0.25, 0.5, 0.75, 0.999];
const CASES: { fill: number; state: ProgressState; caption: string }[] = [
  ...FILLS.map((fill) => ({ fill, state: (fill === 0 ? 'empty' : 'active') as ProgressState, caption: `${Math.round(fill * 1000) / 10}%` })),
  { fill: 1, state: 'complete', caption: 'complete' },
];
const MARKS = [
  { id: 'a', label: 'Пробный тест', height: 0.3 },
  { id: 'b', label: 'Длинное название засечки', height: 0.45 },
  { id: 'c', label: 'Экзамен', height: 0.8 },
];
const LEVELS = Array.from({ length: 12 }, (_, i) => i + 1);

const card: React.CSSProperties = {
  background: 'var(--color-bg-elevated)',
  borderRadius: 16,
  padding: 16,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 16,
  alignItems: 'flex-end',
};
const label: React.CSSProperties = { fontSize: 12, color: 'var(--color-fg-secondary)', marginTop: 4, textAlign: 'center' };

function Preview() {
  const stage = useRef<ProgressHeroHandle>(null);
  const [status, setStatus] = useState('');
  const [tapped, setTapped] = useState('');
  // The app's order: the write renders the new level and fill, then the level-up plays.
  const [stageLevel, setStageLevel] = useState(Math.max(1, Number(params.level ?? 1)));
  const [stageFill, setStageFill] = useState(0.9);
  const play = async () => {
    const levels = Number(params.levels ?? 1);
    const fromFill = stageFill;
    setStatus('…');
    flushSync(() => {
      setStageLevel((l) => l + levels);
      setStageFill(0.2);
    });
    await stage.current?.playLevelUp({ fromFill, toFill: 0.2, levels, onOverflow: () => setStatus('touchdown') });
    setStatus('done');
  };
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="t-title-m" style={{ margin: 0 }}>
        {text.name} · {text.hint}
      </h1>
      <div id="heroes" style={card}>
        {CASES.map(({ fill, state, caption }) => (
          <div key={caption}>
            <Hero fill={fill} state={state} capacity={100} motion={motion} />
            <div style={label}>{caption}</div>
          </div>
        ))}
        <div>
          <Hero fill={1} state="complete" capacity={100} motion={motion} level={8} />
          <div style={label}>полёт 8 · complete</div>
        </div>
        <div>
          <Hero fill={0} state="empty" capacity={100} motion={motion} level={5} />
          <div style={label}>полёт 5 · 0%</div>
        </div>
      </div>
      <div id="minis" style={card}>
        {CASES.map(({ fill, state, caption }) => (
          <div key={caption} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <Mini fill={fill} state={state} motion={motion} size={40} />
            <Mini fill={fill} state={state} motion={motion} size={28} />
            <div style={label}>{caption}</div>
          </div>
        ))}
        {LEVELS.map((level) => (
          <div key={`l${level}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <RocketMini fill={0.55} motion={motion} size={40} level={level} />
            <RocketMini fill={0.55} motion={motion} size={28} level={level} />
            <div style={label}>L{level}</div>
          </div>
        ))}
      </div>
      <div id="marks" style={card}>
        <div>
          <Hero fill={0.6} capacity={100} motion={motion} marks={MARKS} onMarkTap={setTapped} />
          <div style={label}>60% · засечки {tapped && `· ${tapped}`}</div>
        </div>
        <div>
          <Hero fill={0.6} capacity={100} motion={motion} marks={MARKS} level={4} />
          <div style={label}>полёт 4 · засечки</div>
        </div>
      </div>
      <h2 className="t-title-m" style={{ margin: 0 }}>
        Планеты
      </h2>
      <div id="planets" style={card}>
        {LEVELS.map((level) => (
          <div key={level}>
            <Hero fill={0.55} capacity={100} motion={motion} level={level} />
            <div style={label}>
              {level} · {planetFor(level).name}
              <br />
              {routeFor(level).kind} · {planetFor(level).palette}
            </div>
          </div>
        ))}
      </div>
      <div style={{ ...card, alignItems: 'center' }}>
        <div id="stage" style={{ padding: 8 }}>
          <Hero ref={stage} fill={stageFill} capacity={100} motion={motion} level={stageLevel} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button id="levelup" type="button" onClick={play} style={{ padding: '10px 16px', borderRadius: 12, border: 0, background: 'var(--color-accent)', color: 'var(--color-on-accent)', font: 'inherit' }}>
            Level up
          </button>
          <div style={label}>
            {text.levelNoun} {stageLevel} · {planetFor(stageLevel).name}
          </div>
          <div style={label}>{status}</div>
          {stageLevel > 1 && <div style={label}>{text.completed(stageLevel - 1)}</div>}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
