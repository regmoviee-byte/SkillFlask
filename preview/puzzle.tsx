// Dev-only preview of the puzzle theme: `npx vite` serves it at /preview/puzzle.html.
// URL params: ?dark, ?tg=purple (purple Telegram theme), ?motion=reduced, ?levels=N, ?solo (only
// the level-up stage, to time the choreography without thirty other heroes re-rendering).
// «Картинки» shows the twenty pictures (one per level); the stage starts at level 1 and moves
// on by `levels` at each level-up's beat, as the skill screen does.
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import type { MotionMode } from '../src/ui/hooks/useMotion';
import type { ProgressHeroHandle, ProgressMark } from '../src/ui/progress/contract';
import { puzzleTheme } from '../src/ui/progress/themes/puzzle';
import { PICTURE_COUNT, PICTURES } from '../src/ui/progress/themes/puzzle-pictures';

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
const solo = params.has('solo');

const { Hero, Mini, text } = puzzleTheme;
const FILLS = [0, 0.25, 0.5, 0.75, 0.999];
const LEVELS = Array.from({ length: PICTURE_COUNT }, (_, i) => i + 1);
const HALF_LEVELS = [2, 7, 10, 17];
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
  .pictures { display: grid; grid-template-columns: repeat(auto-fill, 140px); justify-content: space-around; gap: 4px 16px; }
  .pictures figure { margin: 0 0 8px; display: grid; justify-items: center; align-content: start; font-size: 12px; color: var(--color-fg-secondary); }
`;

function Preview() {
  const stage = useRef<ProgressHeroHandle>(null);
  const [stageFill, setStageFill] = useState(0.9);
  const [stageLevel, setStageLevel] = useState(1);
  const [tapped, setTapped] = useState('');
  const [busy, setBusy] = useState(false);

  const levelUp = async () => {
    if (busy) return;
    setBusy(true);
    // The skill screen shows the new snapshot at the beat; so does the preview.
    const onOverflow = () => {
      setStageFill(0.2);
      setStageLevel((l) => l + levels);
    };
    const started = performance.now();
    await stage.current?.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels, onOverflow });
    // How long the choreography took, for the shots script's budget check.
    document.getElementById('stage')!.dataset.playedMs = String(Math.round(performance.now() - started));
    setBusy(false);
  };

  const levelUpSection = (
    <>
      <h2>Level up ({levels})</h2>
      <div className="cell">
        <div id="stage">
          <Hero ref={stage} fill={stageFill} level={stageLevel} capacity={100} motion={motion} />
        </div>
        <div className="meta">
          <span id="stage-level">level {stageLevel}</span>
          <br />
          0.9 → 0.2
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

  if (solo)
    return (
      <>
        <style>{styles}</style>
        {levelUpSection}
      </>
    );

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
        <Hero fill={1} capacity={100} state="complete" motion={motion} />
        <div className="meta">complete</div>
      </div>

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
      <div className="minis" id="minis-levels">
        {[2, 4, 6, 9, 10, 14, 17, 18].map((level) => (
          <figure key={level}>
            <Mini fill={level % 3 ? 0.75 : 1} level={level} size={40} motion={motion} />
            <figcaption>{level}</figcaption>
          </figure>
        ))}
      </div>

      <h2>Картинки</h2>
      <div className="pictures" id="pictures">
        {LEVELS.map((level) => (
          <figure key={level} id={`pic-${level}`}>
            <Hero fill={1} level={level} capacity={100} motion={motion} />
            <figcaption>
              {level}. {PICTURES[level - 1]!.name}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="pictures" id="pictures-half">
        {HALF_LEVELS.map((level) => (
          <figure key={level} id={`half-${level}`}>
            <Hero fill={0.5} level={level} capacity={100} motion={motion} />
            <figcaption>{level}, fill 0.5</figcaption>
          </figure>
        ))}
      </div>

      <h2>Marks</h2>
      <div className="cell">
        <Hero fill={0.6} capacity={100} motion={motion} marks={MARKS} onMarkTap={(id) => setTapped(`tapped ${id}`)} />
        <div className="meta">
          fill 0.6, 3 marks
          <div className="tapped">{tapped}</div>
        </div>
      </div>

      {levelUpSection}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
