import { mapClockInArrivalReasonRow } from './employee-app-check-in-arrival-reasons';

describe('employee-app check-in arrival reasons', () => {
  it('maps a catalog row onto the employee-app picker shape without a code', () => {
    expect(
      mapClockInArrivalReasonRow({
        label: 'Client requested earlier arrival',
        requiresNotes: false,
        sortOrder: 10,
        isActive: true,
      }),
    ).toEqual({
      label: 'Client requested earlier arrival',
      requiresNotes: false,
      enabled: true,
      sortOrder: 10,
    });
  });
});
