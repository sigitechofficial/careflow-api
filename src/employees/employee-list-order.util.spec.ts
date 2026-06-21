import { buildEmployeeListOrderBy } from './employee-list-order.util';

describe('buildEmployeeListOrderBy', () => {
  it('sorts by employee name via personal detail', () => {
    expect(buildEmployeeListOrderBy({ sortBy: 'name', sortOrder: 'asc' })).toEqual([
      { personalDetail: { lastName: 'asc' } },
      { personalDetail: { firstName: 'asc' } },
    ]);
  });

  it('defaults to updatedAt desc', () => {
    expect(buildEmployeeListOrderBy({})).toEqual([{ updatedAt: 'desc' }]);
  });

  it('sorts employment lookups by related name', () => {
    expect(buildEmployeeListOrderBy({ sortBy: 'jobTitle', sortOrder: 'desc' })).toEqual([
      { employment: { jobTitle: { name: 'desc' } } },
    ]);
  });
});
