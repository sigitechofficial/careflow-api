import { composeManualAuthorisationOfficeNote } from './visit-check-in-method-grant.util';
import { findManualRejectReason } from './manual-reject-reasons';

describe('manual-reject-reasons', () => {
  it('requires a typed note for Other', () => {
    const other = findManualRejectReason('other');
    expect(other?.requiresNotes).toBe(true);
    expect(composeManualAuthorisationOfficeNote(other!, '')).toBeNull();
    expect(composeManualAuthorisationOfficeNote(other!, 'Wait at the gate')).toBe(
      'Wait at the gate',
    );
  });

  it('uses the chip label for a fixed reason', () => {
    const reason = findManualRejectReason('USE_GPS');
    expect(composeManualAuthorisationOfficeNote(reason!, 'ignored')).toBe('Use GPS check-in');
  });

  it('ignores unknown codes', () => {
    expect(findManualRejectReason('NOT_A_REASON')).toBeNull();
  });
});
