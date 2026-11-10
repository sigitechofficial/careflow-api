import { EnquiryKind, EnquiryReceivedVia, EnquirySource } from '@prisma/client';
import { docxToText, effectiveMimeType, htmlToText, parseFromHeader, parseGmailMessage } from './referral-email-parse.util';
import { enquiryFromReferral, enquiryNeedsText } from './referral-to-enquiry.util';
import { buildTestReferralRaw } from './referral-test-email.util';
import type { ReferralExtraction } from './referral-extraction.service';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('referral email parsing', () => {
  it('reads the sender name and address', () => {
    expect(parseFromHeader('"Jane Smith" <Jane@Council.gov.uk>')).toEqual({ name: 'Jane Smith', email: 'jane@council.gov.uk' });
    expect(parseFromHeader('jane@council.gov.uk')).toEqual({ name: null, email: 'jane@council.gov.uk' });
  });

  it('takes the plain-text body, lists attachments, and uses the received time', () => {
    const parsed = parseGmailMessage({
      id: 'm1',
      internalDate: String(Date.UTC(2026, 10, 9, 9, 30)),
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: 'Priya Desai <priya@example.test>' },
          { name: 'Subject', value: 'New referral' },
        ],
        parts: [
          { mimeType: 'text/plain', body: { data: b64('Please find attached.') } },
          { mimeType: 'application/pdf', filename: 'plan.pdf', body: { attachmentId: 'a1', size: 1200 } },
        ],
      },
    });
    expect(parsed).toMatchObject({
      subject: 'New referral',
      fromName: 'Priya Desai',
      fromEmail: 'priya@example.test',
      bodyText: 'Please find attached.',
      attachments: [{ fileName: 'plan.pdf', mimeType: 'application/pdf', size: 1200, attachmentId: 'a1' }],
    });
    expect(parsed.receivedAt.toISOString()).toBe('2026-11-09T09:30:00.000Z');
  });

  it('falls back to the HTML body as text', () => {
    expect(htmlToText('<p>Hello&nbsp;there</p><br>Line 2')).toBe('Hello there\n\nLine 2');
  });

  it('recognises PDFs and Word files sent as octet-stream', () => {
    expect(effectiveMimeType('Care plan.PDF', 'application/octet-stream')).toBe('application/pdf');
    expect(effectiveMimeType('plan.docx', 'application/octet-stream')).toContain('wordprocessingml');
  });

  it('reads the text of a Word attachment from a made-up test referral', async () => {
    const { raw } = await buildTestReferralRaw('me@example.test', 0);
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    const docxB64 = mime.split('wordprocessingml.document')[1].split('\r\n\r\n')[1].split('--careflow-test')[0];
    const text = await docxToText(Buffer.from(docxB64.replace(/\s+/g, ''), 'base64'));
    expect(text).toContain('Care and Support Plan');
    expect(text).toContain('high risk of falls');
  });
});

const extraction: ReferralExtraction = {
  isReferral: true,
  summary: 'Mrs Marlow needs 4 calls a day after discharge.',
  person: {
    firstName: 'Edith',
    lastName: 'Marlow',
    dateOfBirth: '1938-04-12',
    addressLine: '14 Larkspur Close, Purley',
    postcode: 'cr8 2qt',
    phone: '',
    nhsNumber: '',
    livesAlone: 'yes',
  },
  contact: { name: 'Joanna Marlow', relationship: 'Daughter', phone: '07700 900123', email: '' },
  referrer: {
    organisation: 'Croydon Council Adult Social Care',
    name: 'Priya Desai',
    role: 'Social Worker',
    email: 'priya@example.test',
    phone: '020 7946 0811',
    reference: 'CRY-55821',
  },
  urgency: 'URGENT',
  careNeeds: 'Help to wash, dress, meals and medication prompts.',
  conditions: ['Type 2 diabetes'],
  risks: ['High risk of falls'],
  care: {
    hoursPerWeek: '14',
    visitsPerDay: '4',
    visitTimes: '8:00, 12:30, 17:00, 20:00',
    carersPerVisit: '1',
    requestedStartDate: '2026-11-14',
    genderPreference: 'Female',
    languageOrCulture: '',
  },
  funding: { type: 'LOCAL_AUTHORITY', funderName: 'Croydon Council', details: 'Spot purchase' },
  visits: [{ label: 'Morning', startTime: '08:00', durationMinutes: 45, days: [], carers: 1 }],
  careAreas: ['Medication', 'Falls'],
  priceAsked: true,
  questionsAsked: ['Can you start on Saturday morning?'],
  missingInformation: ['Key safe code'],
  attachmentsRead: [],
};

describe('referral → enquiry', () => {
  it('fills a council referral with the referrer, person, care and funding details', () => {
    const dto = enquiryFromReferral(
      extraction,
      { fromName: 'Priya Desai', fromEmail: 'priya@example.test', receivedAt: new Date('2026-11-09T09:30:00Z') },
      'loc-1',
    );
    expect(dto).toMatchObject({
      kind: EnquiryKind.REFERRAL,
      referringOrganisation: 'Croydon Council Adult Social Care',
      referrerRole: 'Social Worker',
      referralReference: 'CRY-55821',
      firstName: 'Edith',
      lastName: 'Marlow',
      dateOfBirth: '1938-04-12',
      contactName: 'Priya Desai',
      contactEmail: 'priya@example.test',
      source: EnquirySource.SOCIAL_WORKER,
      receivedVia: EnquiryReceivedVia.EMAIL,
      urgency: 'URGENT',
      postcode: 'CR8 2QT',
      funderName: 'Croydon Council',
      hoursPerWeek: 14,
      visitsPerDay: 4,
      requestedStartDate: '2026-11-14',
      locationId: 'loc-1',
    });
  });

  it('puts the referrer’s questions and what is missing into the needs text', () => {
    const text = enquiryNeedsText(extraction);
    expect(text).toContain('Questions from the referrer:\n- Can you start on Saturday morning?');
    expect(text).toContain('Still needed:\n- Key safe code');
  });

  it('treats a family email as an enquiry with the family contact', () => {
    const dto = enquiryFromReferral(
      { ...extraction, referrer: { ...extraction.referrer, organisation: '', name: '', role: '' } },
      { fromName: 'Daniel', fromEmail: 'd@example.test', receivedAt: new Date() },
      'loc-1',
    );
    expect(dto.kind).toBe(EnquiryKind.ENQUIRY);
    expect(dto.contactName).toBe('Joanna Marlow');
    expect(dto.source).toBe(EnquirySource.FAMILY);
  });
});
