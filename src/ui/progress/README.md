# Progress themes («образы прогресса»)

A theme draws one level of a skill filling up and the beat of completing it. It never touches
points, levels, milestones, achievements or history — those come from the journal. Thirteen
keys exist (`contract.ts`); the flask is the default and the reference implementation
(`src/ui/components/Flask.tsx`, moved behind this contract in package 11).

## Files

- `contract.ts` — the interfaces every theme implements.
- `themes/<key>.tsx` — one file per theme exporting `const <key>Theme: ProgressThemeDefinition`
  (plus `themes/<key>.css` when the theme needs CSS, and `themes/<key>.test.ts` for its pure
  helpers). Nothing else in the app is touched by a theme.
- `registry.ts` (package 11) — maps keys to definitions and to the picker.
- `preview/<key>.html` + `preview/<key>.tsx` at the repo root — a dev-only page that renders the
  hero at 0 / 25 / 50 / 75 / 100 % and the complete state, a row of minis, a mark, and a button
  that plays a level-up (`?levels=2` for a multi-level one, `?dark` for the dark theme,
  `?tg=purple` for the purple Telegram theme, `?motion=reduced`). `npx vite` serves it at
  `/preview/<key>.html`; it is not part of the production build.

## Rules

1. **Box.** The hero renders into `viewBox="0 0 160 260"` (portrait, 140 px wide on the skill
   screen, numbers to its right). Wide scenes fold into the box: a road switchbacks upward, a
   ball flies up to a hoop at the top. The mini is a square, `size` px, legible at 28 px.
2. **Fill.** `fill` 0..1 is the whole story: 0 is the start of the level, 1 the beat of
   completion. Stages (a chick hatching, puzzle pieces, tower blocks) derive from `fill` through
   a pure exported function with unit tests at 0, 0.25, 0.5, 0.75, 0.999, 1.
3. **Colour.** The progressing element uses `--liquid-light`, `--liquid-mid`, `--liquid-deep`
   (they follow the Telegram accent and the per-skill colour). Everything else uses tokens:
   `--color-fg`, `--color-fg-secondary`, `--color-bg-elevated`, `--color-bg-sunken`,
   `--color-border`, `--gold-1..3` for `state === 'complete'`. No hard-coded colours except
   through `color-mix()` of tokens, so light, dark and any Telegram theme stay legible.
4. **Motion.** Animate only `transform`, `opacity` and `stroke-dashoffset`. Idle motion is
   optional, one element at most, class `anim-decor` (stops under `html.paused` and reduced
   motion). Level-up ≤ 1.2 s per level; `levels > 1` compresses into at most three cycles then
   jumps to `toFill` (reuse the state machine in `src/ui/components/flaskAnimation.ts` when it
   fits: rising → overflow (the beat, `onOverflow`) → draining (reset) → refilling). Use WAAPI
   through a guarded `element.animate` (see `Flask.tsx`: fallback easing, `finished` may never
   settle in old WebViews — race it with a timer). `motion === 'reduced'`: crossfade to the new
   fill in ≤ 240 ms, no choreography, `onOverflow` still called once.
5. **Marks.** `markPoint(height)` is monotonic along the level's path. Draw each mark as a small
   pennant on the path with a caption (≤ 12 characters, then «…»), at most four captions, tap
   target ≥ 44 px where captions are apart; `onMarkTap(id)` on tap. Marks are static.
6. **Text.** All strings Russian, tone rules of `docs/proposals/v0.3-improvements.md` (appendix Б):
   no guilt, no exclamation marks, never «баллы». Level phrases must read naturally:
   «Пицца 3 съедена», «ещё 5 до пиццы 4», «из 3 пицц».
7. **Cost.** One theme file ≤ ~12 KB gzip; no new dependencies; no raster images; SVG only.
8. **Accessibility.** The hero has `role="img"` and an `aria-label` from `text.fillLabel`;
   captions and marks are buttons with Russian labels.
