import { useEffect, useState } from 'react';
import { registerNoteOpener } from '../completionFeedback';
import { CompletionSheet } from './CompletionSheet';

// The completion sheet the toast's «Заметка» and the setting «Спрашивать заметку после каждого
// действия» open (v0.5 package 17), mounted once by the app: the toast outlives the screen it
// started on, so the sheet cannot belong to one. The same sheet as a history row opens, with the
// note field focused; closing it empty writes nothing.
export function CompletionNoteHost() {
  const [completionId, setCompletionId] = useState<string | null>(null);
  useEffect(() => registerNoteOpener(setCompletionId), []);
  return <CompletionSheet completionId={completionId} focusNote onClose={() => setCompletionId(null)} />;
}
