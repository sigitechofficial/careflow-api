import { buildEmployeeListEmploymentWhere } from './employee-list-filter.util';

describe('buildEmployeeListEmploymentWhere', () => {
  it('merges legacy single ids with array ids', () => {
    const { whereEmployment } = buildEmployeeListEmploymentWhere({
      roleId: 'role-a',
      roleIds: ['role-b', 'role-a'],
    });
    expect(whereEmployment.roleId).toEqual({ in: ['role-a', 'role-b'] });
  });

  it('adds branch filter with access-all-zones and floor locations', () => {
    const { whereEmployment, hasEmploymentFilters } = buildEmployeeListEmploymentWhere({
      locationIds: ['loc-1', 'loc-2'],
    });
    expect(hasEmploymentFilters).toBe(true);
    expect(whereEmployment.AND).toEqual([
      {
        OR: [
          { accessAllZones: true },
          { locationId: { in: ['loc-1', 'loc-2'] } },
          { floorLocations: { some: { locationId: { in: ['loc-1', 'loc-2'] } } } },
        ],
      },
    ]);
  });
});
