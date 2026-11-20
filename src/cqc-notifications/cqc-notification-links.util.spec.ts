import { CqcNotificationType, IncidentPrivacyLevel } from '@prisma/client';
import {
  abuseTypeForSafeguarding,
  suggestForIncident,
  viewableIncidentPrivacy,
} from './cqc-notification-links.util';

const base = {
  categoryKey: 'ACCIDENT',
  admittedToHospital: null,
  whoInformedKeys: [],
  externalBodyTypes: [],
  carerSafeguardingConcern: null,
};

describe('cqc-notification-links.util', () => {
  describe('suggestForIncident', () => {
    it('suggests nothing for an ordinary accident', () => {
      expect(suggestForIncident(base)).toBeNull();
    });

    it('picks the most serious reason first', () => {
      expect(
        suggestForIncident({
          ...base,
          categoryKey: 'DEATH',
          admittedToHospital: true,
          whoInformedKeys: ['police'],
        })?.type,
      ).toBe(CqcNotificationType.DEATH);
      expect(
        suggestForIncident({
          ...base,
          carerSafeguardingConcern: true,
          admittedToHospital: true,
        })?.type,
      ).toBe(CqcNotificationType.ABUSE_ALLEGATION);
    });

    it('spots police involvement and hospital admission', () => {
      expect(
        suggestForIncident({ ...base, externalBodyTypes: ['POLICE'] })?.type,
      ).toBe(CqcNotificationType.POLICE_INCIDENT);
      expect(
        suggestForIncident({ ...base, whoInformedKeys: ['police'] })?.type,
      ).toBe(CqcNotificationType.POLICE_INCIDENT);
      expect(
        suggestForIncident({ ...base, admittedToHospital: true })?.type,
      ).toBe(CqcNotificationType.SERIOUS_INJURY);
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
