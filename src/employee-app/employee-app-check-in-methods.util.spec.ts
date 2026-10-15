import {
  isCheckInMethodEnabled,
  mergeEnabledMethodsWithGrant,
  normalizeCheckInMethod,
  orgHasOptInCheckInMethod,
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

  it('treats Manual / NFC / QR as opt-in methods that block Request office', () => {
    expect(orgHasOptInCheckInMethod(null)).toBe(false);
    expect(orgHasOptInCheckInMethod({})).toBe(false);
    expect(orgHasOptInCheckInMethod({ domCheckInGpsEnabled: true })).toBe(false);
    expect(orgHasOptInCheckInMethod({ domCheckInManualEnabled: true })).toBe(true);
    expect(orgHasOptInCheckInMethod({ domCheckInNfcEnabled: true })).toBe(true);
    expect(orgHasOptInCheckInMethod({ domCheckInQrEnabled: true })).toBe(true);
  });

  it('drops NFC for a visit whose client has no active tag', () => {
    const flags = { domCheckInGpsEnabled: true, domCheckInNfcEnabled: true };
    expect(resolveEnabledCheckInMethods(flags, { nfcTagAvailable: false })).toEqual(['GPS']);
    expect(resolveEnabledCheckInMethods(flags, { nfcTagAvailable: true })).toEqual(['GPS', 'NFC']);
    expect(resolveEnabledCheckInMethods(flags)).toEqual(['GPS', 'NFC']);
  });

  it('keeps Request office where NFC is on but the client has no tag', () => {
    expect(orgHasOptInCheckInMethod({ domCheckInNfcEnabled: true }, { nfcTagAvailable: false })).toBe(false);
    expect(orgHasOptInCheckInMethod({ domCheckInNfcEnabled: true }, { nfcTagAvailable: true })).toBe(true);
    expect(
      orgHasOptInCheckInMethod(
        { domCheckInNfcEnabled: true, domCheckInManualEnabled: true },
        { nfcTagAvailable: false },
      ),
    ).toBe(true);
  });

  it('merges Manual onto GPS-only when office grant is authorised and unexpired', () => {
    const expiresAt = new Date('2026-09-08T22:59:59.999Z');
    const now = new Date('2026-09-08T12:00:00.000Z');
    expect(
      mergeEnabledMethodsWithGrant(
        ['GPS'],
        { status: 'AUTHORISED', expiresAt },
        now,
      ),
    ).toEqual(['GPS', 'MANUAL']);
    expect(
      mergeEnabledMethodsWithGrant(
        ['GPS'],
        { status: 'PENDING', expiresAt },
        now,
      ),
    ).toEqual(['GPS']);
    expect(
      mergeEnabledMethodsWithGrant(
        ['GPS'],
        { status: 'AUTHORISED', expiresAt, consumedAt: now },
        now,
      ),
    ).toEqual(['GPS']);
    expect(
      mergeEnabledMethodsWithGrant(
        ['GPS'],
        { status: 'AUTHORISED', expiresAt: new Date('2026-09-08T11:00:00.000Z') },
        now,
      ),
    ).toEqual(['GPS']);
  });
});
