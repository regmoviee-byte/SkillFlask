// Dev-only preview of the «Машинка» progress theme: npx vite, then /preview/car.html
// (?dark, ?tg=purple, ?motion=reduced, ?levels=3). Not part of the production build.
// «Дороги» shows the six roads (levels 1–6); the stage hero starts on level 1 and each level-up
// moves it on, so clicking walks through the roads.
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import type { ProgressHeroHandle, ProgressState } from '../src/ui/progress/contract';
import { carTheme } from '../src/ui/progress/themes/car';

const params = Object.fromEntries(new URLSearchParams(location.search));
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

const { Hero, Mini } = carTheme;
const FILLS = [0, 0.25, 0.5, 0.75, 0.999];
const ROAD_NAMES = ['Серпантин', 'Плавные изгибы', 'Спираль в гору', 'Городские кварталы', 'Вдоль побережья', 'Пустыня'];
const MARKS = [
  { id: 'a', label: 'Пробный тест', height: 0.2 },
  { id: 'b', label: 'Длинное название засечки', height: 0.45 },
  { id: 'c', label: 'Экзамен', height: 0.85 },
];

const card: React.CSSProperties = { background: 'var(--color-bg-elevated)', borderRadius: 16, padding: 16, marginBottom: 12 };
const label: React.CSSProperties = { color: 'var(--color-fg-secondary)', fontSize: 13, marginBottom: 8 };

function Stage() {
  const ref = useRef<ProgressHeroHandle>(null);
  const [beats, setBeats] = useState(0);
  // Like the app: render the new level together with the new fill first, then play the level-up.
  // The hero keeps the road it had on screen until the play takes it on to the new level's road.
  const [fill, setFill] = useState(0.9);
  const [level, setLevel] = useState(1);
  const levels = Number(params.levels ?? 1);
  return (
    <div style={card}>
      <div style={label}>
        Level up · {levels} · level {level} · beats {beats}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div id="stage" style={{ display: 'inline-block' }}>
          <Hero ref={ref} fill={fill} level={level} capacity={100} motion={motion} />
        </div>
        <button
          id="levelup"
          type="button"
          style={{ padding: '10px 14px', borderRadius: 12, border: 0, background: 'var(--color-accent)', color: 'var(--color-on-accent)', font: 'inherit' }}
          onClick={() => {
            const fromFill = Math.max(fill, 0.9);
            flushSync(() => {
              setFill(0.2);
              setLevel(level + levels);
            });
            void ref.current?.playLevelUp({ fromFill, toFill: 0.2, levels, onOverflow: () => setBeats((b) => b + 1) });
          }}
        >
          Level up
        </button>
      </div>
    </div>
  );
}

function App() {
  const states: { fill: number; state?: ProgressState; name: string }[] = [
    ...FILLS.map((fill) => ({ fill, name: `${fill * 100}%` })),
    { fill: 1, state: 'complete', name: 'complete' },
  ];
  return (
    <div style={{ padding: 16, background: 'var(--color-bg)', minHeight: '100vh', color: 'var(--color-fg)', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>{carTheme.text.name}</h1>
      <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        {states.map((s) => (
          <Mini key={s.name} fill={s.fill} state={s.state} motion={motion} size={40} />
        ))}
        {states.map((s) => (
          <Mini key={`s-${s.name}`} fill={s.fill} state={s.state} motion={motion} size={28} />
        ))}
        {ROAD_NAMES.map((name, i) => (
          <Mini key={name} fill={0.5} level={i + 1} motion={motion} size={40} label={name} />
        ))}
        {ROAD_NAMES.map((name, i) => (
          <Mini key={`s-${name}`} fill={0.5} level={i + 1} motion={motion} size={28} label={name} />
        ))}
      </div>
      <Stage />
      <div id="roads" style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ ...label, gridColumn: '1 / -1', marginBottom: 0 }}>Дороги · 50%</div>
        {ROAD_NAMES.map((name, i) => (
          <div key={name}>
            <div style={label}>
              {i + 1}. {name}
            </div>
            <Hero fill={0.5} level={i + 1} capacity={100} motion={motion} />
          </div>
        ))}
      </div>
      <div style={card}>
        <div style={label}>Засечки · 60%</div>
        <Hero fill={0.6} capacity={100} motion={motion} marks={MARKS} onMarkTap={(id) => console.log('mark', id)} />
      </div>
      <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {states.map((s) => (
          <div key={s.name}>
            <div style={label}>{s.name}</div>
            <Hero fill={s.fill} state={s.state} capacity={100} motion={motion} />
          </div>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
