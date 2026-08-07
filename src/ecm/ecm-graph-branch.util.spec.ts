import {
  resolveGraphBranch,
  scheduledJobScheduleAreaScope,
} from './ecm-graph-branch.util';

describe('resolveGraphBranch', () => {
  const areaByLocationId = new Map([
    ['loc-merton', { id: 'area-merton', name: 'Merton' }],
  ]);

  it('prefers job schedule area name', () => {
    expect(
      resolveGraphBranch({
        scheduleArea: { id: 'area-1', name: 'Croydon 1' },
        serviceUserLocation: { id: 'loc-merton', name: 'Merton - Merton' },
        areaByLocationId,
      }),
    ).toEqual({ id: 'area-1', name: 'Croydon 1' });
  });

  it('maps null schedule area via service-user location → area', () => {
    expect(
      resolveGraphBranch({
        scheduleArea: null,
        serviceUserLocation: { id: 'loc-merton', name: 'Merton - Merton' },
        areaByLocationId,
      }),
    ).toEqual({ id: 'area-merton', name: 'Merton' });
  });

  it('falls back to location name when no area maps', () => {
    expect(
      resolveGraphBranch({
        scheduleArea: null,
        serviceUserLocation: { id: 'loc-x', name: 'Somewhere' },
        areaByLocationId,
      }),
    ).toEqual({ id: 'loc:loc-x', name: 'Somewhere' });
  });

  it('uses Unassigned area when nothing is available', () => {
    expect(
      resolveGraphBranch({
        scheduleArea: null,
        serviceUserLocation: null,
        areaByLocationId,
      }),
    ).toEqual({ id: 'none', name: 'Unassigned area' });
  });
});

describe('scheduledJobScheduleAreaScope', () => {
  it('matches area id only when location unknown', () => {
    expect(scheduledJobScheduleAreaScope('area-1')).toEqual({
      scheduleAreaId: 'area-1',
    });
  });

  it('includes null-area jobs on the area location', () => {
    expect(scheduledJobScheduleAreaScope('area-1', 'loc-1')).toEqual({
      OR: [
        { scheduleAreaId: 'area-1' },
        { scheduleAreaId: null, serviceUser: { locationId: 'loc-1' } },
      ],
    });
  });
});
