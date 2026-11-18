import { buildInterviewEmail, buildInterviewIcs, formatInterviewWhen, type InterviewEmailInput } from './interview-email.util';

const base: InterviewEmailInput = {
  kind: 'INVITE',
  interviewId: 'abc-123',
  sequence: 0,
  // 13 Nov 2026 07:44 UTC = 07:44 UK (GMT in November)
  scheduledAt: new Date('2026-11-13T07:44:00.000Z'),
  durationMinutes: 60,
  mode: 'IN_PERSON',
  location: '12 High Street, London',
  interviewers: 'Registered manager',
  candidateFirstName: 'Amjad',
  candidateEmail: 'amjad@example.com',
  candidatePhone: '07700 900000',
  jobTitle: 'Care Worker',
  organisation: 'All For Care',
  organisationEmail: 'jobs@example.com',
  organisationPhone: '020 0000 0000',
  now: new Date('2026-11-11T10:00:00.000Z'),
};

describe('interview emails', () => {
  it('shows the time in UK time (summer time too)', () => {
    expect(formatInterviewWhen(base.scheduledAt)).toBe('Friday 13 November 2026 at 07:44 (UK time)');
    expect(formatInterviewWhen(new Date('2026-07-01T09:00:00.000Z'))).toBe('Wednesday 1 July 2026 at 10:00 (UK time)');
  });

  it('invites with the details and what to bring', () => {
    const m = buildInterviewEmail(base);
    expect(m.subject).toBe('Interview invitation — Care Worker');
    expect(m.text).toContain('When: Friday 13 November 2026 at 07:44 (UK time)');
    expect(m.text).toContain('Where: 12 High Street, London');
    expect(m.text).toContain('With: Registered manager');
    expect(m.text).toContain('Please bring photo ID');
    expect(m.text).toContain('please call 020 0000 0000 or email jobs@example.com');
  });

  it('phone interviews say which number we will call; video gives the link', () => {
    expect(buildInterviewEmail({ ...base, mode: 'PHONE', location: null }).text).toContain('We will call you on: 07700 900000');
    const video = buildInterviewEmail({ ...base, mode: 'VIDEO', location: 'https://meet.example.com/x' }).text;
    expect(video).toContain('Video link: https://meet.example.com/x');
    expect(video).not.toContain('Please bring photo ID');
  });

  it('escapes HTML from typed-in fields', () => {
    expect(buildInterviewEmail({ ...base, interviewers: '<b>Boss</b>' }).html).toContain('&lt;b&gt;Boss&lt;/b&gt;');
  });

  it('cancellation and change emails', () => {
    expect(buildInterviewEmail({ ...base, kind: 'UPDATE' }).subject).toBe('Interview changed — Care Worker');
    const c = buildInterviewEmail({ ...base, kind: 'CANCEL' });
    expect(c.subject).toBe('Interview cancelled — Care Worker');
    expect(c.text).toContain('has been cancelled');
    expect(c.text).not.toContain('When:');
  });

  it('calendar file: one event that later emails update or cancel', () => {
    const ics = buildInterviewIcs(base);
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('UID:interview-abc-123@careflow');
    expect(ics).toContain('DTSTART:20261113T074400Z');
    expect(ics).toContain('DTEND:20261113T084400Z');
    expect(ics).toContain('LOCATION:12 High Street\\, London');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);

    const cancel = buildInterviewIcs({ ...base, kind: 'CANCEL', sequence: 2 });
    expect(cancel).toContain('METHOD:CANCEL');
    expect(cancel).toContain('SEQUENCE:2');
    expect(cancel).toContain('STATUS:CANCELLED');
  });
});
