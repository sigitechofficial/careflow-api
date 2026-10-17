import {
  incidentServiceUserIds,
  versionCompletesCarePlanMeasure,
} from './incident-care-plan-measure.util';

const added = new Date('2026-10-08T10:00:00Z');
const before = new Date('2026-10-08T09:00:00Z');
const after = new Date('2026-10-08T11:00:00Z');
const su = 'su-1';

const measure = { id: 'm1', createdAt: added, newRecordNeeded: false, linkedInstanceIds: ['plan-a'] };
const version = {
  instanceId: 'plan-a',
  instanceServiceUserId: su,
  instanceCreatedAt: before,
  publishedAt: after,
  incidentActionId: null,
};

describe('versionCompletesCarePlanMeasure', () => {
  it('a version of the named plan published after the measure counts', () => {
    expect(versionCompletesCarePlanMeasure(measure, version, [su])).toBe(true);
  });

  it('a version published before the measure was added does not', () => {
    expect(versionCompletesCarePlanMeasure(measure, { ...version, publishedAt: before }, [su])).toBe(
      false,
    );
  });

  it('a version of another plan does not', () => {
    expect(
      versionCompletesCarePlanMeasure(measure, { ...version, instanceId: 'plan-b' }, [su]),
    ).toBe(false);
  });

  it('a plan of a service user not on the incident does not', () => {
    expect(versionCompletesCarePlanMeasure(measure, version, ['su-2'])).toBe(false);
  });

  it('a version already used for another measure does not', () => {
    expect(
      versionCompletesCarePlanMeasure(measure, { ...version, incidentActionId: 'm2' }, [su]),
    ).toBe(false);
    expect(
      versionCompletesCarePlanMeasure(measure, { ...version, incidentActionId: 'm1' }, [su]),
    ).toBe(true);
  });

  it('"new care plan needed": only a plan created after the measure counts', () => {
    const fresh = { ...measure, newRecordNeeded: true, linkedInstanceIds: [] };
    expect(versionCompletesCarePlanMeasure(fresh, version, [su])).toBe(false);
    expect(
      versionCompletesCarePlanMeasure(
        fresh,
        { ...version, instanceId: 'plan-new', instanceCreatedAt: after },
        [su],
      ),
    ).toBe(true);
  });
});

describe('incidentServiceUserIds', () => {
  it('primary first, no duplicates', () => {
    expect(
      incidentServiceUserIds({ primaryServiceUserId: 'a', involvedServiceUserIds: ['b', 'a'] }),
    ).toEqual(['a', 'b']);
  });
});
