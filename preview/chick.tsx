// Dev-only preview of the chick theme: `npx vite` then /preview/chick.html.
// Params: ?dark, ?tg=purple (the purple Telegram theme), ?motion=reduced, ?levels=N for the
// «Level up» button, ?level=N for the stage's first level (4 by default). Not part of the
// production build.
import { StrictMode, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import type { ProgressHeroHandle, ProgressMark } from '../src/ui/progress/contract';
import { chickTheme } from '../src/ui/progress/themes/chick';
import type { MotionMode } from '../src/ui/hooks/useMotion';

const params = new URLSearchParams(location.search);
const root = document.documentElement;
const purple = params.get('tg') === 'purple';
const dark = params.has('dark') || purple;
root.dataset.theme = dark ? 'dark' : 'light';
root.style.colorScheme = dark ? 'dark' : 'light';
if (purple) {
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
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}
const motion: MotionMode = params.get('motion') === 'reduced' ? 'reduced' : 'full';
if (motion === 'reduced') root.dataset.motion = 'reduced';
const levels = Number(params.get('levels') ?? 1);
const startLevel = Number(params.get('level') ?? 4);

const { Hero, Mini, text } = chickTheme;
const FILLS = [0, 0.25, 0.5, 0.75, 0.999];
const CAPACITY = 100;
/** The «Двор» section: the yard of `level − 1` raised hens. */
const YARD_LEVELS = [1, 2, 5, 12, 30, 60];
const STAGE_LEVEL = 4;
const hensOf = (n: number) => {
  const form = n % 10 === 1 && n % 100 !== 11 ? 'курица' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'курицы' : 'кур';
  return `${n} ${form}`;
};

const MARKS: ProgressMark[] = [
  { id: 'a', label: 'Пробный тест', height: 0.2 },
  { id: 'b', label: 'Длинное название засечки', height: 0.45 },
  { id: 'c', label: 'Экзамен', height: 0.58 },
];

/** The stage: its own state, so a level-up re-renders this hero only (as on the skill screen). */
function Stage() {
  const stage = useRef<ProgressHeroHandle>(null);
  const [status, setStatus] = useState('готов');
  // The app renders the new level together with the new fill, then plays the level-up; the hero
  // shows the flock as it was while it plays and lands on the new props.
  const [stageFill, setStageFill] = useState(0.9);
  const [stageLevel, setStageLevel] = useState(startLevel);
  const play = async () => {
    flushSync(() => {
      setStatus('идёт');
      setStageFill(0.2);
      setStageLevel((l) => l + levels);
    });
    await stage.current?.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels, onOverflow: () => setStatus('вырос') });
    setStatus('готов');
  };
  return (
    <section className="pv-card">
      <h2 className="pv-title">
        Level up · {levels} {levels === 1 ? 'уровень' : 'уровня'}
      </h2>
      <div className="pv-hero">
        <div id="stage">
          <Hero ref={stage} fill={stageFill} capacity={CAPACITY} level={stageLevel} motion={motion} />
        </div>
        <div>
          <p>
            {text.levelNoun} {stageLevel}
          </p>
          <p className="hint">
            {status} · во дворе {hensOf(stageLevel - 1)}
          </p>
          <p>
            <button type="button" id="levelup" className="pv-play" onClick={play}>
              Level up
            </button>
          </p>
        </div>
      </div>
    </section>
  );
}

function Preview() {
  const [tapped, setTapped] = useState<string | null>(null);
  return (
    <div className="pv">
      <Stage />

      <section className="pv-card" id="yard">
        <h2 className="pv-title">Двор</h2>
        <div className="pv-yard">
          {YARD_LEVELS.map((level) => (
            <figure key={level}>
              <Hero fill={0.5} capacity={CAPACITY} level={level} motion={motion} />
              <figcaption>
                {text.levelNoun} {level} · {hensOf(level - 1)}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="pv-card">
        <h2 className="pv-title">Засечки</h2>
        <div className="pv-hero">
          <Hero fill={0.6} capacity={CAPACITY} level={9} motion={motion} marks={MARKS} onMarkTap={setTapped} />
          <div>
            <p>{text.levelNoun} 9</p>
            <p className="hint">{tapped ? `нажата: ${tapped}` : 'три засечки'}</p>
          </div>
        </div>
      </section>

      <section className="pv-card">
        <h2 className="pv-title">Мини</h2>
        <div className="pv-minis">
          {FILLS.map((f) => (
            <figure key={f}>
              <Mini fill={f} motion={motion} size={32} />
              <figcaption>{Math.round(f * 100)}%</figcaption>
            </figure>
          ))}
          <figure>
            <Mini fill={1} state="complete" motion={motion} size={32} />
            <figcaption>gold</figcaption>
          </figure>
          <figure>
            <Mini fill={0.8} motion={motion} size={28} />
            <figcaption>28 px</figcaption>
          </figure>
        </div>
      </section>

      <section className="pv-card pv-heroes">
        <h2 className="pv-title">Стадии</h2>
        {FILLS.map((f) => (
          <div key={f} className="pv-hero">
            <Hero fill={f} capacity={CAPACITY} level={STAGE_LEVEL} motion={motion} state={f === 0 ? 'empty' : 'active'} />
            <div>
              <p>
                {text.levelNoun} {STAGE_LEVEL}
              </p>
              <p className="hint">{text.fillLabel(Math.round(f * 100))}</p>
            </div>
          </div>
        ))}
        <div className="pv-hero">
          <Hero fill={1} capacity={CAPACITY} level={STAGE_LEVEL} motion={motion} state="complete" />
          <div>
            <p>{text.completed(3)}</p>
            <p className="hint">{text.hint}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
