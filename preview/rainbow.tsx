// Dev-only preview of the «Радуга» progress theme (not part of the production build).
// URL params: ?dark, ?tg=purple, ?motion=reduced, ?levels=N for the level-up button.
import { useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import type { ProgressHeroHandle, ProgressState } from '../src/ui/progress/contract';
import { rainbowTheme } from '../src/ui/progress/themes/rainbow';

const params = Object.fromEntries(new URLSearchParams(location.search).entries()) as Record<string, string | undefined>;
const root = document.documentElement;
const purple = params.tg === 'purple';
if ('dark' in params || purple) {
  root.dataset.theme = 'dark';
  root.style.colorScheme = 'dark';
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

const { Hero, Mini } = rainbowTheme;
const FILLS = [0, 0.25, 0.5, 0.75, 0.999];
const CASES: { fill: number; state: ProgressState; title: string }[] = [
  ...FILLS.map((fill) => ({ fill, state: (fill === 0 ? 'empty' : 'active') as ProgressState, title: `${Math.round(fill * 1000) / 10}%` })),
  { fill: 1, state: 'complete', title: 'complete' },
];
const MARKS = [
  { id: 'a', label: 'Пробный тест', height: 0.2 },
  { id: 'b', label: 'Длинное название засечки', height: 0.5 },
  { id: 'c', label: 'Экзамен', height: 0.85 },
  { id: 'd', label: 'Финиш', height: 0.97 },
];

const box: CSSProperties = { display: 'flex', gap: 16, alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border)' };
const caption: CSSProperties = { font: '500 14px/1.3 system-ui', color: 'var(--color-fg-secondary)', minWidth: 72 };

function Preview() {
  const stage = useRef<ProgressHeroHandle>(null);
  const [stageFill, setStageFill] = useState(0.9);
  const [tapped, setTapped] = useState('');
  const levels = Number(params.levels ?? 1);

  async function levelUp() {
    await stage.current?.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels, onOverflow: () => console.log('overflow') });
    setStageFill(0.2);
  }

  return (
    <main style={{ background: 'var(--color-bg)', color: 'var(--color-fg)', minHeight: '100vh', paddingBottom: 40 }}>
      <h1 style={{ font: '700 20px/1.2 system-ui', margin: 0, padding: 16 }}>{rainbowTheme.text.name}</h1>
      <p style={{ ...caption, padding: '0 16px' }}>{rainbowTheme.text.hint}</p>

      <section style={{ ...box, flexWrap: 'wrap', background: 'var(--color-bg-elevated)' }}>
        <div id="stage" style={{ display: 'flex', gap: 16, alignItems: 'center', padding: 8 }}>
          <Hero ref={stage} fill={stageFill} capacity={100} motion={motion} />
          <div style={caption}>
            Level up
            <br />
            levels {levels}
          </div>
        </div>
        <button id="levelup" type="button" className="button" onClick={() => void levelUp()} style={{ padding: '10px 14px' }}>
          Level up
        </button>
        <button id="bump" type="button" className="button" onClick={() => setStageFill(0.6)} style={{ padding: '10px 14px' }}>
          60%
        </button>
      </section>

      {CASES.map((c) => (
        <section key={c.title} style={box}>
          <Hero fill={c.fill} state={c.state} capacity={100} motion={motion} />
          <div style={caption}>
            {c.title}
            <br />
            {c.state}
          </div>
        </section>
      ))}

      {/* As on the skill screen (SkillScreen.tsx): the hero with marks next to the numbers column. */}
      <div id="marks" style={{ padding: '0 16px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-elevated)' }}>
        <section className="hero hero--marks">
          <div className="hero-flask">
            <Hero fill={0.6} capacity={100} motion={motion} marks={MARKS} onMarkTap={setTapped} />
          </div>
          <div className="hero-info">
            <span className="hero-eyebrow t-label">{rainbowTheme.text.levelNoun}</span>
            <span className="roll t-display-xl">
              <span>3</span>
            </span>
            <p className="hero-points t-title-m">
              60 <span className="hero-capacity">/ 100</span>
            </p>
            <p className="t-caption hint">60% · ещё&nbsp;40 до&nbsp;{rainbowTheme.text.levelGenitive}&nbsp;4</p>
            <span className="hero-total">Всего 260</span>
            {tapped && <span className="t-caption">{tapped}</span>}
          </div>
        </section>
      </div>

      {[40, 32, 28].map((size) => (
        <section key={size} style={{ ...box, flexWrap: 'wrap' }}>
          {CASES.map((c) => (
            <Mini key={c.title} fill={c.fill} state={c.state} size={size} motion={motion} />
          ))}
          <span style={caption}>{size} px</span>
        </section>
      ))}
      <section style={{ ...box, flexWrap: 'wrap', background: 'var(--color-bg-elevated)' }}>
        {CASES.map((c) => (
          <Mini key={c.title} fill={c.fill} state={c.state} size={32} motion={motion} />
        ))}
        <span style={caption}>card</span>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
