/** The usual order of titles, used when two are used equally often (e.g. on a new system). */
const USUAL_ORDER = ['Mr', 'Mrs', 'Miss', 'Ms', 'Mx', 'Dr', 'Professor', 'Rev', 'Sir', 'Dame', 'Lord', 'Lady', 'Captain', 'Earl'];

/**
 * Title lists show the most used first (counted from the records that use each title),
 * then the usual order, then A–Z. `_count` is removed from what is returned.
 */
export function sortTitlesByUse<T extends { name: string; _count?: Record<string, number> }>(rows: T[]): Omit<T, '_count'>[] {
  const uses = (r: T) => Object.values(r._count ?? {}).reduce((a, b) => a + b, 0);
  const usual = (name: string) => {
    const i = USUAL_ORDER.findIndex((u) => u.toLowerCase() === name.trim().toLowerCase());
    return i < 0 ? USUAL_ORDER.length : i;
  };
  return [...rows]
    .sort((a, b) => uses(b) - uses(a) || usual(a.name) - usual(b.name) || a.name.localeCompare(b.name))
    .map(({ _count, ...rest }) => rest);
}
