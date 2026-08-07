import { scheduledJobLocationScope } from './ecm-location-scope.util';

describe('scheduledJobLocationScope', () => {
  it('matches schedule area or service-user home location', () => {
    const locationId = 'loc-1';
    expect(scheduledJobLocationScope(locationId)).toEqual({
      OR: [
        { scheduleArea: { locationId } },
        { serviceUser: { locationId } },
      ],
    });
  });
});
