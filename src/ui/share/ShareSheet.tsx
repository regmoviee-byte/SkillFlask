import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Skill } from '../../domain/types';
import { tgAppLink } from '../../platform/deeplink';
import { haptics } from '../../platform/haptics';
import { logError } from '../../platform/errorLog';
import { isTelegram } from '../../platform/telegram';
import { getShareCardData } from '../../services/shareCard';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { ProgressHero } from '../progress/ProgressHero';
import { colorScope } from '../progress/registry';
import { cardModel, type CardModel } from './cardLayout';
import { makeShareCard, stageTokens, type CardStyle } from './renderCard';
import { appShareLink, downloadImage, sendLink, shareEnv, shareImage, sharePlan, type ImageWay } from './sharePath';
import { shareCopy as t } from './strings';
import './share.css';

// «Поделиться прогрессом» (v0.5 package 19, a lazy chunk): the skill's card as a picture, made
// when the sheet opens, and the ways to send it that this platform really has (sharePath.ts).
// The card is prepared first and every way out is a tap of its own, so Web Share and the
// clipboard run inside a fresh gesture (iOS refuses them once an asynchronous render has used
// the gesture up); the same reason keeps the buttons in the sheet rather than Telegram's
// MainButton, whose press is no gesture of the page. The theme's hero is drawn off screen on a
// stage painted in the card's style and the skill's colour, then copied into the picture.

export interface ShareSheetProps {
  skill: Skill;
  open: boolean;
  /** Local date of the screen (useToday): «за последние 30 дней» ends on it. */
  today: string;
  onClose(): void;
}

type Card =
  | { kind: 'preparing' }
  /** `fallback`: the flask stood in for a theme that could not be drawn. */
  | { kind: 'ready'; url: string; file: File; model: CardModel; fallback: boolean }
  | { kind: 'failed'; model: CardModel | null };

/** The line under the picture where no button saves it. */
const HINTS: Partial<Record<ImageWay, string>> = { hold: t.holdHint, rightClick: t.rightClickHint, screenshot: t.screenshotHint };

/** The app's appearance as the card follows it: dark when the page is dark. */
function currentStyle(): CardStyle {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export default function ShareSheet({ skill, open, today, onClose }: ShareSheetProps) {
  const [card, setCard] = useState<Card>({ kind: 'preparing' });
  // The model on the stage while its picture is taken; null otherwise (nothing off screen).
  const [staged, setStaged] = useState<{ model: CardModel; style: CardStyle; fileName: string } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const run = useRef(0);
  const [shareBroken, setShareBroken] = useState(false);
  const [linkShown, setLinkShown] = useState(false);
  const linkField = useRef<HTMLTextAreaElement>(null);
  // A way out is under way (the system sheet is open) or has closed the sheet: a second tap
  // would open another share, fail on the open one and offer «сохраните картинку» over it.
  const busy = useRef(false);
  const closeRef = useRef<() => void>(() => {});
  const { showToast } = useToast();

  // Every opening makes a fresh card: the progress may have moved since the last one.
  useEffect(() => {
    if (!open) return;
    const id = ++run.current;
    setCard({ kind: 'preparing' });
    setShareBroken(false);
    setLinkShown(false);
    busy.current = false;
    getShareCardData(skill.id, today)
      .then((data) => {
        if (id !== run.current) return;
        if (!data) throw new Error('The skill is gone');
        setStaged({ model: cardModel(data, tgAppLink()), style: currentStyle(), fileName: t.fileName(today) });
      })
      .catch((error: unknown) => {
        if (id !== run.current) return;
        logError(error, 'share card data');
        setCard({ kind: 'failed', model: null });
      });
    return () => {
      run.current += 1;
      setStaged(null);
    };
    // Only on opening: a live change of the skill does not redraw a card on screen.
  }, [open]);

  // The stage is on the page: its picture, then the card.
  useEffect(() => {
    const stage = stageRef.current;
    if (!staged || !stage) return;
    const id = run.current;
    makeShareCard(staged.model, stage, staged.style)
      .then(({ blob, fallback }) => {
        if (id !== run.current) return;
        const file = new File([blob], staged.fileName, { type: 'image/png' });
        setCard({ kind: 'ready', url: URL.createObjectURL(blob), file, model: staged.model, fallback });
      })
      .catch((error: unknown) => {
        if (id !== run.current) return;
        logError(error, 'share card');
        setCard({ kind: 'failed', model: staged.model });
      })
      .finally(() => {
        if (id === run.current) setStaged(null);
      });
  }, [staged]);

  // The link on screen, selected for the system's own «Скопировать».
  useEffect(() => {
    if (!linkShown) return;
    linkField.current?.focus();
    linkField.current?.select();
  }, [linkShown]);

  // A picture's blob URL lives as long as the picture is shown.
  const url = card.kind === 'ready' ? card.url : null;
  useEffect(() => (url ? () => URL.revokeObjectURL(url) : undefined), [url]);

  const file = card.kind === 'ready' ? card.file : null;
  const plan = useMemo(() => {
    const env = shareEnv(file);
    return sharePlan(shareBroken ? { ...env, canShareFiles: false } : env);
  }, [file, shareBroken]);
  const model = card.kind === 'preparing' ? null : card.model;
  const link = appShareLink(skill.id, isTelegram());

  /** Runs one way out at a time; one that closes the sheet keeps the others shut until it reopens. */
  async function once(work: () => Promise<'close' | 'stay'>) {
    if (busy.current) return;
    busy.current = true;
    let closing = false;
    try {
      closing = (await work()) === 'close';
    } finally {
      if (!closing) busy.current = false;
    }
  }

  function onShareImage() {
    if (card.kind !== 'ready') return;
    const { file, model: shown } = card;
    void once(async () => {
      const outcome = await shareImage(file, shown.message);
      if (outcome === 'shared') {
        haptics.success();
        closeRef.current();
        return 'close';
      }
      if (outcome === 'failed') {
        haptics.error();
        setShareBroken(true);
        showToast(t.shareFailed);
      }
      return 'stay';
    });
  }

  function onSaveImage() {
    if (card.kind !== 'ready') return;
    downloadImage(card.url, card.file.name);
    haptics.success();
  }

  function onSendLink() {
    // Without a card (its data did not load) the link goes alone.
    const message = model?.message ?? '';
    const way = plan.link;
    void once(async () => {
      let outcome = await sendLink(way, link, message);
      // A refused way falls back to the clipboard, and that to the link on screen.
      if (outcome === 'failed' && way !== 'copy') outcome = await sendLink('copy', link, message);
      if (outcome === 'opened' || outcome === 'shared') {
        haptics.success();
        closeRef.current();
        return 'close';
      }
      if (outcome === 'copied') {
        haptics.success();
        showToast(copy.skill.linkCopied, { icon: 'link' });
      } else if (outcome === 'failed') setLinkShown(true);
      return 'stay';
    });
  }

  const linkLabel = plan.link === 'telegram' ? t.sendLink : plan.link === 'share' ? t.shareLink : t.copyLink;
  const imageButton =
    card.kind === 'ready' && plan.image === 'share' ? (
      <button type="button" className="button button-primary button-block" onClick={onShareImage}>
        <Icon name="share" size={20} />
        {t.shareImage}
      </button>
    ) : card.kind === 'ready' && plan.image === 'download' ? (
      <button type="button" className="button button-primary button-block" onClick={onSaveImage}>
        <Icon name="download" size={20} />
        {t.saveImage}
      </button>
    ) : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      closeRef={closeRef}
      title={t.title}
      className="share-sheet"
      footer={
        <>
          {imageButton}
          <button
            type="button"
            className={`button button-block${imageButton ? '' : ' button-primary'}`}
            disabled={card.kind === 'preparing'}
            onClick={onSendLink}
          >
            <Icon name="link" size={20} />
            {linkLabel}
          </button>
        </>
      }
    >
      <div className={`share-card-frame${card.kind === 'ready' ? '' : ' is-empty'}`} aria-busy={card.kind === 'preparing'}>
        {card.kind === 'ready' ? (
          <img
            className="share-card-image"
            src={card.url}
            alt={t.imageLabel(card.model.name)}
            width={1080}
            height={1350}
            // Which picture the card has, for the walkthrough and a bug report.
            data-art={card.fallback ? 'flask' : 'theme'}
          />
        ) : (
          <p className="share-card-note hint" aria-live="polite">
            {card.kind === 'preparing' ? t.preparing : t.failed}
          </p>
        )}
      </div>
      {card.kind === 'ready' && plan.image in HINTS && <p className="share-hint hint">{HINTS[plan.image]}</p>}
      {linkShown && (
        <textarea
          className="input share-link-field"
          readOnly
          rows={2}
          value={link}
          aria-label={t.linkField}
          spellCheck={false}
          ref={linkField}
        />
      )}
      {staged &&
        createPortal(
          <div ref={stageRef} className="share-stage" aria-hidden="true" {...colorScope(staged.model.color)} style={stageTokens(staged.style) as CSSProperties}>
            <ProgressHero
              theme={staged.model.theme}
              fill={staged.model.hero.fill}
              level={staged.model.hero.level}
              state={staged.model.hero.state}
              capacity={staged.model.hero.capacity}
              motion="reduced"
              marks={[]}
            />
          </div>,
          document.body,
        )}
    </Sheet>
  );
}
