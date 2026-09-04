import {
  isCheckInMethodEnabled,
  normalizeCheckInMethod,
  resolveEnabledCheckInMethods,
} from './employee-app-check-in-methods.util';

describe('employee-app-check-in-methods', () => {
  it('defaults GPS only when settings missing', () => {
    expect(resolveEnabledCheckInMethods(null)).toEqual(['GPS']);
    expect(resolveEnabledCheckInMethods({})).toEqual(['GPS']);
  });

  it('keeps GPS → NFC → QR → MANUAL order', () => {
    expect(
      resolveEnabledCheckInMethods({
        domCheckInGpsEnabled: true,
        domCheckInManualEnabled: true,
        domCheckInNfcEnabled: true,
        domCheckInQrEnabled: true,
      }),
    ).toEqual(['GPS', 'NFC', 'QR', 'MANUAL']);
  });

  it('omits disabled methods', () => {
    expect(
      resolveEnabledCheckInMethods({
        domCheckInGpsEnabled: false,
        domCheckInManualEnabled: true,
        domCheckInNfcEnabled: false,
        domCheckInQrEnabled: true,
      }),
    ).toEqual(['QR', 'MANUAL']);
  });

  it('normalizes and checks method against enabled list', () => {
    expect(normalizeCheckInMethod('manual')).toBe('MANUAL');
    expect(isCheckInMethodEnabled('gps', ['GPS', 'MANUAL'])).toBe(true);
    expect(isCheckInMethodEnabled('NFC', ['GPS', 'MANUAL'])).toBe(false);
  });
});
