// Dev-only preview of the «Башня» progress theme: /preview/tower.html
// ?dark · ?tg=purple · ?motion=reduced · ?levels=3
// The stage starts at level 5 and every level-up adds a tower to the city behind it.
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import type { ProgressHeroHandle, ProgressMark, ProgressState } from '../src/ui/progress/contract';
import { towerTheme } from '../src/ui/progress/themes/tower';
import { plural } from '../src/lib/format';

const params = Object.fromEntries(new URLSearchParams(location.search));
const root = document.documentElement;
const purple = params.tg === 'purple';
const dark = 'dark' in params || purple;
root.dataset.theme = dark ? 'dark' : 'light';
root.style.colorScheme = dark ? 'dark' : 'light';
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

const { Hero, Mini, text } = towerTheme;
const CAPACITY = 100;
const LEVEL = 3;

const FILLS: { fill: number; state: ProgressState; name: string }[] = [
  { fill: 0, state: 'empty', name: '0%' },
  { fill: 0.25, state: 'active', name: '25%' },
  { fill: 0.5, state: 'active', name: '50%' },
  { fill: 0.75, state: 'active', name: '75%' },
  { fill: 0.999, state: 'active', name: '99,9%' },
  { fill: 1, state: 'complete', name: 'готово' },
];

const MARKS: ProgressMark[] = [
  { id: 'm1', label: 'Пробный тест', height: 0.22 },
  { id: 'm2', label: 'Длинное название засечки', height: 0.48 },
  { id: 'm3', label: 'Экзамен', height: 0.85 },
];

/** Heroes of the «Город» section: the skyline of `level − 1` finished towers. */
const CITY: { level: number; fill: number }[] = [
  { level: 1, fill: 0.5 },
  { level: 3, fill: 0.35 },
  { level: 7, fill: 0.3 },
  { level: 15, fill: 0.6 },
  { level: 40, fill: 0.25 },
];

function Numbers({ fill, state, level = LEVEL }: { fill: number; state: ProgressState; level?: number }) {
  const points = Math.floor(fill * CAPACITY);
  return (
    <div>
      <p>
        {text.levelNoun} {level}
      </p>
      <div className="hint">{state === 'complete' ? text.completed(level) : `${points} из ${CAPACITY} · ещё ${CAPACITY - points} до ${text.levelGenitive} ${level + 1}`}</div>
    </div>
  );
}

/** The stage starts at level 5 (four towers in the city); every level-up adds `levels` more. */
function Stage() {
  const ref = useRef<ProgressHeroHandle>(null);
  const [fill, setFill] = useState(0.9);
  const [level, setLevel] = useState(5);
  const [beats, setBeats] = useState(0);
  const levels = Number(params.levels ?? 1);
  const play = async () => {
    await ref.current?.playLevelUp({ fromFill: 0.9, toFill: 0.2, levels, onOverflow: () => setBeats((b) => b + 1) });
    setFill(0.2);
    setLevel((l) => l + levels);
  };
  return (
    <section className="pv-card">
      <h2 className="pv-title">Level up · {levels}</h2>
      <div className="pv-hero">
        <div id="stage">
          <Hero ref={ref} fill={fill} capacity={CAPACITY} level={level} motion={motion} />
        </div>
        <div>
          <Numbers fill={fill} state="active" level={level} />
          <button id="levelup" type="button" className="pv-play" onClick={play}>
            Level up
          </button>
          <div className="hint">
            {beats ? `${text.completed(level - 1)} · ${beats} ${plural(beats, ['раз', 'раза', 'раз'])}` : text.hint}
          </div>
        </div>
      </div>
    </section>
  );
}

function Preview() {
  const [tapped, setTapped] = useState<string | null>(null);
  return (
    <main className="pv">
      <Stage />
      <section className="pv-card">
        <h2 className="pv-title">Hero</h2>
        {FILLS.map(({ fill, state, name }) => (
          <div className="pv-hero" key={name}>
            <Hero fill={fill} state={state} capacity={CAPACITY} level={LEVEL} motion={motion} />
            <div>
              <Numbers fill={fill} state={state} />
              <div className="hint">{name}</div>
            </div>
          </div>
        ))}
      </section>
      <section className="pv-card" id="city">
        <h2 className="pv-title">Город</h2>
        {CITY.map(({ level, fill }) => (
          <div className="pv-hero" key={level}>
            <Hero fill={fill} capacity={CAPACITY} level={level} motion={motion} />
            <div>
              <Numbers fill={fill} state="active" level={level} />
              <div className="hint">{level > 1 ? `${level - 1} ${plural(level - 1, text.levelForms)} в городе` : 'Город ещё впереди'}</div>
            </div>
          </div>
        ))}
      </section>
      <section className="pv-card">
        <h2 className="pv-title">Mini</h2>
        {[28, 32, 40].map((size) => (
          <div className="pv-minis" key={size}>
            {FILLS.map(({ fill, state, name }) => (
              <figure key={name}>
                <Mini fill={fill} state={state} size={size} motion={motion} />
                {size === 40 && <figcaption>{name}</figcaption>}
              </figure>
            ))}
          </div>
        ))}
      </section>
      <section className="pv-card">
        <h2 className="pv-title">Marks</h2>
        <div className="pv-hero">
          <Hero fill={0.6} capacity={CAPACITY} level={LEVEL} marks={MARKS} motion={motion} onMarkTap={setTapped} />
          <div>
            <Numbers fill={0.6} state="active" />
            <div className="hint">{tapped ? MARKS.find((m) => m.id === tapped)?.label : '3 засечки'}</div>
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
