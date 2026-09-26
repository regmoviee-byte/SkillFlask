// A tiny iCalendar reader for tests (v0.5 package 20): enough to check what domain/ics.ts writes —
// CRLF lines, unfolding (a line break followed by one space), `NAME;PARAMS:value`, TEXT
// unescaping, and the components they sit in.

export interface IcsLine {
  name: string;
  value: string;
  /** Components around the line, outermost first: ['VCALENDAR', 'VEVENT', 'VALARM']. */
  path: string[];
}

/** Unescapes a TEXT value: `\n`, `\,`, `\;`, `\\`. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Parses an .ics text; throws on a bare LF, a line without a name, or unbalanced BEGIN/END. */
export function parseIcs(text: string): IcsLine[] {
  if (/[^\r]\n/.test(text) || !text.endsWith('\r\n')) throw new Error('Lines must end with CRLF');
  const unfolded = text.replace(/\r\n[ \t]/g, '').split('\r\n').slice(0, -1);
  const path: string[] = [];
  const out: IcsLine[] = [];
  for (const line of unfolded) {
    const colon = line.indexOf(':');
    if (colon <= 0) throw new Error(`Not a content line: ${line}`);
    const name = line.slice(0, colon).split(';')[0]!;
    const value = line.slice(colon + 1);
    if (name === 'BEGIN') {
      path.push(value);
      continue;
    }
    if (name === 'END') {
      if (path.pop() !== value) throw new Error(`Unbalanced END:${value}`);
      continue;
    }
    out.push({ name, value, path: [...path] });
  }
  if (path.length) throw new Error(`Unclosed ${path.join('/')}`);
  return out;
}

/** The properties of one component (the last one of that name wins), e.g. `props(lines, 'VEVENT')`. */
export function props(lines: IcsLine[], component: string): Record<string, string> {
  return Object.fromEntries(lines.filter((line) => line.path[line.path.length - 1] === component).map((line) => [line.name, line.value]));
}
