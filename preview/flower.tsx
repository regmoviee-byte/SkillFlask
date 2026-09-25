// Dev-only preview of the flower theme: `npx vite` then /preview/flower.html.
// Params: ?dark, ?tg=purple (the purple Telegram theme), ?motion=reduced, ?levels=N for the
// «Level up» button. Not part of the production build.
import { StrictMode, memo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import type { ProgressHeroHandle, ProgressMark } from '../src/ui/progress/contract';
import { SPECIES, flowerTheme } from '../src/ui/progress/themes/flower';
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

const { Hero, Mini, text } = flowerTheme;
const FILLS = [0, 0.25, 0.5, 0.75, 0.999];
const GARDENS = [1, 2, 6, 14, 30, 70];
const CAPACITY = 100;
const MARKS: ProgressMark[] = [
  { id: 'a', label: 'Пробный тест', height: 0.2 },
  { id: 'b', label: 'Длинное название засечки', height: 0.45 },
  { id: 'c', label: 'Экзамен', height: 0.52 },
];
const LOW_MARKS: ProgressMark[] = [
  { id: 'd', label: 'Старт', height: 0.02 },
  { id: 'e', label: 'Первая глава', height: 0.08 },
  { id: 'f', label: 'Повтор', height: 0.7 },
];

/** The stage: its own state, so a status change does not re-render the other heroes mid-choreography. */
function Stage() {
  const stage = useRef<ProgressHeroHandle>(null);
  const [status, setStatus] = useState('готов');
  // The app renders the new level with the new fill first, then plays the level-up (README
  // rule 2); the hero shows the completed flower until the choreography lands on those props.
  const [stageLevel, setStageLevel] = useState(4);
  const [stageFill, setStageFill] = useState(0.9);
  const play = async () => {
    setStatus('идёт');
    const fromFill = stageFill;
    flushSync(() => {
      setStageLevel((l) => l + levels);
      setStageFill(0.2);
    });
    await stage.current?.playLevelUp({ fromFill, toFill: 0.2, levels, onOverflow: () => setStatus('распустился') });
    setStatus('готов');
  };
  return (
    <section className="pv-card">
      <h2 className="pv-title">
        Level up · {levels} {levels === 1 ? 'уровень' : 'уровня'}
      </h2>
      <div className="pv-hero">
        <div id="stage">
          <Hero ref={stage} fill={stageFill} level={stageLevel} capacity={CAPACITY} motion={motion} />
        </div>
        <div>
          <p>
            {text.levelNoun} {stageLevel}
          </p>
          <p className="hint">{status}</p>
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

function Marks() {
  const [tapped, setTapped] = useState<string | null>(null);
  return (
    <section className="pv-card">
      <h2 className="pv-title">Засечки</h2>
      <div className="pv-hero">
        <Hero fill={0.6} level={3} capacity={CAPACITY} motion={motion} marks={MARKS} onMarkTap={setTapped} />
        <div>
          <p>{text.levelNoun} 3</p>
          <p className="hint">{tapped ? `нажата: ${tapped}` : 'три засечки'}</p>
        </div>
      </div>
      <div className="pv-hero">
        <Hero fill={0.8} level={30} capacity={CAPACITY} motion={motion} marks={LOW_MARKS} onMarkTap={setTapped} />
        <div>
          <p>{text.levelNoun} 30</p>
          <p className="hint">низкие засечки над садом</p>
        </div>
      </div>
    </section>
  );
}

const Gallery = memo(function Gallery() {
  return (
    <>
      <section className="pv-card" id="species">
        <h2 className="pv-title">Виды · уровни 1–{SPECIES.length}</h2>
        <div className="pv-species">
          {SPECIES.map((sp, i) => (
            <figure key={sp.key}>
              <div className="pv-zoom">
                <Hero fill={1} level={i + 1} motion={motion} />
              </div>
              <figcaption>
                {i + 1} · {sp.name}
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="pv-minis" id="species-minis">
          {SPECIES.map((sp, i) => (
            <figure key={sp.key}>
              <Mini fill={1} level={i + 1} motion={motion} size={40} />
              <Mini fill={1} level={i + 1} motion={motion} size={28} />
              <Mini fill={0.6} level={i + 1} motion={motion} size={28} />
            </figure>
          ))}
        </div>
      </section>

      <section className="pv-card" id="garden">
        <h2 className="pv-title">Сад</h2>
        <div className="pv-garden">
          {GARDENS.map((level) => (
            <figure key={level}>
              <Hero fill={0.5} level={level} capacity={CAPACITY} motion={motion} />
              <figcaption>
                {text.levelNoun} {level}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <Marks />

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
            <Mini fill={0.5} motion={motion} size={28} />
            <figcaption>28 px</figcaption>
          </figure>
        </div>
      </section>

      <section className="pv-card pv-heroes">
        <h2 className="pv-title">Стадии</h2>
        {FILLS.map((f) => (
          <div key={f} className="pv-hero">
            <Hero fill={f} capacity={CAPACITY} motion={motion} state={f === 0 ? 'empty' : 'active'} />
            <div>
              <p>{text.levelNoun} 1</p>
              <p className="hint">{text.fillLabel(Math.round(f * 100))}</p>
            </div>
          </div>
        ))}
        <div className="pv-hero">
          <Hero fill={1} level={12} capacity={CAPACITY} motion={motion} state="complete" />
          <div>
            <p>{text.completed(12)}</p>
            <p className="hint">{text.hint}</p>
          </div>
        </div>
      </section>
    </>
  );
});

function Preview() {
  return (
    <div className="pv">
      <Stage />
      <Gallery />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
