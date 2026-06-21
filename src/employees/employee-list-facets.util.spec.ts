import { employeeEmploymentMatchesBranch } from './employee-list-facets.util';

describe('employeeEmploymentMatchesBranch', () => {
  it('matches all-zones carers for any branch', () => {
    expect(
      employeeEmploymentMatchesBranch(
        { accessAllZones: true, locationId: null, floorLocations: [] },
        'branch-a',
      ),
    ).toBe(true);
  });

  it('matches primary and floor locations', () => {
    expect(
      employeeEmploymentMatchesBranch(
        {
          accessAllZones: false,
          locationId: 'branch-a',
          floorLocations: [{ locationId: 'branch-b' }],
        },
        'branch-b',
      ),
    ).toBe(true);
    expect(
      employeeEmploymentMatchesBranch(
        {
          accessAllZones: false,
          locationId: 'branch-a',
          floorLocations: [{ locationId: 'branch-b' }],
        },
        'branch-c',
      ),
    ).toBe(false);
  });
});
