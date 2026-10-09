import { formatNfcTagUid, normalizeNfcTagUid } from './nfc-tag-uid.util';

describe('normalizeNfcTagUid', () => {
  it('strips separators and upper-cases', () => {
    expect(normalizeNfcTagUid('04:a2:3b:1c:5d:80:00')).toBe('04A23B1C5D8000');
    expect(normalizeNfcTagUid('04 A2 3B 1C 5D 80 00')).toBe('04A23B1C5D8000');
    expect(normalizeNfcTagUid('04-a2-3b-1c')).toBe('04A23B1C');
  });

  it('accepts 4, 7 and 10 byte UIDs only', () => {
    expect(normalizeNfcTagUid('04A23B1C')).toBe('04A23B1C');
    expect(normalizeNfcTagUid('04A23B1C5D8000AABBCC')).toBe('04A23B1C5D8000AABBCC');
    expect(normalizeNfcTagUid('04A23B')).toBeNull();
    expect(normalizeNfcTagUid('04A23B1C5D')).toBeNull();
  });

  it('rejects non-hex and empty input', () => {
    expect(normalizeNfcTagUid('2349115908')).toBeNull(); // decimal-looking, wrong length
    expect(normalizeNfcTagUid('04G23B1C')).toBeNull();
    expect(normalizeNfcTagUid('')).toBeNull();
    expect(normalizeNfcTagUid(null)).toBeNull();
  });
});

describe('formatNfcTagUid', () => {
  it('groups bytes with colons', () => {
    expect(formatNfcTagUid('04A23B1C5D8000')).toBe('04:A2:3B:1C:5D:80:00');
  });
});
