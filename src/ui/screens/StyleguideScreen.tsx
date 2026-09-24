import { useState, type ReactNode } from 'react';
import { dialogs } from '../../platform/dialogs';
import { haptics } from '../../platform/haptics';
import { applyTheme } from '../../platform/theme';
import { ContextSheet } from '../components/ContextSheet';
import { EmptyState } from '../components/EmptyState';
import { ICON_NAMES, Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { Skeleton, type SkeletonLayout } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { useCountUp } from '../hooks/useCountUp';
import { setMotionPreference, useMotion } from '../hooks/useMotion';
import type { IllustrationName } from '../illustrations';

// DEV-only gallery of every component state; the screenshot script captures it from a dev
// server. Copy here is deliberately not in copy.ts: it never ships.

const COLOR_TOKENS = [
  'bg',
  'bg-elevated',
  'bg-sunken',
  'fg',
  'fg-secondary',
  'fg-tertiary',
  'accent',
  'accent-soft',
  'accent-glow',
  'on-accent',
  'link',
  'danger',
  'positive',
  'border',
];
const EXTRA_TOKENS = ['liquid-light', 'liquid-mid', 'liquid-deep', 'gold-1', 'gold-2', 'gold-3', 'bronze-1', 'bronze-2', 'silver-1', 'silver-2'];
const TYPE_CLASSES = ['t-display-xl', 't-display-l', 't-title-l', 't-title-m', 't-title-s', 't-body', 't-body-strong', 't-label', 't-caption'];
const SKELETONS: SkeletonLayout[] = ['home', 'skill', 'today', 'achievements', 'form'];
const ILLUSTRATIONS: IllustrationName[] = ['skills', 'steps', 'history', 'achievements', 'today'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="form">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

function Broken(): never {
  throw new Error('Styleguide: ErrorBoundary demo');
}

export default function StyleguideScreen() {
  const { showToast } = useToast();
  const motion = useMotion();
  const [sheet, setSheet] = useState<'none' | 'auto' | 'full' | 'context'>('none');
  const [segment, setSegment] = useState(0);
  const [count, setCount] = useState(42);
  const [crash, setCrash] = useState(false);
  const [skeletonLoading, setSkeletonLoading] = useState(true);
  const shown = useCountUp(count);
  const [zoom, setZoom] = useState(false);

  function toggleTheme() {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  }

  if (crash) return <Broken />;

  return (
    <Screen title="Styleguide" back="/skills" largeTitle>
      <div data-screen="styleguide" className="form">
        <Section title="Тема и движение">
          <div className="button-row">
            <button type="button" className="button" onClick={toggleTheme}>
              Светлая / тёмная
            </button>
            <button type="button" className="button" onClick={() => applyTheme()}>
              Сброс темы
            </button>
          </div>
          <div className="button-row">
            <button type="button" className={`chip${motion === 'full' ? ' active' : ''}`} onClick={() => setMotionPreference('full')}>
              Движение: полное
            </button>
            <button type="button" className={`chip${motion === 'reduced' ? ' active' : ''}`} onClick={() => setMotionPreference('reduced')}>
              Движение: уменьшенное
            </button>
          </div>
        </Section>

        <Section title="Цвета">
          <div className="sg-swatches">
            {COLOR_TOKENS.map((name) => (
              <div className="sg-swatch" key={name}>
                <span style={{ background: `var(--color-${name})` }} />
                <span>{name}</span>
              </div>
            ))}
            {EXTRA_TOKENS.map((name) => (
              <div className="sg-swatch" key={name}>
                <span style={{ background: `var(--${name})` }} />
                <span>{name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Типографика">
          <button type="button" className="chip" onClick={() => setZoom((z) => !z)}>
            {zoom ? 'Масштаб 130 %' : 'Масштаб 100 %'}
          </button>
          <div className={`card card-padded sg-scale${zoom ? ' sg-zoom' : ''}`}>
            {TYPE_CLASSES.map((cls) => (
              <p key={cls} className={cls}>
                {cls === 't-display-xl' || cls === 't-display-l' ? '1234' : `${cls} — Колба 3 · 42 / 100`}
              </p>
            ))}
          </div>
        </Section>

        <Section title="Кнопки и чипы">
          <button type="button" className="button button-primary button-block pressable" onClick={() => haptics.press()}>
            Основная
          </button>
          <div className="button-row">
            <button type="button" className="button">
              Тональная
            </button>
            <button type="button" className="button button-secondary">
              Вторичная
            </button>
            <button type="button" className="button" disabled>
              Выкл.
            </button>
          </div>
          <button type="button" className="button button-block button-danger" style={{ marginTop: 0 }}>
            Удалить навык
          </button>
          <div className="button-row">
            {['Все', 'Получено', 'Впереди'].map((label, i) => (
              <button key={label} type="button" className={`chip${segment === i ? ' active' : ''}`} onClick={() => setSegment(i)}>
                {label}
              </button>
            ))}
          </div>
          <div className="segmented" role="tablist">
            {['Активные', 'Достигнутые'].map((label, i) => (
              <button key={label} type="button" role="tab" aria-selected={segment === i} className={segment === i ? 'active' : ''} onClick={() => setSegment(i)}>
                {label}
              </button>
            ))}
          </div>
          <span className="badge">веха</span>
        </Section>

        <Section title="Счётчик и полоса">
          <p className="t-display-l">{Math.round(shown)}</p>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={count} aria-label="Демо">
            <div className="bar-fill" style={{ width: `${count}%` }} />
          </div>
          <button type="button" className="button" onClick={() => setCount((c) => (c >= 100 ? 10 : c + 29))}>
            Прибавить
          </button>
        </Section>

        <Section title="Листы и диалоги">
          <div className="button-row">
            <button type="button" className="button" onClick={() => setSheet('auto')}>
              Лист
            </button>
            <button type="button" className="button" onClick={() => setSheet('full')}>
              Лист на всю высоту
            </button>
          </div>
          <div className="button-row">
            <button type="button" className="button" onClick={() => setSheet('context')}>
              Контекстный лист
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                void dialogs.confirm('Завершить навык «Английский»?', { okLabel: 'Завершить' }).then((ok) => showToast(ok ? 'Подтверждено' : 'Отменено'));
              }}
            >
              Подтверждение
            </button>
          </div>
        </Section>

        <Section title="Тосты">
          <div className="button-row">
            <button type="button" className="button" onClick={() => showToast('+5 · Чтение', { icon: 'check' })}>
              Тост
            </button>
            <button
              type="button"
              className="button"
              onClick={() => showToast('+5 · Чтение', { action: { label: 'Отменить', onClick: () => showToast('Отменено', { icon: 'undo' }) } })}
            >
              Тост с действием
            </button>
          </div>
        </Section>

        <Section title="Скелетоны">
          <button type="button" className="chip" onClick={() => setSkeletonLoading((v) => !v)}>
            {skeletonLoading ? 'Показать данные' : 'Показать скелетон'}
          </button>
          {SKELETONS.map((layout) => (
            <div key={layout} className="card card-padded">
              <p className="t-label hint">{layout}</p>
              <Skeleton layout={layout} loading={skeletonLoading}>
                <p className="t-body">Данные загружены</p>
              </Skeleton>
            </div>
          ))}
        </Section>

        <Section title="Пустые состояния">
          {ILLUSTRATIONS.map((name) => (
            <div key={name} className="card">
              <EmptyState illustration={name} title={`Иллюстрация «${name}»`} text="Короткое пояснение в одну-две строки." action={{ label: 'Действие', onClick: () => haptics.tap() }} />
            </div>
          ))}
        </Section>

        <Section title="Иконки">
          <div className="card card-padded sg-icons">
            {ICON_NAMES.map((name) => (
              <div key={name}>
                <Icon name={name} />
                <span>{name}</span>
              </div>
            ))}
            {(['sun', 'flask', 'medal', 'sliders'] as const).map((name) => (
              <div key={`${name}-filled`}>
                <Icon name={name} filled />
                <span>{name} ●</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Вибро-отклик">
          <div className="button-row">
            {(['select', 'tap', 'press', 'success'] as const).map((verb) => (
              <button key={verb} type="button" className="chip" onClick={() => haptics[verb]()}>
                {verb}
              </button>
            ))}
          </div>
          <div className="button-row">
            <button type="button" className="chip" onClick={() => haptics.levelUp(2)}>
              levelUp(2)
            </button>
            <button type="button" className="chip" onClick={() => haptics.milestone()}>
              milestone
            </button>
            <button type="button" className="chip" onClick={() => haptics.warning()}>
              warning
            </button>
            <button type="button" className="chip" onClick={() => haptics.error()}>
              error
            </button>
          </div>
        </Section>

        <Section title="Граница ошибок">
          <button type="button" className="button button-danger" style={{ marginTop: 0 }} onClick={() => setCrash(true)}>
            Сломать экран
          </button>
        </Section>
      </div>

      <Sheet
        open={sheet === 'auto' || sheet === 'full'}
        height={sheet === 'full' ? 'full' : 'auto'}
        title="Заголовок листа"
        onClose={() => setSheet('none')}
        footer={
          <button type="button" className="button button-primary button-block" onClick={() => setSheet('none')}>
            {copy.sheet.close}
          </button>
        }
      >
        <p className="t-body">Лист закрывается свайпом вниз, тапом по фону, кнопкой «Назад» и Escape.</p>
        <label className="field" style={{ marginTop: 12 }}>
          <span className="field-label">Поле в листе</span>
          <input className="input" placeholder="Клавиатура поднимает футер" />
        </label>
        {Array.from({ length: sheet === 'full' ? 30 : 3 }, (_, i) => (
          <p key={i} className="hint" style={{ marginTop: 12 }}>
            Строка {i + 1}
          </p>
        ))}
      </Sheet>

      <ContextSheet
        open={sheet === 'context'}
        title="Английский"
        onClose={() => setSheet('none')}
        items={[
          { icon: 'edit', label: 'Изменить', onSelect: () => showToast('Изменить') },
          { icon: 'archive', label: 'В архив', onSelect: () => showToast('В архив') },
          { icon: 'trash', label: 'Удалить', tone: 'danger', onSelect: () => showToast('Удалить') },
        ]}
      />
    </Screen>
  );
}
