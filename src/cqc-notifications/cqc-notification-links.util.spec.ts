import {
  CqcNotificationStatus,
  CqcNotificationType,
  IncidentPrivacyLevel,
} from '@prisma/client';
import {
  type IncidentFacts,
  abuseTypeForSafeguarding,
  incidentTypeKey,
  settledByNotifications,
  suggestionsForIncident,
  viewableIncidentPrivacy,
} from './cqc-notification-links.util';

describe('settledByNotifications', () => {
  const row = (
    status: CqcNotificationStatus,
    type: CqcNotificationType = CqcNotificationType.DEATH,
  ) => ({ incidentId: 'inc-1', safeguardingCaseId: 'case-1', type, status });

  it('a cancelled notification settles nothing, so the incident stays a candidate', () => {
    const s = settledByNotifications([row(CqcNotificationStatus.CANCELLED)]);
    expect(s.incidentTypes.size).toBe(0);
    expect(s.caseIds.size).toBe(0);
  });

  it('a death notification settles the service user, however it was started', () => {
    const s = settledByNotifications([
      { incidentId: null, safeguardingCaseId: null, serviceUserId: 'su-1', type: CqcNotificationType.DEATH, status: CqcNotificationStatus.DRAFT },
      { incidentId: null, safeguardingCaseId: null, serviceUserId: 'su-2', type: CqcNotificationType.DEATH, status: CqcNotificationStatus.CANCELLED },
      { incidentId: null, safeguardingCaseId: null, serviceUserId: 'su-3', type: CqcNotificationType.SERIOUS_INJURY, status: CqcNotificationStatus.SUBMITTED },
    ]);
    expect([...s.deathServiceUserIds]).toEqual(['su-1']);
  });

  it('a notification of another type does not settle the suggested type', () => {
    const s = settledByNotifications([
      row(CqcNotificationStatus.NOT_REQUIRED, CqcNotificationType.SERVICE_DISRUPTION),
    ]);
    expect(s.incidentTypes.has(incidentTypeKey('inc-1', CqcNotificationType.DEATH))).toBe(false);
  });

  it.each([
    CqcNotificationStatus.DRAFT,
    CqcNotificationStatus.READY,
    CqcNotificationStatus.SUBMITTED,
    CqcNotificationStatus.ACKNOWLEDGED,
    CqcNotificationStatus.NOT_REQUIRED,
  ])('a %s notification of the same type settles the incident and the case', (status) => {
    const s = settledByNotifications([row(status)]);
    expect(s.incidentTypes.has(incidentTypeKey('inc-1', CqcNotificationType.DEATH))).toBe(true);
    expect(s.caseIds.has('case-1')).toBe(true);
  });
});

const base: IncidentFacts = {
  categoryKey: 'ACCIDENT',
  admittedToHospital: null,
  whoInformedKeys: [],
  externalBodyTypes: [],
  carerSafeguardingConcern: null,
};

describe('cqc-notification-links.util', () => {
  describe('suggestionsForIncident', () => {
    const types = (facts: Partial<IncidentFacts>) =>
      suggestionsForIncident({ ...base, ...facts }).map((s) => s.type);

    it('suggests nothing for an ordinary accident', () => {
      expect(suggestionsForIncident(base)).toEqual([]);
    });

    it('lists every type an incident may need, most serious first, once each', () => {
      expect(
        types({
          categoryKey: 'DEATH',
          admittedToHospital: true,
          whoInformedKeys: ['police'],
        }),
      ).toEqual([
        CqcNotificationType.DEATH,
        CqcNotificationType.POLICE_INCIDENT,
        CqcNotificationType.SERIOUS_INJURY,
      ]);
      expect(
        types({ carerSafeguardingConcern: true, externalBodyTypes: ['POLICE'] }),
      ).toEqual([
        CqcNotificationType.ABUSE_ALLEGATION,
        CqcNotificationType.POLICE_INCIDENT,
      ]);
      expect(
        types({ admittedToHospital: true, takenToAe: true, severity: 'CRITICAL' }),
      ).toEqual([CqcNotificationType.SERIOUS_INJURY]);
    });

    it('spots police involvement and hospital admission', () => {
      expect(types({ externalBodyTypes: ['POLICE'] })).toEqual([
        CqcNotificationType.POLICE_INCIDENT,
      ]);
      expect(types({ whoInformedKeys: ['police'] })).toEqual([
        CqcNotificationType.POLICE_INCIDENT,
      ]);
      expect(types({ admittedToHospital: true })).toEqual([
        CqcNotificationType.SERIOUS_INJURY,
      ]);
    });

    it('spots pressure ulcers of category 3 or worse, but not lower grades', () => {
      const ulcer = (grade: string) =>
        types({
          categoryKey: 'SKIN_WOUND',
          subtypeKey: 'PRESSURE_ULCER',
          categoryDetails: { woundStatus: 'NEW', pressureUlcerGrade: grade },
        });
      expect(ulcer('CATEGORY_3')).toEqual([CqcNotificationType.SERIOUS_INJURY]);
      expect(ulcer('CATEGORY_4')).toEqual([CqcNotificationType.SERIOUS_INJURY]);
      expect(ulcer('UNSTAGEABLE')).toEqual([CqcNotificationType.SERIOUS_INJURY]);
      expect(ulcer('CATEGORY_2')).toEqual([]);
    });

    it('spots unexplained bruising, A&E, critical severity, fire and utility failure', () => {
      expect(
        types({ categoryKey: 'SKIN_WOUND', subtypeKey: 'UNEXPLAINED_BRUISING' }),
      ).toEqual([CqcNotificationType.ABUSE_ALLEGATION]);
      expect(types({ takenToAe: true })).toEqual([
        CqcNotificationType.SERIOUS_INJURY,
      ]);
      expect(types({ severity: 'CRITICAL' })).toEqual([
        CqcNotificationType.SERIOUS_INJURY,
      ]);
      expect(types({ categoryKey: 'DATA_BREACH', severity: 'CRITICAL' })).toEqual(
        [],
      );
      expect(types({ categoryKey: 'HEALTH_SAFETY', subtypeKey: 'FIRE' })).toEqual([
        CqcNotificationType.SERVICE_DISRUPTION,
      ]);
      expect(
        types({ categoryKey: 'HEALTH_SAFETY', subtypeKey: 'UTILITY_FAILURE' }),
      ).toEqual([CqcNotificationType.SERVICE_DISRUPTION]);
      expect(
        types({ categoryKey: 'HEALTH_SAFETY', subtypeKey: 'EQUIPMENT' }),
      ).toEqual([]);
    });
  });

  it('maps safeguarding categories to CQC abuse types', () => {
    expect(abuseTypeForSafeguarding('EMOTIONAL')).toBe('PSYCHOLOGICAL');
    expect(abuseTypeForSafeguarding('SELF_NEGLECT')).toBe('NEGLECT');
    expect(abuseTypeForSafeguarding('MODERN_SLAVERY')).toBe('OTHER');
  });

  it('limits incident privacy like the incidents module', () => {
    expect(viewableIncidentPrivacy({ roles: [], permissions: [] })).toEqual([
      IncidentPrivacyLevel.NORMAL,
    ]);
    expect(
      viewableIncidentPrivacy({
        roles: [],
        permissions: ['incidents.view_confidential'],
      }),
    ).toHaveLength(2);
    expect(viewableIncidentPrivacy({ roles: ['Super Admin'] })).toHaveLength(3);
  });
});
