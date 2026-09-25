# Progress themes («образы прогресса»)

A theme draws one level of a skill filling up and the beat of completing it. It never touches
points, levels, milestones, achievements or history — those come from the journal. Thirteen
keys exist (`contract.ts`); the flask is the default and the reference implementation
(`themes/flask.tsx`, moved behind this contract in package 11).

## Files

- `contract.ts` — the interfaces every theme implements.
- `themes/<key>.tsx` — one file per theme exporting `const <key>Theme: ProgressThemeDefinition`
  (plus `themes/<key>.css` when the theme needs CSS, and `themes/<key>.test.ts` for its pure
  helpers). Nothing else in the app is touched by a theme.
- `registry.ts` — finds the theme files (`import.meta.glob`): a theme is selectable as soon as
  its file ships, nothing else to register. The flask is bundled with the app; every other
  theme is a lazy chunk loaded the first time a skill (or the picker) shows it. A stored key
  this build cannot draw is drawn and named as the flask. Also the level strings of a skill
  (`copyForSkill`) and its colour scope (`colorScope`).
- `texts.ts` — the Russian nouns of all thirteen themes (the contract's `ProgressThemeText`
  plus the dative and the several-levels phrase), known before a theme's chunk loads; must
  equal the `text` of the theme's own file (`registry.test.ts` compares them).
- `ProgressHero.tsx` — `<ProgressHero theme=…>` and `<ProgressMini theme=…>`, what screens
  render; a same-size placeholder while the chunk loads.
- `AppearancePicker.tsx`, `palette.css`, `progress.css` — «Оформление»: the theme cards, the
  nine colour swatches and the `data-liquid-color` palettes (light and dark) every theme paints
  with through `--liquid-*`.
- `preview/<key>.html` + `preview/<key>.tsx` at the repo root — a dev-only page that renders the
  hero at 0 / 25 / 50 / 75 / 100 % and the complete state, a row of minis, a mark, and a button
  that plays a level-up (`?levels=2` for a multi-level one, `?dark` for the dark theme,
  `?tg=purple` for the purple Telegram theme, `?motion=reduced`). `npx vite` serves it at
  `/preview/<key>.html`; it is not part of the production build.

The app passes `level` to the hero (the skill's current level) and to every mini (the rack
slot's level, the card's current level).

### `level` during a level-up (one rule for every theme)

The app renders the NEW `level` together with the new `fill` (= `toFill`) in the SAME commit
(`flushSync` in `useCelebrationStage`), then calls `playLevelUp({ fromFill, toFill, levels })`.
So when `playLevelUp` runs, the props already describe the end state, and the level being
completed is `level − levels`. A theme starts its choreography from `fromFill` (not from the
fill its props now show; the app lowers `fromFill` to what was on screen when writes overlap),
keeps its own display of the pre-level-up state while it plays (past levels, the picture, the
road), and settles on the state derived from the props when it ends. `onOverflow` may be
called once per played level; the app acts on the first call.
`themes.contract.test.tsx` checks this for every theme file: the hero after a level-up 4 → 5
and 4 → 7 equals a fresh hero at the new level and fill, directly and through
CelebrationProvider (where it fails without the `flushSync`).

## Rules

1. **Box.** The hero renders into `viewBox="0 0 160 260"` (portrait, 140 px wide on the skill
   screen, numbers to its right). Wide scenes fold into the box: a road switchbacks upward, a
   ball flies up to a hoop at the top. The mini is a square, `size` px, legible at 28 px.
2. **Fill.** `fill` 0..1 is the whole story: 0 is the start of the level, 1 the beat of
   completion. Stages (a chick hatching, puzzle pieces, tower blocks) derive from `fill` through
   a pure exported function with unit tests at 0, 0.25, 0.5, 0.75, 0.999, 1. The optional
   `level` (1-based, omitted → 1) is the number of the level being filled; a theme may draw the
   `level − 1` finished ones around it (a skyline of built towers, a shelf of read books) as a
   quiet backdrop that never competes with the current level. Past levels join the backdrop at
   the end of the level-up choreography, and their layout is a pure, tested function of the
   count that fits the box at any number (50+ levels included).
3. **Colour.** Draw recognisable objects in their NATURAL colours from a shared warm/cool set of
   token mixes (pizza crust and cheese, a green stem, an orange ball, brown earth, grey rock):
   define them in the theme's CSS as `color-mix()` of tokens with literal fallbacks, tuned so they
   read on light, dark and the purple Telegram theme. The SKILL COLOUR (`--liquid-light`,
   `--liquid-mid`, `--liquid-deep`: the Telegram accent or the skill's chosen colour) goes on ONE
   accent detail the owner will recognise as "their" colour: flower petals, the car body, the book
   cover, the rocket body, the ball's stripe band or the hoop net, the climber's flag and backpack,
   the tower's blocks, the chick's scarf/bow or nest ribbon, the puzzle picture's sky. The flask,
   the moon's lit part and the rainbow's arcs stay fully in the skill colour. `--gold-1..3` for
   `state === 'complete'`. Everything else (outlines, labels, ground) uses tokens: `--color-fg`,
   `--color-fg-secondary`, `--color-bg-elevated`, `--color-bg-sunken`, `--color-border`.
   Exception: procedural planets («Ракета», levels ≥ 2) use generated natural colours as literals,
   drawn by a seeded generator from curated palettes (rocky grey, ice blue, ochre, lava, ocean
   teal, gas-giant cream, violet, pastel pink, jungle green); their lightness stays in a band
   (about 38–74 %) that reads on light, dark and purple pages, and a faint `--color-fg` rim
   outlines every planet so a dark one stays visible on a dark page.
4. **Motion.** Animate only `transform`, `opacity` and `stroke-dashoffset`. Idle motion is
   optional, one element at most, class `anim-decor` (stops under `html.paused` and reduced
   motion). A backdrop of past levels may add calm ambient life on top (the tower's city lights
   its windows at night): CSS opacity keyframes of several seconds with seeded phases, never a
   flicker, ≤ ~150 animated elements, all `anim-decor`, a static mix under reduced motion.
   Level-up ≤ 1.2 s per level; `levels > 1` compresses into at most three cycles then jumps to
   `toFill` (reuse the state machine in `src/ui/components/flaskAnimation.ts` when it
   fits: rising → overflow (the beat, `onOverflow`) → draining (reset) → refilling). Use WAAPI
   through a guarded `element.animate` (see `themes/flask.tsx`: fallback easing, `finished` may never
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
