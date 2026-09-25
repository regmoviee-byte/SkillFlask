// Dev-only preview of the book theme: `npx vite` serves it at /preview/book.html.
// URL params: ?dark, ?tg=purple (purple Telegram theme), ?motion=reduced, ?levels=N (levels per
// level-up), ?level=N (the stage's starting level, 4 by default; it moves on with every level-up
// at the overflow beat, as the celebration stage does in the app).
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import type { MotionMode } from '../src/ui/hooks/useMotion';
import type { ProgressHeroHandle, ProgressMark } from '../src/ui/progress/contract';
import { plural } from '../src/lib/format';
import { bookTheme } from '../src/ui/progress/themes/book';

const params = new URLSearchParams(location.search);
const root = document.documentElement;

if (params.get('tg') === 'purple') {
  // What telegram-web-app.js sets on <html> for a purple user theme (scripts/screenshots.mjs).
  const vars: Record<string, string> = {
    '--tg-theme-button-color': '#8774e1',
    '--tg-theme-button-text-color': '#ffffff',
    '--tg-theme-bg-color': '#1e1b2e',
    '--tg-theme-secondary-bg-color': '#151321',
    '--tg-theme-section-bg-color': '#1e1b2e',
    '--tg-theme-text-color': '#f0eefb',
    '--tg-theme-hint-color': '#9b95b8',
    '--tg-theme-link-color': '#a597ff',
    '--tg-safe-area-inset-top': '54px',
    '--tg-content-safe-area-inset-top': '46px',
    '--tg-safe-area-inset-bottom': '34px',
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.dataset.theme = 'dark';
  root.style.colorScheme = 'dark';
} else if (params.has('dark')) {
  root.dataset.theme = 'dark';
  root.style.colorScheme = 'dark';
} else {
  root.dataset.theme = 'light';
  root.style.colorScheme = 'light';
}

const motion: MotionMode = params.get('motion') === 'reduced' ? 'reduced' : 'full';
if (motion === 'reduced') root.dataset.motion = 'reduced';
const levels = Number(params.get('levels') ?? 1);
const startLevel = Number(params.get('level') ?? 4);

const { Hero, Mini, text } = bookTheme;
const FILLS = [0, 0.25, 0.5, 0.75, 0.999];
/** «Полка»: the bookcase at these levels (level − 1 books). */
const SHELF_LEVELS = [1, 2, 6, 14, 30, 70];
const MARKS: ProgressMark[] = [
  { id: 'm1', label: 'Пробный тест', height: 0.18 },
  { id: 'm2', label: 'Длинное название засечки', height: 0.44 },
  { id: 'm3', label: 'Экзамен', height: 0.83 },
];

const styles = `
  body { margin: 0; padding: 16px; font-family: -apple-system, system-ui, sans-serif; color: var(--color-fg); }
  h1 { font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-section-header); margin: 20px 0 8px; }
  .cell { display: flex; align-items: center; gap: 16px; padding: 8px 0; }
  .cell .meta { font-size: 15px; color: var(--color-fg-secondary); }
  .minis { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .minis figure { margin: 0; display: grid; justify-items: center; gap: 4px; font-size: 12px; color: var(--color-fg-secondary); }
  .actions { display: flex; gap: 8px; margin-top: 8px; }
  button.btn { font: inherit; padding: 10px 16px; border: 0; border-radius: 12px; background: var(--color-accent); color: var(--color-on-accent); }
  button.btn.secondary { background: var(--color-accent-soft); color: var(--color-accent); }
  .tapped { font-size: 13px; color: var(--color-fg-secondary); min-height: 18px; }
`;

function Preview() {
  const stage = useRef<ProgressHeroHandle>(null);
  const [stageFill, setStageFill] = useState(0.9);
  const [stageLevel, setStageLevel] = useState(startLevel);
  const [tapped, setTapped] = useState('');
  const [busy, setBusy] = useState(false);

  const levelUp = async () => {
    if (busy) return;
    setBusy(true);
    setStageFill(0.2);
    // As in the app (the celebration stage shows the new progress at the overflow beat).
    await stage.current?.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels, onOverflow: () => setStageLevel((level) => level + levels) });
    setBusy(false);
  };

  return (
    <>
      <style>{styles}</style>
      <h1>{text.name}</h1>
      <p className="meta">{text.hint}</p>

      <h2>Hero</h2>
      {FILLS.map((fill) => (
        <div className="cell" key={fill}>
          <Hero fill={fill} capacity={100} motion={motion} />
          <div className="meta">
            fill {fill}
            <br />
            {text.fillLabel(Math.floor(fill * 100))}
          </div>
        </div>
      ))}
      <div className="cell">
        <Hero fill={1} capacity={100} state="complete" level={30} motion={motion} />
        <div className="meta">complete, {text.levelNoun} 30</div>
      </div>
      <div className="cell">
        <Hero fill={0.45} motion={motion} />
        <div className="meta">
          fill 0.45, no capacity
          <br />
          {text.fillLabel(45)}
        </div>
      </div>

      <section id="shelf">
        <h2>Полка</h2>
        {SHELF_LEVELS.map((level, i) => (
          <div className="cell" key={level}>
            <Hero fill={[0.3, 0.55, 0.2, 0.7, 0.45, 0.85][i]!} capacity={100} level={level} motion={motion} />
            <div className="meta">
              {text.levelNoun} {level}
              <br />
              {level - 1} {plural(level - 1, text.levelForms)} на полке
            </div>
          </div>
        ))}
      </section>

      <h2>Mini</h2>
      <div className="minis">
        {FILLS.map((fill) => (
          <figure key={fill}>
            <Mini fill={fill} motion={motion} />
            <figcaption>{fill}</figcaption>
          </figure>
        ))}
        <figure>
          <Mini fill={1} state="complete" motion={motion} />
          <figcaption>complete</figcaption>
        </figure>
        <figure>
          <Mini fill={0.4} size={28} motion={motion} />
          <figcaption>28px</figcaption>
        </figure>
      </div>

      <h2>Marks</h2>
      <div className="cell">
        <Hero fill={0.6} capacity={100} motion={motion} marks={MARKS} onMarkTap={(id) => setTapped(`tapped ${id}`)} />
        <div className="meta">
          fill 0.6, 3 marks
          <div className="tapped">{tapped}</div>
        </div>
      </div>

      <h2>Level up ({levels})</h2>
      <div className="cell">
        <div id="stage">
          <Hero ref={stage} fill={stageFill} capacity={100} level={stageLevel} motion={motion} />
        </div>
        <div className="meta">
          {text.levelNoun} {stageLevel}, 0.9 → 0.2
          <div className="actions">
            <button id="levelup" type="button" className="btn" onClick={levelUp}>
              Level up
            </button>
            <button id="reset" type="button" className="btn secondary" onClick={() => setStageFill(0.9)}>
              Reset
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
