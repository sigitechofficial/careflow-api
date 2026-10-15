import { countCheckInMethods, resolveVisitCheckInMethod } from './ecm-check-in-method.util';

describe('ecm-check-in-method.util', () => {
  const meta = (method: string, nfcTagLabel?: string) => ({
    employeeApp: { checkIns: { 'emp-1': { method, nfcTagLabel } } },
  });

  it('labels NFC with the tag name', () => {
    expect(
      resolveVisitCheckInMethod({
        checkIn: { verificationMethod: 'NFC', employeeId: 'emp-1' },
        metadata: meta('NFC', 'Main tag'),
      }),
    ).toEqual({ code: 'NFC', label: 'NFC tag · Main tag' });
  });

  it('tells carer Manual apart from GPS (both stored as MOBILE_GPS)', () => {
    expect(
      resolveVisitCheckInMethod({
        checkIn: { verificationMethod: 'MOBILE_GPS', employeeId: 'emp-1' },
        metadata: meta('MANUAL'),
      }).code,
    ).toBe('MANUAL');
    expect(
      resolveVisitCheckInMethod({
        checkIn: { verificationMethod: 'MOBILE_GPS', employeeId: 'emp-1' },
        metadata: null,
      }).code,
    ).toBe('GPS');
  });

  it('handles office attendance and no check-in', () => {
    expect(
      resolveVisitCheckInMethod({
        checkIn: { verificationMethod: 'MANUAL_OFFICE', employeeId: 'emp-1' },
        metadata: null,
      }).code,
    ).toBe('OFFICE');
    expect(resolveVisitCheckInMethod({ checkIn: null, metadata: null }).code).toBe('NONE');
  });

  it('counts methods', () => {
    expect(
      countCheckInMethods([
        { code: 'GPS', label: 'GPS' },
        { code: 'NFC', label: 'NFC tag' },
        { code: 'NFC', label: 'NFC tag' },
        { code: 'MANUAL', label: 'Manual (carer)' },
        { code: 'OFFICE', label: 'Office (manual)' },
        { code: 'NONE', label: 'Not clocked in' },
      ]),
    ).toEqual({ gps: 1, nfc: 2, qr: 0, manualCarer: 1, office: 1, none: 1 });
  });
});
