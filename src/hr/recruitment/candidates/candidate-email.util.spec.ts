import { buildOfferEmail, buildRejectionEmail, formatOfferDate } from './candidate-email.util';

const base = {
  candidateFirstName: 'Sana',
  jobTitle: 'Care Assistant',
  organisation: 'Bright Care',
  organisationEmail: 'jobs@bright.example.com',
  organisationPhone: '01632 960000',
};

describe('candidate emails', () => {
  it('formats the offer start date as a plain date', () => {
    expect(formatOfferDate(new Date('2027-01-04T00:00:00.000Z'))).toBe('Monday 4 January 2027');
  });

  it('builds the conditional offer with its terms and conditions', () => {
    const m = buildOfferEmail({
      ...base,
      kind: 'OFFER',
      startDate: new Date('2027-01-04T00:00:00.000Z'),
      hoursPerWeek: '30',
      payRate: '£12.60 / hour',
    });
    expect(m.subject).toBe('Conditional job offer — Care Assistant');
    expect(m.text).toContain('Proposed start date: Monday 4 January 2027');
    expect(m.text).toContain('Hours per week: 30');
    expect(m.text).toContain('Pay: £12.60 / hour');
    expect(m.text).toContain('enhanced DBS check');
    expect(m.text).toContain('call 01632 960000 or email jobs@bright.example.com');
    expect(m.html).toContain('£12.60 / hour');
  });

  it('leaves out empty terms and says when the offer changed', () => {
    const m = buildOfferEmail({ ...base, kind: 'UPDATE', startDate: null, hoursPerWeek: ' ', payRate: null });
    expect(m.subject).toBe('Your job offer has been updated — Care Assistant');
    expect(m.text).not.toContain('Hours per week');
    expect(m.text).not.toContain('Pay:');
    expect(m.text).toContain('Role: Care Assistant');
  });

  it('words the rejection by how far the candidate got', () => {
    expect(buildRejectionEmail({ ...base, point: 'APPLICATION' }).text).toContain('not be taking your application further');
    expect(buildRejectionEmail({ ...base, point: 'INTERVIEW' }).text).toContain('attend an interview');
    const offer = buildRejectionEmail({ ...base, point: 'OFFER' });
    expect(offer.text).toContain('unable to continue with the offer');
    expect(offer.text).toContain('please call 01632 960000');
    expect(offer.subject).toBe('Your application for Care Assistant');
  });

  it('escapes HTML in names', () => {
    const m = buildRejectionEmail({ ...base, candidateFirstName: '<b>Al</b>', point: 'APPLICATION' });
    expect(m.html).toContain('&lt;b&gt;Al&lt;/b&gt;');
  });
});
