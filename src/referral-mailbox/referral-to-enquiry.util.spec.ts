import { enquiryNeedsText } from './referral-to-enquiry.util';
import type { ReferralExtraction } from './referral-extraction.service';

const base = {
  careNeeds: 'Help with personal care',
  conditions: [],
  risks: [],
  care: { hoursPerWeek: '', visitsPerDay: '', visitTimes: '', carersPerVisit: '', requestedStartDate: '', genderPreference: '', languageOrCulture: '' },
  person: { livesAlone: '' },
  funding: { details: '' },
  questionsAsked: [],
  missingInformation: [],
} as unknown as ReferralExtraction;

describe('enquiry needs text', () => {
  it('works for emails read before full details were recorded', () => {
    expect(enquiryNeedsText(base)).toBe('Help with personal care');
  });

  it('adds visit tasks and the key details from a detailed referral', () => {
    const text = enquiryNeedsText({
      ...base,
      visits: [{ label: 'Morning', startTime: '08:00', durationMinutes: 60, days: [], carers: 2, tasks: 'hoist, wash, dress' }],
      details: {
        keyFacts: {
          packageType: 'Long-term',
          respondBy: '4pm Thursday',
          currentLocation: 'Ward 9, discharge 2026-12-01',
          access: 'Key safe; code given in the referral',
          resuscitation: 'DNACPR in place',
          medicationSupport: 'Administer',
          transfers: 'Full hoist, 2 carers',
        },
        allergies: ['Penicillin'],
        medicines: [],
        equipment: [{ item: 'Ceiling hoist', status: 'on order' }],
        people: [],
        outcomes: [],
        sections: [{ section: 'Health', label: 'Continence', value: 'Pads at night' }],
      },
    } as unknown as ReferralExtraction);
    expect(text).toContain('Morning: hoist, wash, dress');
    expect(text).toContain('Package: Long-term');
    expect(text).toContain('Reply needed by: 4pm Thursday');
    expect(text).toContain('Currently at: Ward 9, discharge 2026-12-01');
    expect(text).toContain('Allergies: Penicillin');
    expect(text).toContain('Equipment: Ceiling hoist (on order)');
    expect(text).not.toContain('Capacity:');
  });
});
