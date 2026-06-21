import { intersectEmployeeIdFilters } from './employee-list-advanced-filter.util';

describe('intersectEmployeeIdFilters', () => {
  it('returns undefined when no filters are active', () => {
    expect(intersectEmployeeIdFilters([undefined, undefined])).toBeUndefined();
  });

  it('intersects multiple employee id sets', () => {
    expect(
      intersectEmployeeIdFilters([
        ['a', 'b', 'c'],
        ['b', 'c', 'd'],
      ]),
    ).toEqual(['b', 'c']);
  });

  it('returns empty when intersection is empty', () => {
    expect(intersectEmployeeIdFilters([['a'], ['b']])).toEqual([]);
  });
});
