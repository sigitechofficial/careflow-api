import { AI_FILE_LIMITS, pdfPageCount, planAttachments, type ExtractionAttachment, type ReferralExtraction } from './referral-extraction.service';
import { newFacts, threadBody } from './referral-follow-up.util';

const base = (over: Partial<ReferralExtraction> = {}): ReferralExtraction =>
  ({
    isReferral: true,
    summary: '',
    person: { firstName: 'Ann', lastName: 'Lee', dateOfBirth: '', addressLine: '', postcode: 'CR0 1AA', phone: '', nhsNumber: '', livesAlone: '' },
    contact: { name: '', relationship: '', phone: '', email: '' },
    referrer: { organisation: '', name: '', role: '', email: '', phone: '', reference: '' },
    urgency: 'ROUTINE',
    careNeeds: '',
    conditions: ['Dementia'],
    risks: [],
    care: { hoursPerWeek: '', visitsPerDay: '', visitTimes: '', carersPerVisit: '', requestedStartDate: '', genderPreference: '', languageOrCulture: '' },
    funding: { type: 'UNKNOWN', funderName: '', details: '' },
    visits: [],
    careAreas: [],
    priceAsked: false,
    questionsAsked: [],
    missingInformation: ['Date of birth'],
    attachmentsRead: [],
    ...over,
  }) as ReferralExtraction;

describe('follow-up emails', () => {
  it('lists the facts a reply added or changed', () => {
    const before = base();
    const after = base({
      person: { ...before.person, dateOfBirth: '12/03/1941', postcode: 'CR0 2BB' },
      conditions: ['dementia', 'Diabetes'],
      funding: { type: 'LOCAL_AUTHORITY', funderName: 'Croydon Council', details: '' },
      visits: [{ label: 'Morning', startTime: '08:00', durationMinutes: 45, days: ['MON', 'TUE'], carers: 1 }],
    });
    expect(newFacts(before, after)).toEqual([
      'Date of birth: 12/03/1941',
      'Postcode: CR0 2BB (was CR0 1AA)',
      'Funding: LOCAL_AUTHORITY, Croydon Council',
      'New conditions: Diabetes',
      'Visits: Morning 08:00 for 45 min, MON TUE',
    ]);
  });

  it('reports nothing when the reply adds nothing, and never a fact that was removed', () => {
    const before = base({ person: { ...base().person, phone: '020 1234' } });
    expect(newFacts(before, base())).toEqual([]);
    expect(newFacts(before, before)).toEqual([]);
    const v = base({ care: { ...base().care, visitTimes: '10am on Mondays and Fridays' } });
    expect(newFacts(v, base({ care: { ...base().care, visitTimes: '10am Mondays, Fridays' } }))).toEqual([]);
  });

  it('puts the later emails after the referral, oldest first', () => {
    const body = threadBody('Referral for Ann', [
      { fromName: 'Sam', fromEmail: 'sam@nhs.net', subject: 'Re: referral', receivedAt: new Date('2026-11-10T09:00:00Z'), bodyText: 'DOB 12/03/1941' },
    ]);
    expect(body.indexOf('Referral for Ann')).toBe(0);
    expect(body).toContain('From: Sam <sam@nhs.net>');
    expect(body).toContain('DOB 12/03/1941');
  });
});

describe('attachments too large for the AI', () => {
  const pdf = (name: string, pages: number, bytes = 1000): ExtractionAttachment => {
    const body = Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R >>').join('\n') + '<< /Type /Pages /Count 1 >>';
    return { fileName: name, mimeType: 'application/pdf', data: Buffer.concat([Buffer.from(body, 'latin1'), Buffer.alloc(Math.max(0, bytes - body.length))]) };
  };

  it('counts PDF pages without counting the page tree', () => {
    expect(pdfPageCount(pdf('a.pdf', 3).data)).toBe(3);
  });

  it('leaves out a PDF over the page limit and an image over 5 MB, keeps the rest in order', () => {
    const big = pdf('long.pdf', AI_FILE_LIMITS.pdfPages + 1);
    const img: ExtractionAttachment = { fileName: 'photo.jpg', mimeType: 'image/jpeg', data: Buffer.alloc(AI_FILE_LIMITS.imageBytes + 1) };
    const word: ExtractionAttachment = { fileName: 'plan.docx', mimeType: 'application/msword', data: Buffer.alloc(10), text: 'plan' };
    const ok = pdf('summary.pdf', 2);
    const r = planAttachments([big, word, img, ok]);
    expect(r.send.map((a) => a.fileName)).toEqual(['plan.docx', 'summary.pdf']);
    expect(r.notRead.map((n) => n.fileName)).toEqual(['long.pdf', 'photo.jpg']);
    expect(r.notRead[0].reason).toMatch(/101 pages/);
  });

  it('keeps the smaller files when they don\'t all fit in one request', () => {
    const half = Math.floor(AI_FILE_LIMITS.totalBytes / 2) + 10;
    const r = planAttachments([pdf('one.pdf', 1, half), pdf('two.pdf', 1, half + 5), pdf('small.pdf', 1, 100)]);
    expect(r.send.map((a) => a.fileName)).toEqual(['one.pdf', 'small.pdf']);
    expect(r.notRead).toEqual([{ fileName: 'two.pdf', reason: 'Too large to read together with the other files' }]);
  });
});
