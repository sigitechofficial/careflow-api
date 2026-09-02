import { mapServiceUserListRow } from './service-user.mapper';

function listUser() {
  return {
    id: 'su-1',
    serviceUserNumber: 'SU-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    preferredName: null,
    dateOfBirth: null,
    isActive: true,
    serviceStartDate: null,
    profilePhotoUrl: null,
    title: null,
    gender: null,
    status: null,
    careType: null,
    fundingType: null,
    riskLevel: null,
    locationId: null,
    location: null,
    keyWorker: null,
    namedNurse: null,
  };
}

describe('mapServiceUserListRow carePlanListStatus', () => {
  it('defaults to none when no published care-plan aggregate is supplied', () => {
    expect(mapServiceUserListRow(listUser()).carePlanListStatus).toBe('none');
  });

  it('passes through the batched list status', () => {
    expect(
      mapServiceUserListRow(listUser(), undefined, { carePlanListStatus: 'due_within_week' })
        .carePlanListStatus,
    ).toBe('due_within_week');
    expect(
      mapServiceUserListRow(listUser(), undefined, { carePlanListStatus: 'overdue' })
        .carePlanListStatus,
    ).toBe('overdue');
    expect(
      mapServiceUserListRow(listUser(), undefined, { carePlanListStatus: 'ok' }).carePlanListStatus,
    ).toBe('ok');
  });
});
