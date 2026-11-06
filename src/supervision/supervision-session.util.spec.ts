import { isSessionEditable, richTextHasContent, statusAfterSignature } from './supervision-session.util';

describe('supervision-session.util', () => {
  it('lets content change only before the supervisor signs', () => {
    expect(isSessionEditable('SCHEDULED')).toBe(true);
    expect(isSessionEditable('IN_PROGRESS')).toBe(true);
    expect(isSessionEditable('AWAITING_SIGN_OFF')).toBe(false);
    expect(isSessionEditable('COMPLETED')).toBe(false);
    expect(isSessionEditable('CANCELLED')).toBe(false);
  });

  it('treats an empty editor as no text', () => {
    expect(richTextHasContent('  ')).toBe(false);
    expect(richTextHasContent('<p></p>')).toBe(false);
    expect(richTextHasContent('<p><br></p><p>&nbsp;</p>')).toBe(false);
    expect(richTextHasContent('<p>No <strong>concerns</strong></p>')).toBe(true);
  });

  describe('statusAfterSignature', () => {
    const signed = new Date('2026-11-04T10:00:00Z');

    it('stays in progress until the supervisor signs', () => {
      expect(
        statusAfterSignature({ supervisorSignedAt: null, attendees: [{ signedAt: signed }] }, { requireCarerSignature: true }),
      ).toBe('IN_PROGRESS');
    });

    it('waits for every carer when carer signatures are required', () => {
      expect(
        statusAfterSignature(
          { supervisorSignedAt: signed, attendees: [{ signedAt: signed }, { signedAt: null }] },
          { requireCarerSignature: true },
        ),
      ).toBe('AWAITING_SIGN_OFF');
      expect(
        statusAfterSignature(
          { supervisorSignedAt: signed, attendees: [{ signedAt: signed }, { signedAt: signed }] },
          { requireCarerSignature: true },
        ),
      ).toBe('COMPLETED');
    });

    it('completes on the supervisor signature when carer signatures are off', () => {
      expect(
        statusAfterSignature({ supervisorSignedAt: signed, attendees: [{ signedAt: null }] }, { requireCarerSignature: false }),
      ).toBe('COMPLETED');
    });
  });
});
