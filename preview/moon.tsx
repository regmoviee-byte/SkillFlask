// Dev-only preview of the «Луна» progress theme: /preview/moon.html
// ?dark · ?tg=purple · ?motion=reduced · ?levels=3 · ?level=8 (the stage's starting level)
import { StrictMode, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import type { ProgressHeroHandle, ProgressState } from '../src/ui/progress/contract';
import { moonCaption, moonName, moonTheme } from '../src/ui/progress/themes/moon';

const params = Object.fromEntries(new URLSearchParams(location.search));
const root = document.documentElement;
if ('dark' in params || params.tg === 'purple') {
  root.dataset.theme = 'dark';
  root.style.colorScheme = 'dark';
} else {
  root.dataset.theme = 'light';
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

const { Hero, Mini, text } = moonTheme;
const FILLS = [0, 0.25, 0.5, 0.75, 0.999];
const CASES: { fill: number; state: ProgressState; title: string }[] = [
  ...FILLS.map((fill) => ({ fill, state: (fill === 0 ? 'empty' : 'active') as ProgressState, title: `${Math.round(fill * 1000) / 10}%` })),
  { fill: 1, state: 'complete', title: 'complete' },
];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const SKY = [1, 8, 15, 36, 100];
const SPECIAL = [9, 13, 17];
const MARKS = [
  { id: 'a', label: 'Пробный тест', height: 0.2 },
  { id: 'b', label: 'Длинное название засечки', height: 0.45 },
  { id: 'c', label: 'Экзамен', height: 0.8 },
];

const section: CSSProperties = { padding: '16px', borderBottom: '1px solid var(--color-border)' };
const h: CSSProperties = { margin: '0 0 12px', fontSize: 15, fontWeight: 600 };
const caption: CSSProperties = { fontSize: 12, color: 'var(--color-fg-secondary)', textAlign: 'center', marginTop: 4 };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, justifyItems: 'center' };

function Preview() {
  const stage = useRef<ProgressHeroHandle>(null);
  const [level, setLevel] = useState(Number(params.level ?? 1));
  const [fill, setFill] = useState(0.9);
  const [tapped, setTapped] = useState('');
  const [beats, setBeats] = useState(0);

  // The app's order: render the new level with its fill, then play the level-up.
  const levelUp = () => {
    const levels = Number(params.levels ?? 1);
    flushSync(() => {
      setLevel((l) => l + levels);
      setFill(0.2);
    });
    void stage.current?.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels, onOverflow: () => setBeats((n) => n + 1) });
  };

  return (
    <main style={{ maxWidth: 390, margin: '0 auto', paddingBottom: 40 }}>
      <section style={section}>
        <h1 style={{ ...h, fontSize: 20 }}>{text.name}</h1>
        <div style={{ color: 'var(--color-fg-secondary)', fontSize: 13 }}>{text.hint}</div>
        <div style={{ color: 'var(--color-fg-secondary)', fontSize: 13 }}>
          {text.completed(3)} · ещё 5 до {text.levelGenitive} 4 · {text.fillLabel(45)}
        </div>
      </section>
      <section style={section}>
        <h2 style={h}>Hero</h2>
        <div style={grid}>
          {CASES.map((c) => (
            <div key={c.title}>
              <Hero fill={c.fill} state={c.state} capacity={100} motion={motion} />
              <div style={caption}>{c.title}</div>
            </div>
          ))}
        </div>
      </section>
      <section id="months" style={section}>
        <h2 style={h}>Месяцы</h2>
        <div style={grid}>
          {MONTHS.map((l) => (
            <div key={l}>
              <Hero fill={0.999} level={l} capacity={100} motion={motion} />
              <div style={caption}>
                {l} · {moonName(l)}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section id="sky" style={section}>
        <h2 style={h}>Небо</h2>
        <div style={grid}>
          {SKY.map((l) => (
            <div key={l}>
              <Hero fill={0.5} level={l} capacity={100} motion={motion} />
              <div style={caption}>
                уровень {l} · звёзд {l - 1}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section id="special" style={section}>
        <h2 style={h}>Особые луны</h2>
        <div style={grid}>
          {SPECIAL.map((l) => (
            <div key={l}>
              <Hero fill={0.999} level={l} capacity={100} motion={motion} />
              <div style={caption}>
                {l} · {moonCaption(l)}
              </div>
            </div>
          ))}
          <div>
            <Hero fill={0.7} level={17} capacity={100} motion={motion} />
            <div style={caption}>17 · 70%</div>
          </div>
        </div>
      </section>
      <section style={section}>
        <h2 style={h}>Mini</h2>
        {[32, 28].map((size) => (
          <div key={size} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            {CASES.map((c) => (
              <Mini key={c.title} fill={c.fill} state={c.state} size={size} motion={motion} />
            ))}
            {SPECIAL.map((l) => (
              <Mini key={l} fill={0.999} level={l} size={size} motion={motion} />
            ))}
            <span style={caption}>{size} px</span>
          </div>
        ))}
      </section>
      <section style={section}>
        <h2 style={h}>Засечки · 60%</h2>
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <Hero fill={0.6} capacity={100} motion={motion} marks={MARKS} onMarkTap={setTapped} />
          <div style={{ fontSize: 13, color: 'var(--color-fg-secondary)' }}>{tapped && `tap: ${tapped}`}</div>
        </div>
      </section>
      <section style={section}>
        <h2 style={h}>Level up</h2>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div id="stage" style={{ display: 'inline-block', padding: 12 }}>
            <Hero ref={stage} fill={fill} level={level} capacity={100} motion={motion} />
          </div>
          <div>
            <button id="levelup" type="button" onClick={levelUp} style={{ font: 'inherit', padding: '10px 16px', borderRadius: 12, border: 0, background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>
              Level up
            </button>
            <div id="stage-info" style={{ ...caption, textAlign: 'left' }}>
              уровень {level} · levels {params.levels ?? 1} · beats {beats}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
