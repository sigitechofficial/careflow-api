export function parseHm(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function timeWindowsOverlap(
  visitStart: string,
  visitEnd: string,
  patternStart: string | null,
  patternEnd: string | null,
): boolean {
  if (!patternStart || !patternEnd) return true;
  const vs = parseHm(visitStart);
  let ve = parseHm(visitEnd);
  let ps = parseHm(patternStart);
  let pe = parseHm(patternEnd);
  if (ve <= vs) ve += 24 * 60;
  if (pe <= ps) pe += 24 * 60;
  return vs < pe && ve > ps;
}

export function hmFromJobDate(date: Date): string {
  const h = date.getUTCHours();
  const m = date.getUTCMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
