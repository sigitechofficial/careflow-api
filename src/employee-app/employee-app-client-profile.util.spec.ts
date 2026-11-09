import { InitialAssessmentRiskType } from '@prisma/client';
import {
  extractProfileCommunicationNotes,
  gpAsContact,
  mapProfileCommunication,
  mapProfileContact,
  mapProfileGp,
  profileRiskLabel,
} from './employee-app-client-profile.util';

describe('employee-app-client-profile.util', () => {
  it('labels open IA risks for the carer profile', () => {
    expect(profileRiskLabel(InitialAssessmentRiskType.FALLS)).toBe('Falls risk');
    expect(profileRiskLabel(InitialAssessmentRiskType.HYDRATION)).toBe('Dehydration risk');
    expect(profileRiskLabel(InitialAssessmentRiskType.SKIN_INTEGRITY)).toBe(
      'Pressure ulcer risk',
    );
    expect(profileRiskLabel(InitialAssessmentRiskType.MOVING_HANDLING)).toBe(
      'Moving & handling risk',
    );
  });

  it('extracts communication chips from care instructions', () => {
    expect(
      extractProfileCommunicationNotes(
        'Hard of hearing in left ear. Knock before entering. Reading glasses on the dresser.',
      ),
    ).toEqual(['Reading glasses', 'Hard of hearing', 'Announce yourself']);
  });

  it('maps communication chip + full note', () => {
    expect(mapProfileCommunication(null)).toBeNull();
    expect(
      mapProfileCommunication('Hard of hearing. Approach from the right.'),
    ).toEqual({
      items: ['Hard of hearing'],
      chip: 'Hard of hearing',
      note: 'Hard of hearing. Approach from the right.',
    });
  });

  it('maps emergency contacts and GP', () => {
    expect(
      mapProfileContact({
        firstName: 'Mary',
        lastName: 'Chen',
        phone: null,
        mobile: '07700 900112',
        isPrimary: true,
        isEmergencyContact: true,
        relationshipType: { name: 'Daughter' },
      }),
    ).toEqual({
      title: 'Mary Chen',
      subtitle: 'Daughter · 07700 900112',
      type: 'emergency',
    });

    expect(mapProfileGp({ gpName: ' Dr Khan ', gpSurgery: ' Riverside Medical ' })).toEqual({
      name: 'Dr Khan',
      surgery: 'Riverside Medical',
    });
    expect(gpAsContact({ name: 'Dr Khan', surgery: 'Riverside Medical' })).toEqual({
      title: 'Dr Khan',
      subtitle: 'Riverside Medical',
      type: 'gp',
    });
    expect(mapProfileGp({ gpName: '  ', gpSurgery: null })).toBeNull();
  });
});

describe('GP from Contacts', () => {
  it('recognises the GP contact and shows surgery and phone', () => {
    const { isGpContact, gpContactAsContact } = jest.requireActual('./employee-app-client-profile.util');
    expect(isGpContact({ relationshipType: { code: 'GP' } })).toBe(true);
    expect(isGpContact({ relationshipType: { code: 'SON' } })).toBe(false);
    expect(
      gpContactAsContact({ firstName: 'Dr', lastName: 'Khan', phone: '0161 000', mobile: null, address: 'Riverside\nMedical' }),
    ).toEqual({ title: 'Dr Khan', subtitle: 'Riverside Medical · 0161 000', type: 'gp' });
  });
});

describe('GP from Contacts', () => {
  it('recognises the GP contact and shows surgery and phone', () => {
    const { isGpContact, gpContactAsContact } = jest.requireActual('./employee-app-client-profile.util');
    expect(isGpContact({ relationshipType: { code: 'GP' } })).toBe(true);
    expect(isGpContact({ relationshipType: { code: 'SON' } })).toBe(false);
    expect(
      gpContactAsContact({ firstName: 'Dr', lastName: 'Khan', phone: '0161 000', mobile: null, address: 'Riverside\nMedical' }),
    ).toEqual({ title: 'Dr Khan', subtitle: 'Riverside Medical · 0161 000', type: 'gp' });
  });
});
