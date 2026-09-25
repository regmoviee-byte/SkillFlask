import { useEffect, useRef, useState } from 'react';
import { normalizeColor } from '../../domain/appearance';
import type { Skill } from '../../domain/types';
import { setSkillAppearance } from '../../services/skills';
import { haptics } from '../../platform/haptics';
import { errorMessage } from '../completionFeedback';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { copy } from '../copy';
import { AppearancePicker, type Appearance } from '../progress/AppearancePicker';
import { skillTheme } from '../progress/registry';

// «Оформление» from the skill's ⋯ menu: the same picker as the skill form, saved at once on
// every choice («Оформление сохранено»). The screen behind follows through its live query.

export function AppearanceSheet({ skill, open, onClose }: { skill: Skill; open: boolean; onClose(): void }) {
  // The latest stored skill (the live query moves it on while writes are in flight).
  const current = useRef(skill);
  current.current = skill;
  const stored = (): Appearance => ({ theme: skillTheme(current.current.theme), color: normalizeColor(current.current.color) });
  // Shown at once on a tap; the stored value catches up when the write lands.
  const [value, setValue] = useState<Appearance>(stored);
  const saving = useRef(0);
  /** Number of the latest choice; older writes that settle later neither toast nor revert. */
  const latest = useRef(0);
  const { showToast } = useToast();

  // Re-sync with the stored value whenever the sheet opens (or it changed elsewhere).
  const storedKey = `${skill.theme}|${skill.color ?? ''}`;
  useEffect(() => {
    if (saving.current === 0) setValue(stored());
    // `stored` reads the same two fields `storedKey` names.
  }, [storedKey, open]);

  async function change(next: Appearance) {
    const request = ++latest.current;
    const shown = value;
    setValue(next);
    saving.current += 1;
    try {
      // Only what changed is written: a stored key this build does not know (shown as the
      // flask) stays stored until another theme is chosen; a colour change alone keeps it.
      await setSkillAppearance(skill.id, { ...(next.theme !== shown.theme && { theme: next.theme }), ...(next.color !== shown.color && { color: next.color }) });
      // One toast for a burst of taps: only the latest choice says it is saved.
      if (request === latest.current) showToast(copy.appearance.saved);
    } catch (error) {
      haptics.error();
      // Only the latest choice decides what the sheet shows: an older write failing after a
      // newer one was accepted must not bring back a value from before both.
      if (request === latest.current) {
        setValue(stored());
        showToast(errorMessage(error));
      }
    } finally {
      saving.current -= 1;
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={copy.appearance.title} className="appearance-sheet">
      <AppearancePicker value={value} onChange={(next) => void change(next)} />
    </Sheet>
  );
}
