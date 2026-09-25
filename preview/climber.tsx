// Dev-only preview of the «Альпинист» progress theme: `npx vite`, then /preview/climber.html.
// ?dark — dark theme, ?tg=purple — the purple Telegram theme, ?motion=reduced, ?levels=3.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import { plural } from '../src/lib/format';
import type { ProgressHeroHandle, ProgressState } from '../src/ui/progress/contract';
import { climberTheme } from '../src/ui/progress/themes/climber';

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

const { Hero, Mini, text } = climberTheme;
const FILLS = [0, 0.25, 0.5, 0.75, 0.999];
const CASES: { fill: number; state: ProgressState; title: string }[] = [
  ...FILLS.map((fill) => ({ fill, state: (fill === 0 ? 'empty' : 'active') as ProgressState, title: `${Math.floor(fill * 100)}%` })),
  { fill: 1, state: 'complete', title: 'Навык завершён' },
];
const MARKS = [
  { id: 'm1', label: 'Пробный тест', height: 0.2 },
  { id: 'm2', label: 'Длинное название засечки', height: 0.42 },
  { id: 'm3', label: 'Экзамен', height: 0.55 },
];

function Preview() {
  const stage = useRef<ProgressHeroHandle>(null);
  const [status, setStatus] = useState('');
  const [stageFill, setStageFill] = useState(0.9);
  const levels = Number(params.levels ?? 1);
  const play = async () => {
    if (stageFill !== 0.9) {
      setStageFill(0.9);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    setStatus('…');
    await stage.current?.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels, onOverflow: () => setStatus(text.completed(3)) });
    setStageFill(0.2);
    setStatus(`${text.levelNoun} 4 · ещё 80 до ${text.levelGenitive} 5`);
  };
  return (
    <main className="pv">
      <section className="pv-card">
        <h2 className="pv-title">{text.name}</h2>
        <p className="pv-hint">
          {text.hint} · {[1, 2, 5, 11, 21].map((n) => `${n} ${plural(n, text.levelForms)}`).join(', ')}
        </p>
      </section>
      <section className="pv-card">
        <h2 className="pv-title">Уровень: 0 → 100%</h2>
        {CASES.map((c) => (
          <div className="pv-hero" key={c.title}>
            <Hero fill={c.fill} state={c.state} capacity={100} motion={motion} />
            <div>
              <p>{c.title}</p>
              <p className="pv-hint">{c.state === 'complete' ? text.completed(7) : text.fillLabel(Math.floor(c.fill * 100))}</p>
            </div>
          </div>
        ))}
      </section>
      <section className="pv-card">
        <h2 className="pv-title">Мини</h2>
        <div className="pv-minis">
          {CASES.map((c) => (
            <figure key={c.title}>
              <Mini fill={c.fill} state={c.state} size={40} motion={motion} />
              <Mini fill={c.fill} state={c.state} size={28} motion={motion} />
              <figcaption>{c.state === 'complete' ? '✓' : c.title}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section className="pv-card">
        <h2 className="pv-title">Засечки</h2>
        <div className="pv-hero">
          <Hero fill={0.6} capacity={100} motion={motion} marks={MARKS} onMarkTap={(id) => setStatus(`tap ${id}`)} />
          <p className="pv-hint">60%</p>
        </div>
      </section>
      <section className="pv-card">
        <h2 className="pv-title">Новая вершина ({levels})</h2>
        <div className="pv-hero" id="stage">
          <Hero ref={stage} fill={stageFill} capacity={100} motion={motion} />
          <div>
            <p>{text.levelNoun} 4</p>
            <p className="pv-hint" id="status">
              {status}
            </p>
          </div>
        </div>
        <button type="button" className="pv-play" id="levelup" onClick={play}>
          Сыграть подъём
        </button>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
